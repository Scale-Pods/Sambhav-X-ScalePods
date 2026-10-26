# ScalePods Tally connector - READ-ONLY.
# Reads TallyPrime on this PC through its local XML port and sends what it reads to ScalePods over HTTPS (outbound only).
# It never writes to Tally and installs nothing. Windows PowerShell 5.1 or later.
#
#   -Mode Sync     the nightly job: masters, outstanding bills and the last weeks of vouchers
#   -Mode Check    every 5 minutes: tell ScalePods this PC is alive and run a sync if someone pressed "Sync now"
#   -Mode Detect   find the date format this Tally accepts (prints a table; changes nothing)
#   -Mode Replay   send XML files saved earlier (-Folder), for testing or as a manual fallback
#   -Mode Dump     save one voucher with every field Tally gives us (-VoucherNo "730/26-27" -From yyyyMMdd) to logs\ (read-only, sends nothing)
param(
    [ValidateSet("Sync", "Check", "Detect", "Replay", "Dump")][string]$Mode = "Sync",
    [string]$Config = (Join-Path $PSScriptRoot "config.json"),
    [string]$From = "", [string]$To = "",          # yyyyMMdd, optional (Sync)
    [string]$Folder = "",                          # Replay: folder with saved XML
    [string]$Company = "",                         # Replay: company name when companies.xml is not in the folder
    [string]$Trigger = "schedule",
    [string]$VoucherNo = ""                        # Dump: the voucher number to save
)

$ErrorActionPreference = "Stop"
$Version = "1.0"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$inv = [Globalization.CultureInfo]::InvariantCulture

# ---------------------------------------------------------------- config, logging
$cfg = Get-Content -Raw -Path $Config | ConvertFrom-Json
function Opt($name, $default) { if ($cfg.PSObject.Properties.Name -contains $name -and $null -ne $cfg.$name -and "$($cfg.$name)" -ne "") { return $cfg.$name } else { return $default } }
$TallyUrl   = Opt "tallyUrl" "http://localhost:9001"
$Lookback   = [int](Opt "lookbackDays" 45)
$FyStart    = [string](Opt "fyStart" "20260401")
$FyEnd      = [string](Opt "fyEnd" "20270331")
$ChunkDays  = [int](Opt "chunkDays" 3)
$BatchSize  = [int](Opt "batchSize" 100)
$StateFile  = Join-Path $PSScriptRoot "state.json"
$LogDir     = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile    = Join-Path $LogDir ("connector-" + (Get-Date -Format "yyyyMMdd") + ".log")
Get-ChildItem $LogDir -Filter "connector-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force -ErrorAction SilentlyContinue

function Log($m) { $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m; Write-Host $line; Add-Content -Path $LogFile -Value $line -Encoding UTF8 }

function Get-State { if (Test-Path $StateFile) { return Get-Content -Raw $StateFile | ConvertFrom-Json } else { return [pscustomobject]@{} } }
function Set-State($k, $v) { $s = Get-State; if ($s.PSObject.Properties.Name -contains $k) { $s.$k = $v } else { $s | Add-Member -NotePropertyName $k -NotePropertyValue $v }; $s | ConvertTo-Json -Depth 5 | Set-Content -Path $StateFile -Encoding UTF8 }

# ---------------------------------------------------------------- talking to ScalePods
function Send-Rpc([string]$fn, $body) {
    $uri = ($cfg.supabaseUrl.TrimEnd("/")) + "/rest/v1/rpc/" + $fn
    $bytes = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 12 -Compress))
    $headers = @{ "apikey" = $cfg.apiKey; "Content-Type" = "application/json" }
    for ($try = 1; $try -le 4; $try++) {
        try {
            $r = Invoke-WebRequest -Uri $uri -Method Post -Headers $headers -Body $bytes -UseBasicParsing -TimeoutSec 180
            if ($r.Content) { return ($r.Content | ConvertFrom-Json) } else { return $null }
        } catch {
            $detail = ""
            try { $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream()); $detail = $sr.ReadToEnd() } catch {}
            $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch {}
            if ($code -ge 400 -and $code -lt 500 -and $code -ne 429 -and $code -ne 408) { throw "ScalePods refused $fn ($code): $detail" }
            if ($try -eq 4) { throw "ScalePods call $fn failed after 4 tries: $($_.Exception.Message) $detail" }
            Start-Sleep -Seconds (5 * $try)
        }
    }
}
function Call($fn, $extra) { $b = @{ p_key = $cfg.connectorKey }; foreach ($k in $extra.Keys) { $b[$k] = $extra[$k] }; return Send-Rpc $fn $b }

# ---------------------------------------------------------------- talking to Tally (read-only requests)
function Read-Bytes($stream) { $ms = New-Object IO.MemoryStream; $stream.CopyTo($ms); return $ms.ToArray() }
function Tally-Alive {
    try { $req = [Net.WebRequest]::Create($TallyUrl); $req.Timeout = 10000; $res = $req.GetResponse(); $res.Close(); return $true } catch { return $false }
}
function Ask-Tally([string]$xml, [int]$timeoutSec = 900) {
    $req = [Net.HttpWebRequest]::Create($TallyUrl)
    $req.Method = "POST"; $req.ContentType = "text/xml"; $req.Timeout = $timeoutSec * 1000; $req.ReadWriteTimeout = $timeoutSec * 1000
    $body = [Text.Encoding]::UTF8.GetBytes($xml); $req.ContentLength = $body.Length
    $s = $req.GetRequestStream(); $s.Write($body, 0, $body.Length); $s.Close()
    $res = $req.GetResponse(); $bytes = Read-Bytes $res.GetResponseStream(); $res.Close()
    if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) { return [Text.Encoding]::Unicode.GetString($bytes) }
    return [Text.Encoding]::UTF8.GetString($bytes)
}

# Tally writes characters that XML forbids (for example &#4;). Remove them so the text can be read as XML.
function Clean-Xml([string]$s) {
    $s = [regex]::Replace($s, "&#(?:[0-8]|1[1-2]|1[4-9]|2[0-9]|3[0-1]);", "")
    return [regex]::Replace($s, "[\x00-\x08\x0B\x0C\x0E-\x1F]", "")
}
# Some answers use prefixed tags (UDF:...) without saying what the prefix means, which XML refuses to read. Declare each prefix on the first tag.
function To-Xml([string]$text) {
    $t = Clean-Xml $text
    $prefixes = @([regex]::Matches($t, "</?([A-Za-z][A-Za-z0-9]*):[A-Za-z]") | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique | Where-Object { $_ -ne "xml" -and $t -notmatch "xmlns:$_=" })
    if ($prefixes.Count -gt 0) {
        $decl = ($prefixes | ForEach-Object { " xmlns:$_=`"urn:tally:$_`"" }) -join ""
        $t = [regex]::Replace($t, "<ENVELOPE", "<ENVELOPE$decl", 1)
    }
    $d = New-Object Xml.XmlDocument; $d.LoadXml($t); return $d
}

function Txt($node, [string]$path) { $n = $node.SelectSingleNode($path); if ($null -ne $n) { return $n.InnerText.Trim() } else { return "" } }
function Num([string]$s) {
    if ([string]::IsNullOrWhiteSpace($s)) { return $null }
    $m = [regex]::Match($s, "-?[\d,]*\.?\d+")
    if (-not $m.Success) { return $null }
    return [decimal]::Parse($m.Value.Replace(",", ""), $inv)
}
function Unit-Of([string]$s) { $m = [regex]::Match($s, "[A-Za-z][A-Za-z\.\s]*$"); if ($m.Success) { return $m.Value.Trim() } else { return "" } }
function Collection-Xml([string]$id, [string]$type, [string]$fetch) {
    return "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>$id</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME=`"$id`" ISMODIFY=`"No`"><TYPE>$type</TYPE><FETCH>$fetch</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
}

# ---------------------------------------------------------------- readers: Tally XML -> plain objects
function Read-Company([string]$xml) {
    $d = To-Xml $xml
    $names = @($d.SelectNodes("//COMPANY") | ForEach-Object { $_.GetAttribute("NAME") } | Where-Object { $_ })
    return $names
}
function Read-Ledgers([string]$xml) {
    $d = To-Xml $xml; $out = New-Object Collections.Generic.List[object]
    foreach ($n in $d.SelectNodes("//LEDGER")) {
        $name = $n.GetAttribute("NAME"); if (-not $name) { continue }
        $out.Add([ordered]@{ guid = (Txt $n "GUID"); name = $name; parent = (Txt $n "PARENT"); gstin = (Txt $n "PARTYGSTIN"); state = (Txt $n "STATENAME")
                             closing = (Num (Txt $n "CLOSINGBALANCE")); regtype = (Txt $n "GSTREGISTRATIONTYPE") })
    }
    return $out
}
function Read-Stock([string]$xml) {
    $d = To-Xml $xml; $out = New-Object Collections.Generic.List[object]
    foreach ($n in $d.SelectNodes("//STOCKITEM")) {
        $name = $n.GetAttribute("NAME"); if (-not $name) { continue }
        $out.Add([ordered]@{ guid = (Txt $n "GUID"); name = $name; parent = (Txt $n "PARENT"); unit = (Txt $n "BASEUNITS")
                             qty = (Num (Txt $n "CLOSINGBALANCE")); value = (Num (Txt $n "CLOSINGVALUE")) })
    }
    return $out
}
# "Bills Receivable" / "Bills Payable" come as a flat run of BILLFIXED / BILLCL / BILLDUE elements
function Read-Bills([string]$xml) {
    $d = To-Xml $xml; $out = New-Object Collections.Generic.List[object]; $cur = $null
    function Iso([string]$t) { if (-not $t) { return "" }; foreach ($f in @("d-MMM-yy", "dd-MMM-yy", "d-MMM-yyyy", "dd-MMM-yyyy")) { $dt = [datetime]::MinValue; if ([datetime]::TryParseExact($t, $f, $inv, "None", [ref]$dt)) { return $dt.ToString("yyyy-MM-dd") } }; return "" }
    foreach ($n in $d.DocumentElement.ChildNodes) {
        switch ($n.Name) {
            "BILLFIXED" { if ($cur) { $out.Add($cur) }; $cur = [ordered]@{ party = (Txt $n "BILLPARTY"); ref = (Txt $n "BILLREF"); bill_date = (Iso (Txt $n "BILLDATE")); due_date = ""; pending = $null } }
            "BILLCL"    { if ($cur) { $cur.pending = (Num $n.InnerText) } }
            "BILLDUE"   { if ($cur) { $cur.due_date = (Iso $n.InnerText.Trim()) } }
        }
    }
    if ($cur) { $out.Add($cur) }
    return @($out | Where-Object { $null -ne $_.pending })
}
# Vouchers (Day Book or voucher collection). Amounts in `entries` are debit-positive; Tally writes debits as negative.
function Read-Vouchers([string]$xml) {
    $d = To-Xml $xml; $out = New-Object Collections.Generic.List[object]
    foreach ($v in $d.SelectNodes("//VOUCHER")) {
        $guid = Txt $v "GUID"; if (-not $guid) { $guid = $v.GetAttribute("REMOTEID") }
        $date = Txt $v "DATE"; $type = Txt $v "VOUCHERTYPENAME"; if (-not $type) { $type = $v.GetAttribute("VCHTYPE") }
        if (-not $guid -or -not $date -or -not $type) { continue }
        $entries = New-Object Collections.Generic.List[object]; $items = New-Object Collections.Generic.List[object]
        # The real Tally lists the same ledger lines under both ALLLEDGERENTRIES and LEDGERENTRIES: take one list, never both
        $lines = @($v.SelectNodes("ALLLEDGERENTRIES.LIST")); if ($lines.Count -eq 0) { $lines = @($v.SelectNodes("LEDGERENTRIES.LIST")) }
        foreach ($e in $lines) {
            $a = Num (Txt $e "AMOUNT"); if ($null -eq $a) { continue }
            $entries.Add([ordered]@{ ledger = (Txt $e "LEDGERNAME"); amount = (-$a) })
        }
        $haveLedgerLines = ($entries.Count -gt 0)
        foreach ($i in @($v.SelectNodes("ALLINVENTORYENTRIES.LIST")) + @($v.SelectNodes("INVENTORYENTRIES.LIST"))) {
            if (-not (Txt $i "STOCKITEMNAME")) { continue }   # Tally puts an empty item list in payments, receipts and journals
            $qtyTxt = Txt $i "BILLEDQTY"; if (-not $qtyTxt) { $qtyTxt = Txt $i "ACTUALQTY" }
            $rateTxt = Txt $i "RATE"
            $desc = @($i.SelectNodes("BASICUSERDESCRIPTION.LIST/BASICUSERDESCRIPTION") | ForEach-Object { $_.InnerText.Trim() } | Where-Object { $_ }) -join " | "
            $batch = @($i.SelectNodes("BATCHALLOCATIONS.LIST/BATCHNAME") | ForEach-Object { $_.InnerText.Trim() } | Where-Object { $_ -and $_ -ne "Primary Batch" }) -join ", "
            $godown = Txt $i "BATCHALLOCATIONS.LIST/GODOWNNAME"
            $amt = Num (Txt $i "AMOUNT")
            $items.Add([ordered]@{ item = (Txt $i "STOCKITEMNAME"); descr = $desc; qty = (Num $qtyTxt); unit = (Unit-Of $qtyTxt); rate = (Num $rateTxt)
                                   amount = $amt; hsn = (Txt $i "GSTHSNNAME"); godown = $godown; batch = $batch })
            # the sales/purchase ledger split of an item line only counts when the voucher has no ledger lines of its own (they would be counted twice)
            if (-not $haveLedgerLines) {
                foreach ($al in $i.SelectNodes("ACCOUNTINGALLOCATIONS.LIST")) {
                    $a = Num (Txt $al "AMOUNT"); if ($null -ne $a) { $entries.Add([ordered]@{ ledger = (Txt $al "LEDGERNAME"); amount = (-$a) }) }
                }
            }
        }
        # the voucher amount is what the party was charged (the invoice total); with no party it is the debit total
        $partyName = Txt $v "PARTYLEDGERNAME"; $debit = 0; $partySum = 0.0; $partyHit = $false
        foreach ($e in $entries) {
            if ($e.amount -gt 0) { $debit += $e.amount }
            if ($partyName -and $e.ledger -eq $partyName) { $partySum += $e.amount; $partyHit = $true }
        }
        if ($partyHit -and [Math]::Abs($partySum) -gt 0) { $debit = [Math]::Abs($partySum) }
        $out.Add([ordered]@{ guid = $guid; alter_id = (Num (Txt $v "ALTERID")); vtype = $type; vno = (Txt $v "VOUCHERNUMBER"); vdate = $date
                             party = (Txt $v "PARTYLEDGERNAME"); amount = $debit; narration = (Txt $v "NARRATION"); cancelled = ((Txt $v "ISCANCELLED") -eq "Yes")
                             reference = (Txt $v "REFERENCE"); irn = (Txt $v "IRN"); entered_by = (Txt $v "ENTEREDBY"); entries = $entries.ToArray(); items = $items.ToArray()
                             ack_no = (Txt $v "IRNACKNO"); shipped_by = (Txt $v "BASICSHIPPEDBY")
                             vehicle = $(if (Txt $v "EWAYBILLDETAILS.LIST/TRANSPORTDETAILS.LIST/VEHICLENUMBER") { Txt $v "EWAYBILLDETAILS.LIST/TRANSPORTDETAILS.LIST/VEHICLENUMBER" } else { Txt $v "BASICSHIPVESSELNO" })
                             eway_no = (Txt $v "EWAYBILLDETAILS.LIST/BILLNUMBER"); eway_until = (Txt $v "EWAYBILLDETAILS.LIST/VALIDUPTO")
                             order_no = (Txt $v "INVOICEORDERLIST.LIST/BASICPURCHASEORDERNO"); gstin = (Txt $v "PARTYGSTIN"); pos = (Txt $v "PLACEOFSUPPLY") })
    }
    return $out
}

# ---------------------------------------------------------------- asking Tally for vouchers
# Tally ignores a date it cannot read and answers with its default day, so the right format is found by testing (Detect).
$DateStyles = @(
    @{ name = "yyyyMMdd";          fmt = "yyyyMMdd";    typed = $false }, @{ name = "dd-MMM-yyyy";  fmt = "dd-MMM-yyyy"; typed = $false },
    @{ name = "dd-MM-yyyy";        fmt = "dd-MM-yyyy";  typed = $false }, @{ name = "dd/MM/yyyy";   fmt = "dd/MM/yyyy";  typed = $false },
    @{ name = "d-MMM-yyyy";        fmt = "d-MMM-yyyy";  typed = $false }, @{ name = "typed yyyyMMdd"; fmt = "yyyyMMdd"; typed = $true },
    @{ name = "typed dd-MMM-yyyy"; fmt = "dd-MMM-yyyy"; typed = $true }, @{ name = "typed dd-MM-yyyy"; fmt = "dd-MM-yyyy"; typed = $true },
    # second method: a list of vouchers with the date filter written into the request itself (does not rely on Tally's report dates)
    @{ name = "filter d-MMM-yyyy"; fmt = "d-MMM-yyyy"; kind = "filter" }, @{ name = "filter dd-MM-yyyy"; fmt = "dd-MM-yyyy"; kind = "filter" },
    @{ name = "filter yyyy-MM-dd"; fmt = "yyyy-MM-dd"; kind = "filter" }, @{ name = "filter dd/MM/yyyy"; fmt = "dd/MM/yyyy"; kind = "filter" }
)
function Daybook-Xml($style, [datetime]$a, [datetime]$b) {
    $t = ""; if ($style.typed) { $t = " TYPE=`"Date`"" }
    return "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Day Book</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT><SVFROMDATE$t>$($a.ToString($style.fmt, $inv))</SVFROMDATE><SVTODATE$t>$($b.ToString($style.fmt, $inv))</SVTODATE></STATICVARIABLES></DESC></BODY></ENVELOPE>"
}
function Filter-Xml($style, [datetime]$a, [datetime]$b) {
    $fetch = "Date,GUID,AlterID,VoucherTypeName,VoucherNumber,PartyLedgerName,Narration,Reference,IsCancelled,EnteredBy,IRN,IRNAckNo,IRNAckDate,BasicShippedBy,BasicShipVesselNo,PartyGSTIN,PlaceOfSupply,EWayBillDetails.*,InvoiceOrderList.*,AllLedgerEntries.*,AllInventoryEntries.*"
    $cond = "`$Date &gt;= `$`$Date:`"$($a.ToString($style.fmt, $inv))`" AND `$Date &lt;= `$`$Date:`"$($b.ToString($style.fmt, $inv))`""
    return "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SPVouchers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME=`"SPVouchers`" ISMODIFY=`"No`"><TYPE>Voucher</TYPE><FETCH>$fetch</FETCH><FILTERS>SPDateRange</FILTERS></COLLECTION><SYSTEM TYPE=`"Formulae`" NAME=`"SPDateRange`">$cond</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
}
# For -Mode Dump: the same request as Filter-Xml but asking for many more fields (names Tally does not know are simply left out of its answer)
function Dump-Xml($style, [datetime]$a, [datetime]$b) {
    $fetch = "Date,GUID,AlterID,VoucherTypeName,VoucherNumber,PartyLedgerName,Narration,Reference,ReferenceDate,IsCancelled,EnteredBy," +
             "IRN,IRNAckNo,IRNAckDate,BasicBuyerName,BasicOrderRef,BasicOrderDate,BasicShippedBy,BasicShipDocumentNo,BasicShipVesselNo,BasicFinalDestination,BasicDueDateOfPymt,BasicOrderNo," +
             "EWayBillDetails.*,PartyGSTIN,GSTRegistration,PlaceOfSupply,BuyerName,ConsigneeName,AllLedgerEntries.*,AllInventoryEntries.*,LedgerEntries.*,InventoryEntries.*"
    $cond = "`$Date &gt;= `$`$Date:`"$($a.ToString($style.fmt, $inv))`" AND `$Date &lt;= `$`$Date:`"$($b.ToString($style.fmt, $inv))`""
    return "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SPVouchers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME=`"SPVouchers`" ISMODIFY=`"No`"><TYPE>Voucher</TYPE><FETCH>$fetch</FETCH><FILTERS>SPDateRange</FILTERS></COLLECTION><SYSTEM TYPE=`"Formulae`" NAME=`"SPDateRange`">$cond</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
}
function Voucher-Xml($style, [datetime]$a, [datetime]$b) {
    if ($style.kind -eq "filter") { return (Filter-Xml $style $a $b) }
    return (Daybook-Xml $style $a $b)
}
function Get-Day([string]$s) { return [datetime]::ParseExact($s, "yyyyMMdd", $inv) }

# A format is accepted only when three separate windows each answer with vouchers from inside their own window and, together, from at least
# three different days. A Tally that ignores the dates answers every window with the same default day, so it cannot pass by luck.
function Test-Style($st, $windows, [bool]$verbose) {
    $allDates = New-Object Collections.Generic.HashSet[string]; $total = 0; $ok = $true; $report = @()
    foreach ($w in $windows) {
        $a = $w[0]; $b = $w[1]
        $vs = Read-Vouchers (Ask-Tally (Voucher-Xml $st $a $b) 300)
        $dates = @($vs | ForEach-Object { $_.vdate } | Sort-Object -Unique)
        $inside = @($dates | Where-Object { $d = Get-Day $_; $d -ge $a -and $d -le $b })
        if ($inside.Count -ne $dates.Count) { $ok = $false }
        $total += @($vs).Count; foreach ($d in $dates) { [void]$allDates.Add($d) }
        $report += ("{0}..{1}: {2} vouchers on {3} day(s)" -f $a.ToString("MMdd"), $b.ToString("MMdd"), @($vs).Count, $dates.Count)
    }
    if ($verbose) { Log ("  {0,-18} {1} -> {2} distinct day(s) overall" -f $st.name, ($report -join " | "), $allDates.Count) }
    return ($ok -and $total -gt 0 -and $allDates.Count -ge 3)
}
function Detect-DateStyle([bool]$verbose) {
    $t = (Get-Date).Date
    $sets = @(
        @(@($t.AddDays(-30), $t.AddDays(-21)), @($t.AddDays(-20), $t.AddDays(-11)), @($t.AddDays(-10), $t)),
        @(@($t.AddDays(-90), $t.AddDays(-61)), @($t.AddDays(-60), $t.AddDays(-31)), @($t.AddDays(-30), $t))
    )
    foreach ($windows in $sets) {
        foreach ($st in $DateStyles) {
            try { if (Test-Style $st $windows $verbose) { return $st } }
            catch { if ($verbose) { Log ("  {0,-18} FAILED {1}" -f $st.name, $_.Exception.Message) } }
        }
    }
    return $null
}
function Get-VoucherStyle {
    $s = Get-State
    if (($s.PSObject.Properties.Name -contains "dateStyle") -and ($s.PSObject.Properties.Name -contains "detectVersion") -and $s.detectVersion -eq 2) { $found = $DateStyles | Where-Object { $_.name -eq $s.dateStyle }; if ($found) { return $found } }
    $st = Detect-DateStyle $false
    if ($st) { Set-State "dateStyle" $st.name; Set-State "detectVersion" 2; Log "Date format Tally accepts: $($st.name)" }
    return $st
}

# ---------------------------------------------------------------- sending in batches
function Send-Batches([string]$fn, [string]$company, $items, [string]$label) {
    $total = 0; $list = @($items)
    for ($i = 0; $i -lt $list.Count; $i += $BatchSize) {
        $chunk = $list[$i..([Math]::Min($i + $BatchSize, $list.Count) - 1)]
        Call $fn @{ p_company = $company; p_items = @($chunk) } | Out-Null
        $total += $chunk.Count
    }
    Log "  sent $total $label"
    return $total
}

function Sync-Masters([string]$company) {
    $n = 0
    Log "Ledgers..."
    $led = Read-Ledgers (Ask-Tally (Collection-Xml "ScalePodsLedgers" "Ledger" "GUID,Name,Parent,PartyGSTIN,GSTRegistrationType,StateName,ClosingBalance") 600)
    $n += Send-Batches "tally_ingest_ledgers" $company $led "ledgers"
    Log "Stock items..."
    $stk = Read-Stock (Ask-Tally (Collection-Xml "ScalePodsItems" "StockItem" "GUID,Name,Parent,BaseUnits,ClosingBalance,ClosingValue") 600)
    $n += Send-Batches "tally_ingest_stock" $company $stk "stock items"
    foreach ($k in @(@("Bills Receivable", "receivable"), @("Bills Payable", "payable"))) {
        Log "$($k[0])..."
        $xml = "<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>$($k[0])</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>"
        $bills = @(Read-Bills (Ask-Tally $xml 600))
        Call "tally_ingest_bills" @{ p_company = $company; p_kind = $k[1]; p_as_of = (Get-Date -Format "yyyy-MM-dd"); p_items = $bills } | Out-Null
        Log "  sent $($bills.Count) $($k[1]) bills"; $n += $bills.Count
    }
    return $n
}

function Sync-Vouchers([string]$company, [datetime]$from, [datetime]$to, $style) {
    $n = 0; $guids = New-Object Collections.Generic.List[string]; $d = $from
    while ($d -le $to) {
        $e = $d.AddDays($ChunkDays - 1); if ($e -gt $to) { $e = $to }
        # beyond today only future-dated entries can exist: one request is enough
        if ($d -gt (Get-Date).Date) { $e = $to }
        $all = @(Read-Vouchers (Ask-Tally (Voucher-Xml $style $d $e) 900))
        # Tally answers with its default day when it cannot read a date: keep only what falls inside the dates we asked for
        $vs = @($all | Where-Object { $vd = Get-Day $_.vdate; $vd -ge $d -and $vd -le $e })
        if ($all.Count -gt 0 -and $vs.Count -eq 0) { throw ("Tally ignored the dates for {0}-{1} (it returned {2} vouchers from other days); nothing was sent for this period" -f $d.ToString("yyyyMMdd"), $e.ToString("yyyyMMdd"), $all.Count) }
        if ($vs.Count -gt 0) {
            $n += Send-Batches "tally_ingest_vouchers" $company $vs ("vouchers " + $d.ToString("yyyyMMdd") + "-" + $e.ToString("yyyyMMdd"))
            foreach ($v in $vs) { $guids.Add($v.guid) }
        }
        $d = $e.AddDays(1)
    }
    # only after the whole window was read without a failure: anything we hold in this window that Tally no longer returns was deleted there
    Call "tally_close_range" @{ p_company = $company; p_from = $from.ToString("yyyy-MM-dd"); p_to = $to.ToString("yyyy-MM-dd"); p_guids = @($guids.ToArray()) } | Out-Null
    return $n
}

function Run-Sync([string]$fromStr, [string]$toStr, [string]$trigger) {
    $names = Read-Company (Ask-Tally "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>" 60)
    $wanted = [string](Opt "companyMatch" "")
    $company = if ($wanted) { $names | Where-Object { $_ -like "*$wanted*" } | Select-Object -First 1 } else { $names | Select-Object -First 1 }
    if (-not $company) { throw "No Tally company is loaded" }
    if (@($names).Count -gt 1) { Log "Several companies are loaded; using: $company" }
    Log "Company: $company"
    $run = Call "tally_run_start" @{ p_company = $company; p_trigger = $trigger }
    $records = 0
    try {
        $records += Sync-Masters $company
        $style = Get-VoucherStyle
        if (-not $style) { throw "Tally did not accept any date format for the Day Book; vouchers were not read (masters were sent)" }
        $st = Get-State; $full = ($st.PSObject.Properties.Name -contains "lastFull")
        if ($fromStr) { $from = Get-Day $fromStr } elseif ($full) { $from = [datetime]::Today.AddDays(-$Lookback) } else { $from = Get-Day $FyStart }
        $fyStart = Get-Day $FyStart; if ($from -lt $fyStart) { $from = $fyStart }
        $to = if ($toStr) { Get-Day $toStr } else { Get-Day $FyEnd }
        Log ("Vouchers {0} to {1} (method {2})" -f $from.ToString("yyyy-MM-dd"), $to.ToString("yyyy-MM-dd"), $style.name)
        $records += Sync-Vouchers $company $from $to $style
        if (-not $full -and -not $fromStr) { Set-State "lastFull" (Get-Date -Format s) }
        Call "tally_run_finish" @{ p_run = $run; p_status = "ok"; p_records = [int]$records; p_error = $null } | Out-Null
        Log "Done. $records records."
        return @{ ok = $true; message = "$records records" }
    } catch {
        $m = $_.Exception.Message
        Log "FAILED: $m"
        try { Call "tally_run_finish" @{ p_run = $run; p_status = "failed"; p_records = [int]$records; p_error = $m } | Out-Null } catch {}
        return @{ ok = $false; message = $m }
    }
}

# ---------------------------------------------------------------- modes
$mutex = New-Object Threading.Mutex($false, "Global\ScalePodsTallyConnector")
if (-not $mutex.WaitOne(0)) { Log "Another ScalePods Tally job is running; this one stops."; exit 0 }
try {
    switch ($Mode) {
        "Detect" {
            Log "Testing date formats on $TallyUrl (reads only)..."
            $st = Detect-DateStyle $true
            if ($st) { Log "WORKS: $($st.name)"; Set-State "dateStyle" $st.name; Set-State "detectVersion" 2 } else { Log "No format worked. Send this log to ScalePods." }
        }
        "Dump" {
            if (-not $VoucherNo -or -not $From) { throw "-VoucherNo and -From (the voucher's date, yyyyMMdd) are required" }
            $st = Get-VoucherStyle
            if (-not $st -or $st.kind -ne "filter") { throw "Dump needs the filter method; run -Mode Detect first" }
            $day = Get-Day $From; $end = if ($To) { Get-Day $To } else { $day }
            Log "Asking Tally for the vouchers of $($day.ToString('yyyy-MM-dd')) with every field we know to ask for (reads only)..."
            $text = Clean-Xml (Ask-Tally (Dump-Xml $st $day $end) 300)
            $hits = @([regex]::Matches($text, "<VOUCHER[ >].*?</VOUCHER>", "Singleline") | ForEach-Object { $_.Value } | Where-Object { $_ -match ("<VOUCHERNUMBER>\s*" + [regex]::Escape($VoucherNo) + "\s*</VOUCHERNUMBER>") })
            if ($hits.Count -eq 0) { throw "Voucher $VoucherNo was not among the vouchers Tally returned for that date" }
            $safe = ($VoucherNo -replace "[^A-Za-z0-9]", "-")
            $file = Join-Path $LogDir ("dump-" + $safe + ".xml")
            [IO.File]::WriteAllText($file, $hits[0], (New-Object Text.UTF8Encoding($false)))
            $tags = @([regex]::Matches($hits[0], "<([A-Za-z][A-Za-z0-9.:]*)[ >]") | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique | Where-Object { $_ -match "IRN|EWAY|BASIC|HSN|SHIP|ORDER|VEHICLE|TRANSPORT|DISPATCH|CONSIGN|BUYER" })
            Log ("Saved {0} ({1:N0} bytes). Interesting fields found: {2}" -f $file, (Get-Item $file).Length, ($tags -join ", "))
        }
        "Check" {
            if (-not (Tally-Alive)) { Call "tally_check" @{ p_status = "tally_down"; p_message = "Tally did not answer on $TallyUrl"; p_version = $Version } | Out-Null; Log "Tally is not answering."; exit 1 }
            $r = Call "tally_check" @{ p_status = "ok"; p_message = "alive"; p_version = $Version }
            if ($r -and $r.request) {
                Log "A sync was requested ($($r.request.id))."
                $f = ""; $t = ""; if ($r.request.from) { $f = ([datetime]$r.request.from).ToString("yyyyMMdd") }; if ($r.request.to) { $t = ([datetime]$r.request.to).ToString("yyyyMMdd") }
                $res = Run-Sync $f $t "manual"
                Call "tally_request_done" @{ p_request = $r.request.id; p_ok = [bool]$res.ok; p_message = $res.message } | Out-Null
            }
        }
        "Sync" {
            if (-not (Tally-Alive)) { Call "tally_check" @{ p_status = "tally_down"; p_message = "Tally did not answer on $TallyUrl"; p_version = $Version } | Out-Null; Log "Tally is not answering on $TallyUrl. Is it open with the company loaded?"; exit 1 }
            $res = Run-Sync $From $To $Trigger
            Call "tally_check" @{ p_status = $(if ($res.ok) { "ok" } else { "error" }); p_message = $res.message; p_version = $Version } | Out-Null
            if (-not $res.ok) { exit 2 }
        }
        "Replay" {
            if (-not $Folder) { throw "-Folder is required" }
            $co = $Company
            $cf = Join-Path $Folder "companies.xml"
            if (-not $co -and (Test-Path $cf)) { $co = (Read-Company ([IO.File]::ReadAllText($cf))) | Select-Object -First 1 }
            if (-not $co) { throw "No company name: pass -Company or put companies.xml in the folder" }
            Log "Replay into company: $co"
            $run = Call "tally_run_start" @{ p_company = $co; p_trigger = "upload" }; $n = 0
            foreach ($f in Get-ChildItem $Folder -Filter "ledgers.xml") { $n += Send-Batches "tally_ingest_ledgers" $co (Read-Ledgers ([IO.File]::ReadAllText($f.FullName))) "ledgers" }
            foreach ($f in Get-ChildItem $Folder -Filter "stockitems.xml") { $n += Send-Batches "tally_ingest_stock" $co (Read-Stock ([IO.File]::ReadAllText($f.FullName))) "stock items" }
            foreach ($k in @(@("receivables.xml", "receivable"), @("payables.xml", "payable"))) {
                $p = Join-Path $Folder $k[0]
                if (Test-Path $p) { $b = @(Read-Bills ([IO.File]::ReadAllText($p))); Call "tally_ingest_bills" @{ p_company = $co; p_kind = $k[1]; p_as_of = (Get-Date -Format "yyyy-MM-dd"); p_items = $b } | Out-Null; Log "  sent $($b.Count) $($k[1]) bills"; $n += $b.Count }
            }
            foreach ($f in Get-ChildItem $Folder -Filter "daybook-*.xml") { $n += Send-Batches "tally_ingest_vouchers" $co (Read-Vouchers ([IO.File]::ReadAllText($f.FullName))) ("vouchers from " + $f.Name) }
            Call "tally_run_finish" @{ p_run = $run; p_status = "ok"; p_records = [int]$n; p_error = $null } | Out-Null
            Log "Replay done. $n records."
        }
    }
} catch {
    Log "ERROR: $($_.Exception.Message)"
    try { Call "tally_check" @{ p_status = "error"; p_message = $_.Exception.Message; p_version = $Version } | Out-Null } catch {}
    exit 3
} finally { $mutex.ReleaseMutex() }
