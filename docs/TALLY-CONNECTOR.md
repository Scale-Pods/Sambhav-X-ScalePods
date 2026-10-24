# Tally connector (read-only)

**Status (24 Oct 2026):** built and tested against a pretend Tally and against the real master files from Sambhav's Tally. Not yet installed on the office PC.

## What it does
A small PowerShell script on the Tally PC reads TallyPrime through its local XML port (9001 for Sambhav) and sends the result to our database over HTTPS. Outbound only. It never writes to Tally and installs no software.

```
TallyPrime (office PC, port 9001) --> tally-connector.ps1 --HTTPS--> Supabase functions (tally_ingest_*) --> tally_* tables --> app screens
```

| Piece | Where |
|---|---|
| Connector, install and uninstall scripts | `tools/tally/connector/` |
| Database side (tables, key check, upload functions) | `supabase/migrations/20261024120000_tally_connector.sql` |
| Test tools (pretend Tally) | `tools/tally/connector/mock_tally.py` |
| Package for the PC (holds the secret key, git-ignored) | `python tools/tally/connector/make_package.py` → `data/tally-connector-package/` |

## Modes
- `Sync` (daily at 13:00 and 17:30, office hours; a missed time runs when the PC is back): ledgers, stock items, outstanding bills, and vouchers. The first run reads the whole financial year; later runs read the last 45 days plus future-dated entries to the year end.
- `Check` (every 5 minutes): tells the app this PC is alive; if someone pressed "Sync now" it runs a sync.
- `Detect`: finds the date format this Tally accepts (the real Tally ignored `yyyymmdd` and answered with its default day).
- `Replay -Folder`: sends saved XML files (testing, or a manual fallback when the PC cannot reach the internet).

## Safety
- The key is 58 random characters. Only its SHA-256 is in the database; the key is in `config.json` on the PC and in `data/secrets/` here.
- The upload functions accept data only with the key and write only to the `tally_*` tables. Without the key they return "Invalid connector key" (tested). The tables cannot be read by the public.
- A chunk of vouchers whose dates fall outside the dates asked for (Tally ignoring the dates) is rejected, not stored.
- A voucher that Tally stops returning inside a window we read is **marked deleted, never erased**.
- Balances are stored debit-positive (a customer who owes us is positive).

## Tested
- Windows PowerShell 5.1 (the version on the PC), full sync of 4,241 ledgers, 1,175 stock items, bills and about 125 made-up vouchers in about 40 seconds; re-running changes nothing.
- Failure paths: Tally switched off, and Tally understanding no date format. Both report to the app and stop cleanly.
- "Sync now" request picked up and completed; the scheduled check task fired by itself.
- Real Sambhav masters are loaded: Tally's net debtors **₹16.02 crore** against **₹15.99 crore** pending receivables in the sheets (SPF), within 0.2%.

## Still to confirm on the real PC
1. Which date format Tally accepts (run `-Mode Detect`). If none works, the Collection method with a date filter is the next thing to try.
2. Where heat and plate numbers sit on a sales invoice (the five sample invoices): voucher item description or batch name, which are already kept.
3. Voucher field names for e-invoice (IRN) and ALTERID on this release.

## Next (app side)
A Tally page: last sync and status, a Sync now button, and the comparisons Tally against the sheets (bills missing on either side, amounts that differ), receivables and payables against Tally.

## Voucher amounts and the Dump mode (24 Oct 2026)

- The real Tally lists each ledger line twice (under `ALLLEDGERENTRIES` and `LEDGERENTRIES`). The connector first added both lists, so a voucher's amount came out doubled (invoice 730/26-27: 40,99,414.40 instead of 20,49,707). It now takes one list, ignores the sales/purchase split inside item lines when the voucher has ledger lines, and sets the amount to the party's ledger line (the invoice total), or the debit total when there is no party. A sync overwrites the old rows, so one run after the new script is installed corrects every voucher.
- `-Mode Dump -VoucherNo "730/26-27" -From 20261009` saves that one voucher with every field we know to ask for to `logs\dump-730-26-27.xml` and lists the fields that look like IRN, e-way bill, HSN, vehicle, order and dispatch. It only reads Tally and sends nothing. We use it to find the real field names before storing those fields.

