# Plan: mill dispatch mails (inward), challans (outward), HDFC RTGS form

Status: plan only, nothing built, no database changes. Written 10 Nov 2026.
Source material: 13 challan photos (T800–T813, K301–K303), AAA Supports payment-reminder mail PDF, HDFC RTGS/NEFT fillable PDF, Evonith dispatch mails 1/2/3 (pasted text, `noname.txt`, mail PDF, screenshots), stock sheet screenshot, 29 Oct and 5 Nov meeting notes.

## 1. What the material tells us

### Mill dispatch mails (Evonith, forwarded by Mukesh Jain) — INWARD
| Mail | Date | For | Rows | Weight | Truck |
|---|---|---|---|---|---|
| 1 of 3 | 24 Oct | SPF, Taloja | 7 | 24.4 t | OD04W3318 |
| 2 of 3 | 28 Oct | SPF, Taloja | 8 | 33.2 t | MH46BU0932 |
| 3 of 3 | 30 Oct | Sai, Kalamboli | 32 | 32.4 t | MH40CM4431 |

- One table, 33 columns. Needed ones: Cust. Name, Material Desc, SO No./Item (mill order), Thick, Width, Length, Pieces, Quantity (tonnes), Inv.No./Item, Invoice Value, Inv.Date, Batch (= heat/plate no), UPR (rate per tonne), Freight per ton, Cus. Grade, Ship-to, Destination, Trans. Name, Truck No., TC Number.
- Free check: Invoice Value = tonnes × UPR × 1.18 (GST). Held on every row tested.
- Natural unique key per row: Inv.No./Item (e.g. 2601030875/000070). Stops double entry when the same mail arrives more than once.
- One mail can hold several trucks/invoices/TC numbers (mail 3: four invoices, four TC numbers, one truck number).
- Gmail clips the mail body ("Message clipped"). The full table is in the attachment `noname.html` / `noname.txt`. Screenshots are wide (3 horizontal slices) and showed only 6 of 32 rows.
- Mill weight per plate is about 3% above the formula (20 mm plate: 1,010 kg vs 981 kg). The stock sheet's sale rows use about 393 kg per 6 mm plate (balance uses 378), so plate-own weight per piece is the better basis than the formula.
- Live database check: mail 1's 7 heat numbers are in stock (created 27 Oct, sizes match). Mail 2 and mail 3 are not (newest lot 27 Oct). Mail 2's 21585TB1–3 were typed into the sheet by hand on 28 Oct.

### Challan photos — OUTWARD
- Handwritten delivery challans of the yard: From SPF/Sai tick, Plot D15 or 753 pad, V.No (T800–T813 at D15; K301–K303 at 753), date 23–29 Oct, vehicle, order no (mostly blank), lines (grade, nos, size, heat/plate no, "=n" pieces per heat), "Balance" (leftover piece), written total kg, loaded-by names. "To:" mostly blank.
- Photos are rotated 90°, handwriting messy, some overwrites. T804–T807 not supplied.
- 17 of 20 heat numbers tried matched stock with correct grade and size. The 3 misses may be misreads.
- Computed weight within about 2% of written totals on T801 and T813.
- The sheet's SALES block is the same data (date, inv no, V.NO = challan no, size, nos, weight, plot, heat), one row per challan line.

### HDFC RTGS/NEFT form
- One-page fillable PDF, about 33 fields (customer name/account, beneficiary name, account no twice, bank, IFSC, amount in figures and words, remarks, purpose, verify option, RTGS/NEFT tick).
- "Excel output" is not yet defined (see questions).

### Already in the database
Lots (1,916), append-only stock movements (3,173), yards D15 / 753 / 739, `dispatches` and `dispatch_lines` designed for slip → approved reading → stock deducted (0 rows used, `dispatches.order_id` is NOT NULL while `orders` is empty). Document-reading pipeline exists for po / invoice / mtc: intake → classify → read → check in code → match → human confirms → save, original file kept.

## 2. Principle
The app suggests, a person confirms, and only then stock changes (same rule as the document-reading plan). Checks run in code, not by AI. Automatic posting only after weeks of correct reads.

## 3. Build order
1. Mill dispatch reader (inward) — first, so stock for 28–30 Oct plates exists before challans use it.
2. Challan reader (outward).
3. HDFC RTGS form fill.
4. Mail and WhatsApp intake (later, as agreed).

### 3.1 Mill dispatch reader (about 1.5–2 days)
- New document family "mill dispatch".
- Intake order: (1) HTML/text attachment — exact, no AI cost; (2) pasted table — also free; (3) screenshot read by AI — fallback only, cost announced before the run, with a warning if the "Message clipped" line is seen or the row count looks low ("upload the attachment").
- Checks in code: tonnes × UPR × 1.18 = invoice value; duplicate by Inv.No./Item; size sanity; grade known; entity from Cust. Name (SAI vs SPF); yard from Destination (Taloja → D15; Kalamboli to be confirmed).
- Group the receipt by truck/invoice/TC number as one document with consignments.
- Review screen, then on confirm: one lot per row (heat = Batch, permanent internal lot number), receipt movement (pieces, kg = tonnes × 1000), purchase rate from UPR, mill order and invoice references kept.
- Grade names mapped through a small table (mill grade text → our grade), e.g. "SA387 GR11CL2", "SA387 GR22 CL 2", "SA387MGR12CL2", "EVSLAS07 (EVONITH HARD)".

### 3.2 Challan reader (about 3 days, plus 1–2 days for leftovers, duplicate/gap checks, Tally match)
1. Photo uploaded in the app (WhatsApp later). Auto-rotate. AI reads: challan no, date, entity (tick), plot, vehicle, lines, total.
2. Code checks: heat in stock and size matches; pieces not more than available; weight (plate-own weight per piece × pieces) within about 3% of the written total; duplicate challan; missing serial (gap like T804–T807).
3. Review screen with the photo beside the reading; person confirms. Unmatched lines go to a short "fix" list instead of failing the whole challan.
4. On confirm: dispatch + dispatch lines, "sale" movements per matched plate, "Balance" turned into a leftover plate (offcut child lot).
5. Later: match challan to the Tally sales invoice by vehicle and date; feeds the paperwork-gaps list.
- Open design point: `dispatches.order_id` NOT NULL with empty `orders` — relax the constraint or use a placeholder order (decision needed; migration only on explicit approval).
- Test read of the 13 photos with AI costs roughly under $1; announce and confirm before running.

### 3.3 HDFC RTGS form (about 1–1.5 days)
- From a payment row, fill the fillable PDF: beneficiary, account, IFSC, bank, amount in figures and words (Indian style), remarks with invoice number, RTGS or NEFT (RTGS from ₹2 lakh).
- Signatures stay blank. The app only prepares documents and never moves money.
- Excel: either an Excel listing of the same payment fields, or HDFC's own bulk-upload template — needs the answer below.

### 3.4 Mail and WhatsApp intake (later)
- Mail: pick up the Gmail forward from Mukesh Jain; read the attachment, not the clipped body.
- WhatsApp: separate plan after the above.

Total estimate: about 6–7 working days across all of it.

## 4. Questions still open
1. Should mill mails post stock after one tap, like challans? (Recommended: yes, one tap at first.)
2. Grade mapping: "EVSLAS07 (EVONITH HARD)" and "SA387MGR12CL2" → which of your grade names / sheet tabs?
3. Which yard does Sai's Kalamboli stock go to? (Taloja = D15 assumed.)
4. Use the plate's actual weight per piece for sales weight?
5. May mails 2 and 3 be loaded into the live database as the first test (after approval)?
6. Challans: outward and deducting stock for both SPF and Sai? Who is the customer when "To:" is blank (from the invoice only)? Are T804–T807 really missing? OK to use computed weight when only a total is written? Fine with one-tap confirm first?
7. HDFC: Excel listing of the same fields, or HDFC's own bulk template (send it)? Where do beneficiary bank details come from — vendor invoice or a vendor master? Which sender account, do both companies use HDFC?
8. Please send the right Sanjay Srivastav thread if more than the mails above exists; the PDF first attached was the AAA Supports reminder thread.

## 5. Not decided / not done
- No code written, no migration, no data loaded.
- Tally two-company migration (`20261104100000_tally_two_companies.sql`) still waits for an explicit "apply the migration".
