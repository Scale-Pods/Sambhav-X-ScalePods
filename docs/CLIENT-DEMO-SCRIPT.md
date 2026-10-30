# Client call: how to run the demo (about 20 minutes)

Live link: https://sambhav-stock.vercel.app · login: info@scalepods.co (admin)

**Before you share your screen:** open the site once and sign in, so the first page isn't slow (the site sleeps when idle; the first load can take about 10 seconds). Use light mode, full-screen the browser.

---

## 1. Say this first (1 minute)

"We have studied all 12 of your sheets, 98 tabs. Stage 1 is stock and the physical count, because the count has a hard date of 30 November. So we built the database and the app for stock first, loaded both stock books, and the other 10 sheets follow after the count. Today I'll show what is live."

## 2. The big picture (2 minutes, say it, don't click)

| Layer | What it is | Why it matters to them |
|---|---|---|
| **Database** (Supabase) | One source of truth. 65 tables designed for the whole business: stock, orders, dispatch, invoices, mail, quotations, Tally, WhatsApp | The sheets stop disagreeing with each other |
| **Safety** | Every table locked by role. Nobody can edit history: changes are new entries, each with who and when. A full audit trail | "No more silent overwrites" |
| **App** (live on the web) | Login, charts, plates, count, review list | Works on a phone or a PC |
| **Old sheets** | Untouched. Nothing is switched off yet | No risk during the move |

## 3. Walk through the app (12 minutes)

1. **Overview** (home). Point at the cards: stock now, received, sold, plates, items needing review. Show a chart. Change the period (7 days, 30 days, custom range). Switch Tonnes to kg. Switch Both books to WB1.
   *Say:* "Every filter works on every page, and the link can be shared."
2. **Summary.** The same numbers as their Summary tab: opening, received, sold, closing. Show the Excel download (same layout as the screen; a plain CSV is also there).
   *Say:* "Your typed Summary balance on WB1 is about 170 to 200 tonnes below what the rows add up to. This one is calculated from the rows, so it can't drift."
3. **Plates.** Search a heat number. Open one plate: full history, every receipt and sale, the certificate link opens the real file.
   *Say:* "Every row traces to your sheet, tab and row."
4. **Needs review.** 450 items the sheets could not settle. Nothing was fixed silently.
   *Say:* "These are your sheet's problems, listed. A person decides each one."
5. **Physical count.** Show the screen, the Moves-during-count tab and the Reconciliation tab.
   *Say:* "The yard keeps selling during the count. Staff log what moves, with a plate number and a time. The system works back to the opening stock. Nobody does the sums."
   *Don't* open a real count on the live site unless you want a test entry in the database. Show the screens and explain; an empty closed test count already exists.
6. **Mill orders.** The two small WB1 tabs, now loaded.
7. **Dark mode** (the toggle, bottom of the sidebar or the header). A quick wow.

## 4. What is done (1 minute)

- 12 sheets analysed, 98 tabs.
- **2 of 12 loaded:** both stock books (WB1 and WB2): 1,833 plates, 2,916 movements, 19 tabs.
- Database designed for the whole business, security and audit trail in place.
- App: login, overview with charts, filters, summary, plates, count with count-window mode, review list, dark mode, CSV export.

## 5. What is pending (2 minutes)

| Item | When |
|---|---|
| Close a count: differences to approval, correcting entries | Next, before 30 Nov |
| Trial count with two of your staff | 2–6 Nov |
| Mail tracker and quotations (Email Tracker and IndiaMART sheets) | Dec to mid Jan |
| Orders and dispatch (Dispatch FMS, Document Tracker, Local Gadi) | Jan to Feb |
| Payments, Tally read-only link, GST check (Payment Better sheets, Budget) | Feb onwards |
| Certificate vault, WhatsApp inbox, "ask the business" | Jan to Feb and later |

## 6. What we need from them (2 minutes). This is the close.

1. **Physical count dates** (start, end, who counts, which yards, Diwali closure). *Overdue; blocks the trial and the dry run.*
2. Two staff names for the trial, and the approvers.
3. Staff emails for logins (HJ first).
4. Coil to plate answers, and the match key for Salzgitter, Acroni and market purchases.
5. Plot 739 (new yard in the Manganese tab) and the heat numbers for the 22 plates that have none.
6. Quotation template, the Sparkon `.eml`, mailbox access, Tally answers T1–T14, fresh exports.
7. **Two security actions now:** rotate the IndiaMART key; lock the order dispatch form.

## If they ask

- **"Can staff use it on a phone?"** Yes, it works on a phone; the count screen is built for it.
- **"Can the old sheets be switched off?"** Not yet. Each sheet goes read-only only after its module is live and its totals tie. We need one named person at Sambhav to own that step.
- **"Is the data safe?"** Locked by role, no direct edits, every change recorded with who and when, daily backups on the paid plan (we recommend upgrading before the count).
- **"Is the data real?"** Yes, loaded from their 8 Oct copies. The sidebar says "Practice data" because it hasn't been counted yet.
- **"Why not do everything at once?"** The count has a fixed date. Stock first, the rest in the order that follows.
