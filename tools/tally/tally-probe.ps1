# ScalePods - READ-ONLY probe of TallyPrime over its local XML port.
# It only ASKS Tally for data (export requests). It changes nothing in Tally and installs nothing.
# Run on the Tally PC, with TallyPrime open and the company loaded:
#     powershell -ExecutionPolicy Bypass -File tally-probe.ps1
# Results go to E:\Export\scalepods-probe (override with -Out). Copy that folder back, nothing else is needed.
param([int]$Port = 9000, [string]$Out = "E:\Export\scalepods-probe", [string]$From = "20261001", [string]$To = "20261031")

$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$base = "http://localhost:$Port"
$log = Join-Path $Out "probe-log.txt"
"ScalePods Tally probe, $(Get-Date -Format s), port $Port" | Out-File $log

function Say($m) { Write-Host $m; $m | Out-File $log -Append }

function Ask([string]$name, [string]$xml) {
    $file = Join-Path $Out "$name.xml"
    try {
        Invoke-WebRequest -Uri $base -Method Post -Body $xml -ContentType "text/xml" -UseBasicParsing -TimeoutSec 180 -OutFile $file
        Say ("OK    {0,-14} {1,10:N0} bytes" -f $name, (Get-Item $file).Length)
    } catch {
        Say ("FAIL  {0,-14} {1}" -f $name, $_.Exception.Message)
    }
}

function Collection([string]$id, [string]$type, [string]$fetch, [bool]$dates = $false) {
    $vars = '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>'
    if ($dates) { $vars += "<SVFROMDATE>$From</SVFROMDATE><SVTODATE>$To</SVTODATE>" }
    return "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>$id</ID></HEADER><BODY><DESC><STATICVARIABLES>$vars</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME=`"$id`" ISMODIFY=`"No`"><TYPE>$type</TYPE><FETCH>$fetch</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
}

# 1. is the port open?
try {
    $r = Invoke-WebRequest -Uri $base -UseBasicParsing -TimeoutSec 15
    Say "PORT OPEN: $($r.Content.Trim())"
} catch {
    Say "PORT CLOSED on $base : $($_.Exception.Message)"
    Say "Turn it on in TallyPrime: F1 Help > Settings > Connectivity > Client/Server configuration > TallyPrime acts as: Both (or Server), Port 9000. Then run this again."
    exit 1
}

# 2. what is loaded (companies, version)
Ask "companies" '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>'
# 3. parties and accounts (names, group, GSTIN) - no balances beyond closing
Ask "ledgers" (Collection "ScalePodsLedgers" "Ledger" "Name,Parent,PartyGSTIN,GSTRegistrationType,StateName,ClosingBalance")
# 4. stock items (tells us whether inventory is kept)
Ask "stockitems" (Collection "ScalePodsItems" "StockItem" "Name,Parent,BaseUnits,ClosingBalance,ClosingValue")
# 5. vouchers for one month with their ledger and item lines (sales invoices carry the heat/plate numbers)
Ask "vouchers" (Collection "ScalePodsVouchers" "Voucher" "Date,VoucherTypeName,VoucherNumber,PartyLedgerName,Narration,Reference,AllLedgerEntries.*,AllInventoryEntries.*" $true)
# 6. outstanding receivables
Ask "receivables" '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Bills Receivable</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>'

Say "Done. Copy the folder $Out back to ScalePods."
