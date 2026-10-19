# Sheet migration report: what is in Supabase and what is still in Google Sheets

**As of 19 October 2026** · Checked tab by tab against the live database and the app at https://sambhav-stock.vercel.app

## 1. Headline

- **12 workbooks received, 98 tabs in total.**
- **2 of 12 workbooks are migrated:** the two stock books, WB1 and WB2. They are loaded into Supabase and shown in the app.
- **19 of 98 tabs are loaded** (the 4 small WB1 tabs were added on 19 Oct). Another 2 (the two Summary tabs) are used only to check the loaded figures.
- **10 workbooks are not migrated yet.** For those, the Google Sheets are still the working system. Nothing has been switched off.
- This matches the plan. Stage 1 is stock and the physical count. Orders, mail, payments, Tally and the rest come after the count.

| Measure | Loaded in Supabase |
|---|---|
| Plates (lots) | 1,833 (WB2 582, WB1 1,251) |
| Stock movements | 2,916 |
| Every row traceable to its sheet, tab and row | Yes (1,833 references) |
| Items sent to review because the sheets could not settle them | 450 |
| Mill PO lines / vehicle weights (WB1 Incoming, Corten) | 28 lines in 7 POs / 4 weights, on the new Mill orders page |
| Orders, dispatches, invoices, quotations, mail, parties, certificates, Tally | **0 rows. Tables are designed but empty** |

Legend: ✅ loaded and shown in the app · 🔎 used to check figures only · ⏳ not migrated yet · ➖ empty or dead, nothing to migrate · 🚫 do not migrate

---

## 2. Workbook by workbook

### 1. WB2: `STOCK SPF & RS` (stock book 2): **✅ migrated**
| Tab | Rows | Status | Notes |
|---|---|---|---|
| SA 537 | 121 | ✅ | |
| 690 QL | 267 | ✅ | 35 rows have no certificate link; question open |
| ROCKSTAR 400 | 439 | ✅ | |
| ROCKSTAR 500 | 208 | ✅ | |
| Summary | 92 | 🔎 | Balances reconciled against the loaded stock. The app's Summary page replaces it |

### 2. WB1: `STOCK IMS Admin` (stock book 1): **✅ migrated (all data tabs)**
| Tab | Rows | Status | Notes |
|---|---|---|---|
| GR. 11 | 379 | ✅ | |
| GR 11 AJ | 229 | ✅ | |
| GR. 22 | 391 | ✅ | |
| GR 22 - AJ | 149 | ✅ | |
| 16M03 | 321 | ✅ | |
| GR. 12 W | 400 | ✅ | |
| GR. 5 | 103 | ✅ | |
| GR. 9 | 32 | ✅ | |
| GR. 91 | 169 | ✅ | |
| A36 | 168 | ✅ | |
| SA 516 GR 70 | 24 | ✅ | |
| Summary | 167 | 🔎 | Its typed balance is about 170–200 t below the rows. The app computes the balance from the rows instead |
| MIX GRADE | 39 | ✅ plates only | 16 plates loaded (15,031.6 kg with the Mn plates; 14 have no heat number, so internal tags NOID-MIX-001 to 014). 20 pipe, fitting and angle rows have no weight and are listed in one review item, not in stock. The right-hand SA 516 GR 70 block duplicates the SA 516 tab and was skipped. One sample-cut row was skipped |
| MANGANESE PLATE | 17 | ✅ | 8 plates at Plot 739, 6,621 kg opening stock; no heat numbers, so tags NOID-MN13-001 to 008. Plot 739 is not a known yard: added and flagged to confirm |
| Incoming | 37 | ✅ | 28 PO lines in 7 POs on the new Mill orders page (reference only, not stock). The invoice blocks on this tab are headers only, and there is no data for the Sai and Salzgitter blocks |
| Corten (hidden) | 7 | ✅ | 4 vehicle weights from June 2025 on the Mill orders page (reference only) |
| Statistics | 2 | ➖ | Empty |

### 3. `DISPATCH 26-27` (vehicle and outward register): **⏳ not migrated**
| Tab | Rows | Status | Notes |
|---|---|---|---|
| APR, MAY, JUN, JUL, AUG | 63 / 54 / 63 / 79 / 52 | ⏳ | 297 lines, about 971 t |
| SEP to MAR | 7 each (headers only) | ➖ | Empty |
| 26-27 (summary) | 14 | ⏳ | |

Goes to the Orders and dispatch module. This is probably the live register since August. It has no customer and no plate number, so the "no plate, no dispatch" rule will fix that going forward.

### 4. `Dispatch FMS`: **⏳ not migrated**
| Tab | Rows | Status | Notes |
|---|---|---|---|
| FormResponses | 2,739 | ⏳ | Order form entries: 2,737 lines, 828 orders |
| Dispatch | 4,038 | ⏳ | |
| Complete | 2,043 | ⏳ | |
| 25-26 (hidden) | 1,529 | ⏳ | Last year, history only |
| Customer Code | 0 | ➖ | Empty |
| Sheet2 (hidden) | 2 | ➖ | Empty |

Goes to Orders and dispatch (Jan–Feb). The Apps Script code has been reviewed (`data/apps-script/CODE-REVIEW.md`).

### 5. `Spf - Payment Better`: **⏳ not migrated**
| Tab | Rows | Status | Notes |
|---|---|---|---|
| Spf Inv (hidden) | 1,542 | ⏳ | Sales invoices |
| Pur Inv (hidden) | 1,401 | ⏳ | Purchase invoices |
| Spf Exp (hidden) | 381 | ⏳ | Expenses |
| Gpay Res (hidden) | 224 | ⏳ | |
| Gpay | 233 | ⏳ | |
| M Pur | 639 | ⏳ | Market purchases |
| M Sale | 287 | ⏳ | Market sales |
| Brokerage | 58 | ⏳ | |
| Exp | 83 | ⏳ | |
| Reminders | 14 | ⏳ | |
| Summary | 18 | ⏳ | The SPF Summary is missing ₹1,24,60,127 of sales; the migration corrects it |

### 6. `Sai - Payment Better`: **⏳ not migrated**
| Tab | Rows | Status | Notes |
|---|---|---|---|
| Sai Inv (hidden) | 507 | ⏳ | |
| Pur Inv (hidden) | 310 | ⏳ | |
| Sai Exp (hidden) | 83 | ⏳ | |
| M Pur | 550 | ⏳ | |
| M Sale | 56 | ⏳ | |
| Market S | 2 | ➖ | Nearly empty |
| Brokerage | 42 | ⏳ | |
| Exp | 10 | ⏳ | |
| Summary | 15 | ⏳ | |

### 7. `Form Response Sheet` (the raw forms behind Payment Better): **⏳ not migrated**
| Tab | Rows | Status |
|---|---|---|
| Spf Pur | 1,415 | ⏳ |
| Spf Inv | 1,557 | ⏳ |
| Sai Inv | 508 | ⏳ |
| Sai Pur | 310 | ⏳ |
| Spf Exp | 388 | ⏳ |
| Sai Exp | 84 | ⏳ |
| Local Gadi | 501 | ⏳ |
| Gpay | 224 | ⏳ |
| Exp | 83 | ⏳ |
| Help Slip | 26 | ⏳ |
| D15 Plot | 9 | ⏳ |
| Feedback | 3 | ➖ |

These feed workbooks 5 and 6. The same data sits in two places, so the migration must pick one source and remove the duplicate. Known issues: 58 SPF and 14 Sai invoice numbers entered twice; weight and rate filled on only 36 of 1,414 purchase rows.

### 8. `Document Tracker`: **⏳ not migrated**
| Tab | Rows | Status | Notes |
|---|---|---|---|
| Spf Docs | 1,678 | ⏳ | Invoice-to-documents steps. Each step is filled on only 35–43% of rows |
| Sai Docs | 47 | ⏳ | |
| PENDING DOCS | 14 | ⏳ | |
| Spf Inv (hidden) | 1,542 | ⏳ | Duplicate of the invoice list |
| SAMBHAV MAIL | 9 | ➖ | Effectively dead |
| SAGAR MAIL TRACKER | 2 | ➖ | Effectively dead |

Goes to Orders and dispatch (document steps and courier tracking).

### 9. `Sambhav Pipes Email Tracker`: **⏳ not migrated**
| Tab | Rows | Status | Notes |
|---|---|---|---|
| Pending | 1,844 | ⏳ | About 127 look like newsletters |
| Quotation Tracker | 1,235 | ⏳ | Becomes the quotation module's history |
| Client Master | 796 | ⏳ | 793 are graded C; to be merged by GSTIN or name |
| Archive | 1,397 | ⏳ | |
| Done | 161 | ⏳ | |
| Orders Won | 3 | ⏳ | |
| Ignored | 2 | ⏳ | |
| Settings | 23 | ⏳ | |
| Dashboard | 19 | ⏳ | Replaced by the app dashboard |
| Sheet1 | 0 | ➖ | Empty |

Goes to the Mail tracker and quotation module (Dec–mid Jan). It needs the quotation template, the Sparkon `.eml` and the mailbox access.

### 10. `Indiamart Enquiries V2 FINAL`: **⏳ not migrated**
| Tab | Rows | Status | Notes |
|---|---|---|---|
| Enquiries | 3,917 | ⏳ | 18 Jun 2024 to 12 Oct 2026, no duplicate ids |
| Emailed | 6 | ⏳ | |
| CEOITBOX | 6 | ⏳ | Third-party add-on that pulls the leads |
| Settings | 10 | 🚫 | Holds the live IndiaMART key in plain text. **Do not migrate; rotate the key** |

Goes to the Mail tracker and quotation module.

### 11. `LOCAL GADI (Responses)`: **⏳ not migrated**
| Tab | Rows | Status |
|---|---|---|
| Res | 501 | ⏳ |
| 24-26 | 345 | ⏳ |
| 26-27 | 155 | ⏳ |

Local vehicle log. Goes with Orders and dispatch costs.

### 12. `Budgeting & Cost Cutting`: **⏳ not migrated**
| Tab | Rows | Status | Notes |
|---|---|---|---|
| Sheet1 | 61 | ⏳ | About 35 expense heads by month against a benchmark |
| Sheet2 | 61 | ⏳ | Text-formatted rupees, with a "checking" column |

It is a manual copy from Tally. It will be replaced by the Tally read-only feed plus a budget-versus-actual screen.

---

## 3. Summary

| Workbook | Tabs | Migrated | Where it goes | When |
|---|---|---|---|---|
| 1. WB2 Stock SPF & RS | 5 | 4 + 1 check | Stock ledger | **Done** |
| 2. WB1 Stock IMS Admin | 17 | 15 + 1 check (Statistics is empty) | Stock ledger, Mill orders page | **Done** |
| 3. DISPATCH 26-27 | 13 | 0 | Orders and dispatch | Jan–Feb |
| 4. Dispatch FMS | 6 | 0 | Orders and dispatch | Jan–Feb |
| 5. Spf Payment Better | 11 | 0 | Payments, invoices | Feb onwards |
| 6. Sai Payment Better | 9 | 0 | Payments, invoices | Feb onwards |
| 7. Form Response Sheet | 12 | 0 | Orders, payments (the raw inputs) | Jan–Feb |
| 8. Document Tracker | 6 | 0 | Orders and dispatch (paperwork) | Jan–Feb |
| 9. Email Tracker | 10 | 0 | Mail tracker and quotations | Dec–mid Jan |
| 10. IndiaMART Enquiries | 4 | 0 | Mail tracker and quotations | Dec–mid Jan |
| 11. Local Gadi | 3 | 0 | Orders and dispatch costs | Jan–Feb |
| 12. Budgeting & Cost Cutting | 2 | 0 | Tally feed and budget screen | Feb onwards |
| **Total** | **98** | **19 (+2 check)** | | |

## 4. Before the sheets can be switched off
For each workbook, switching off needs all of these:
1. The module is built and loaded.
2. The totals tie to the sheet, with the differences listed.
3. The staff have used it.
4. Edit access to the old sheet is removed and it becomes a read-only copy. This needs the named owner for the cutover (open question).

For stock, steps 1–2 are done. Step 3 is the 2–6 Nov trial and the count. Step 4 follows after the count closes.

## 5. Things to settle on the call
- The four small WB1 tabs are now loaded. Ask HJ to confirm: (a) Plot 739, (b) the heat or plate numbers for the 22 plates that have none (tagged NOID-...), (c) the grade of the 6 plates the sheet marks "NO", (d) what to do with the pipes and fittings in MIX GRADE.
- The count: the dates are still missing (see PROJECT-STATUS-AND-OPEN-QUESTIONS).
- Fresh exports of all workbooks: our copies are from 8–12 Oct and the sheets keep changing.
- A reminder about the two security items (IndiaMART key, order form).
- An empty test count ("Physical count November 2026") exists in the database, closed with no entries. The real count will be opened new.
