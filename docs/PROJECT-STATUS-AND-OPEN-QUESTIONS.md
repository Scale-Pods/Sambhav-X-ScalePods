# Sambhav X ScalePods: progress and open questions

**As of 19 October 2026** · Live app: https://sambhav-stock.vercel.app (login only)

---

## 1. Overall progress

Roughly **one third of the whole project by effort**. **Stage 1 (stock ledger and the physical count) is about 90% built**; the other modules start after the count.

| Area | Status | Notes |
|---|---|---|
| Database: stock ledger, approvals, audit trail, security | **Done, live** | Append-only; every change goes through a checked function; role-based access |
| WB2 loaded | **Done** | 582 lots |
| WB1 loaded | **Done** | 1,809 plates in total across both books; each row traceable to its sheet tab and row |
| Login and roles | **Done** | Admin account `info@scalepods.co`; staff logins wait on the email list (Q5) |
| Overview, Summary, Plates, plate history | **Done** | Charts; filters (today, 7/15/30/90 days, month, FY, custom range, book, grade, thickness, kg/tonnes); CSV export for owner/admin |
| Needs-review list | **Done** | 444 items the sheets could not settle, nothing changed silently |
| Light/dark mode, fonts, logos | **Done** | Option C design |
| Physical count screen | **Done** | Each plate saved with who, when and yard; instant matches/differs check |
| Count-window mode | **Done** | Log what moves during the count; opening stock worked back per plate; reconciliation table and CSV |
| Count closing: differences to approval and correcting entries | **Not built yet** | Next piece, needed before 30 Nov |
| Mail tracker (10 mailboxes) and quotation module | Not started | 18–22 days; needs template, `.eml` and mailbox access |
| One ID enquiry to cash (3.1) | Not started | 3–4 days |
| Carrying cost on lots (3.2) | Not started | 2 days; the rate is already stored as a setting |
| Certificate vault (3.3) | Not started | 8–10 days; more than 1,000 certificate links already preserved in the data |
| WhatsApp inbox (3.4) | Not started | 10–12 days, plus Meta approval 1–2 weeks |
| Orders and dispatch | Not started | Needs the no-plate-no-dispatch rule |
| Payments | Not started | |
| Tally read-only link | Tables ready; connector not built | Waiting on T1–T14 and sample exports |
| GST check | Not started | |
| Ask the business (3.5) | Not started | 6–8 days, after 3.1 |

**Not yet tested by a real user:** the signed-in screens, especially the count and count-window pages. The calculations were proven on real plates in trial runs that saved nothing. We want the two trial staff to use them 2–6 Nov.

**Finding to raise with HJ:** the typed balance on the WB1 Summary is about **170–200 tonnes below** WB1's own purchases minus sales. This is the drift the count is meant to settle.

---

## 2. The urgent question: physical count dates

**Why it is urgent.** The count has to finish before **30 Nov 2026**. Everything is planned backwards from it:

| Date | Step |
|---|---|
| by 30 Oct | System ready (count-window mode done, logins ready) |
| 2–6 Nov | Trial with two staff |
| ~7–13 Nov | Diwali closure and buffer |
| 14–15 Nov | Dry run on one yard |
| 16–28 Nov | Real count |
| by 30 Nov | Count closed, report, differences to approval |

We asked for the dates by **16 Oct**; they are now overdue. If the count starts before 16 Nov, the trial, dry run and buffer shrink.

**What we need to know**
1. Start date and end date of the count.
2. Who counts, and how many people.
3. Which yards: Plot 753 and Plot D-15.
4. Does the yard keep selling during the count? (Round 6 says yes. We built for that.)
5. Diwali and other closure dates.
6. Is the date flexible, and if not, what fixes it (audit, year-end, mill deadline)?

**Message to send HJ**

> Hi HJ, one thing we need this week: the physical count dates. Please send (1) the start and end date, (2) who will count and how many people, (3) which yards, (4) your Diwali closure dates. The count must close before 30 Nov, and the trial with two of your staff has to happen before it. Our system is ready for the count now. Without dates we can't book the trial or the dry run.

---

## 3. Questions still open, one by one

### A. Needed this week (count)
| # | Question | Who |
|---|---|---|
| 1 | Count dates, who counts, which yards, Diwali closure (section 2) | HJ / office |

### B. Needed by 24 Oct
| # | Question | Why we need it |
|---|---|---|
| 2 | Names of **two staff for the trial** (we suggest one from sales and one from the office, for example Arya and Khushi) | No-training acceptance test, 2–6 Nov |
| 3 | Names of the **approvers** for purchases, offcuts and stock adjustments, and who covers when they are away | Differences from the count go to them |
| 4 | **Email addresses for staff logins**, HJ first (HJ will be added as owner) | Logins |
| 5 | **Coil to plate:** which grades arrive as coil, who converts, and does the plate keep the coil's heat number? | The sheets show "COIL convert" in the notes; a coil-to-plate flow must exist before the count |
| 6 | **Match key** (heat or plate number) for Salzgitter, Acroni and market purchases. What do the suffixes **SC1 / SC2 / SC3** mean (sub-lots of one heat)? | Correct matching of purchases to sales |

### C. Older questions for HJ, still open
| # | Question |
|---|---|
| 7 | **Entity rule:** how do we decide whether a plate or sale belongs to SPF, Sai or RS? |
| 8 | **Certificates:** which certificate travels with a sale, and when is IBR needed? |
| 9 | What do **U** and **W** stand for in the WB1 grade tabs (for example `GR. 12 W` shows as "GR 12 U")? Why did the AJ tabs once show Ridhi Siddhi material? |
| 10 | **Who performs each dispatch step**, from order to documents? |
| 11 | **GSTINs** for each entity |
| 12 | **690 QL:** 35 rows added after 3 Aug have no consignment MTC link. Why? |
| 13 | Two **future-dated sales** look like typos (they add 12,060 kg to "as of today"). What are the correct dates? |
| 14 | The WB1 Summary gap of 170–200 t (section 1). Does anyone know a reason beyond hand-typed balances? |
| 15 | **Confirm the proposed defaults** if not already approved: density 7.85 (the sheets use 8.0), carrying cost 1.5% a month, weight tolerance warn above 2% and route above 5% to a named approver, with the stored reason |

### D. Needed before December (mail and quotations)
| # | Item |
|---|---|
| 16 | **Quotation template file**, plus 3 sent PDFs |
| 17 | **Sparkon mail of 13 Oct as `.eml`** (Gmail: ⋮ → Download message). It is the acceptance test: 11 correct lines |
| 18 | **Mailbox access for the 10 accounts**; we send exact steps and no passwords go by chat. The Google Workspace admin step is on hold |
| 19 | **Fresh exports of the nine workbooks**, and the export date of each file they hold |
| 20 | **One named person** at Sambhav who owns the cutover step: when a module goes live, edit access to the matching old sheet is removed |

### E. Tally questions (T1–T14, needed in December)
Already answered: **T1** TallyPrime 6.1/6.2, 7.2 update available, Gold (multi-user).

| ID | Question |
|---|---|
| T2 | The server: Windows version, physical or virtual, hours it is on, Tally open with the company loaded, who logs in, how we get in for setup (in person, RDP, AnyDesk) |
| T3 | List of Tally companies and which entity each holds; data folder and size; financial-year setup; vouchers per year |
| T4 | Is inventory kept? Item invoice or accounting invoice? Where do heat/plate numbers appear on a sales invoice? **Five real examples** |
| T5 | Is the XML/ODBC port enabled, and on which port? Is a firewall in the way? |
| T6 | Is Tally security on? Can a dedicated read-only user be created? |
| T7 | Outbound internet from the server OK? Who approves a small background service? |
| T8 | Which financial year to load from? Anything to add or exclude (for example RS)? |
| T9 | **Sample exports:** one month of Day Book, Sales and Purchase Registers, Receivables and Payables ageing, ledger list with GSTIN, stock summary, trial balance, and one sales voucher as XML and as a printout |
| T10 | A test copy of one company (a restored backup or a trimmed test company) |
| T11 | Are party GSTIN, HSN, place of supply and e-invoice IRN stored on vouchers? What is Webtel, and which tool makes the IRN? |
| T12 | Name and hours of the accounts person for a one-hour setup, and the Tally partner contact |
| T13 | How is Tally backed up, and by whom? Any plan to upgrade or move it? |
| T14 | Does Tally record the salesperson anywhere? |

### F. Two security actions for now
| # | Action |
|---|---|
| 21 | **Rotate the IndiaMART key.** It sits in plain text in the IndiaMART sheet. Regenerate it, and don't put the new one in a sheet |
| 22 | **Lock the order dispatch form.** At the moment anyone with the link can submit an order, upload files to their Drive and send mail from their account. Restrict it to people in sambhavpipes.com |

---

## 4. From ScalePods' side

| Item | Status |
|---|---|
| Fill in prices (day rate; per-item prices for the quotation module and 3.1–3.5) in the Round 6 reply | Open |
| Send the Round 6 reply (10 answers, dates, requests) | Draft ready, `data/REPLY-ROUND-6-DRAFT.md` |
| Supabase settings: Site URL, disable sign-ups, minimum password length 10 | Open |
| Consider a paid Supabase tier before the count (backups) | Open |
| Count closing: differences to approval and correcting entries | Next build |
| Possibly regenerate the dark logo (a smudge on the "T") | Optional |

## 5. Suggested order from here
1. HJ sends the count dates and the answers in section B.
2. We build count closing: differences to approval and correcting entries.
3. Trial count with two staff, 2–6 Nov; fix what they find.
4. Count 16–28 Nov; close by 30 Nov.
5. Then mail tracker and quotations, Tally, orders and dispatch, WhatsApp, certificates.
