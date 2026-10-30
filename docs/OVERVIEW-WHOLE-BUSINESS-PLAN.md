# Overview page for the whole business ("Janam Kundli"): implementation plan (for approval)

**Date:** 31 Oct 2026 · **Status:** built (31 Oct 2026); the one database change it needs is written but not yet applied (see "Decisions taken")

## What the owner asked for
At the 29 Oct meeting the owner wanted one page that shows the whole business, not only stock: "the Janam Kundli of the business". Today the Overview (`/`) shows stock only (received, sold, left, ageing, grades). Everything else (money, orders, mail, Tally, count, documents) sits behind separate pages.

The solution document already describes this screen as **Home**: "stock value and tonnage per book, ageing stock, pending approvals and follow-ups: the day's status at a glance". It also lists what the Tally screen should show (turnover, top customers, receivables ageing, payables, expenses by head). This plan widens Home to cover every module we have built.

## What we already have (so most of this is assembling, not inventing)
| Area | Data already in the app | Existing code to reuse |
|---|---|---|
| Stock | Stock now, received, sold, plates, grades, ageing, heat map, top sold | `analytics.ts` (`kpis`, `timeline`, `stockByGrade`, `ageing`, `heatmap`), `charts/Charts.tsx` |
| Money (sheets) | Sales, purchases, expenses, customers owe (with ageing bands and late amount), we owe, top debtors, top creditors, expenses by head, monthly sales vs purchases | `payments.ts` `payOverview`, `charts/MoneyCharts.tsx` |
| Orders and dispatch | Open and late orders, orders per month (SPF / SAI), top clients, salespeople, grades, tonnes dispatched per yard (Plot 753, D-15) | `orders.ts` `orderOverview`, `vehiclesOverview`, `charts/OrderCharts.tsx` |
| Mail, leads, quotations | Pending replies (urgent, follow up, new), leads per month, quotations per month, follow-up count, top quoted materials and clients | `mail.ts` `mailOverview` |
| Tally | Connector status and last sync, 4,251 ledgers, 1,814 outstanding bills, 5,221 vouchers, Tally vs sheet receivables and payables | `tally.ts` (`tallyStatus`, `compare`, `partiesList`) |
| Count | Count sessions, plates counted, differences, count-window movements | `queries.ts` (`countSessions`, `reconciliation`) |
| Control | Needs review (108 need a decision, 378 old sheet notes), documents waiting for review, drafts, AI spend today | `reviewList`, `documentsList`, `draftsList`, `aiSpendToday` |
| Mill orders | Mill purchase-order lines still to arrive | `mill-orders/page.tsx` |
| Questions | Digital Brain and AI mode, with starting questions per area | `lib/ask`, `TopSearch.tsx` |

## Proposed page, top to bottom
The page is called **Business overview** (a Hindi line under the title, if the owner likes it: "Poora business, ek nazar mein").

### 1. Headline strip: eight tiles, each a link into its module
| Tile | Shows | Opens |
|---|---|---|
| Stock | Tonnes now, plates, change vs previous period | Plates |
| Customers owe | ₹ total and ₹ late | Receivables |
| We owe | ₹ total and ₹ late | Payables |
| Orders | Open, of which late | Orders |
| Quotations | Open and needing follow-up | Quotations |
| Mail | Pending replies, of which urgent | Mail inbox |
| Needs a decision | Review items, documents, drafts | Needs review |
| Tally | Connected or stale, last sync time | Tally |

### 2. "Needs your attention today": a ranked list (the heart of the page)
One short list that says what to act on, each line a link. Examples:
- 3 orders are past their promised date.
- ₹ X is more than 90 days late, across N customers.
- 5 urgent mails have no reply.
- 12 quotations have had no follow-up for 3 days.
- 108 items wait for a decision in Needs review.
- 2 documents are waiting for review; 2 drafts are open.
- Tally has not synced for 3 days.
- N grades have negative balances.
Rules (the days and thresholds) are settings, not code, as in the solution document.

### 3. Sections, each with 2 to 4 visuals and a "Open the full page" link
| Section | Visuals |
|---|---|
| **Stock** (today's page, moved here) | In vs out by month, stock by grade, ageing, fastest-moving grades; the heat map stays |
| **Money** | Sales vs purchases by month, receivables ageing bands, top 10 debtors, expenses by head |
| **Orders and dispatch** | Open vs late, orders per month by company, tonnes dispatched per yard, top clients |
| **Mail and leads** | Pending replies by state, leads and quotations per month, top quoted materials |
| **Tally** | Connection and last sync, Tally vs sheet debtors and creditors, then turnover by month and top 10 customers from vouchers (phase 2) |
| **Count and control** | Count progress and differences, Needs review split, documents and drafts waiting, mill orders still to arrive |
| **Ask the business** | A question box and 6 starting questions across all areas (opens Digital Brain) |

A sticky mini menu at the top jumps between sections (Stock, Money, Orders, Mail, Tally, Control).

## How it behaves
- **Who sees what.** Same rule as the sidebar: the owner and administrators see everything. Other staff see only Stock and Control, because money, orders and mail hold prices and customer details.
- **Filters.** The period and book filters in the header apply to everything that is a flow (sales, orders, mail). Stock is "as of" the end date. A small SPF / Sai switch is added for the money and order sections.
- **Dates and freshness.** Every section says "as of" its own date (sheets sync, Tally last sync). A stale section shows a banner, never silently old figures.
- **Speed.** Each section loads on its own (the page appears at once, sections fill in). About 30 queries in all, so sections that are far down the page load last. The existing queries already run in 10 to 100 ms.
- **Look.** Same style as today: teal for stock, orange for alerts, light and dark, phone layout, a "view as table" switch on charts, no pie charts.
- **No guessing.** Tiles show "not available yet" when a source has no data. We do not fill gaps with estimates.

## Build steps and effort
| Step | What | Days |
|---|---|---|
| 1 | Page shell: section menu, role gating, per-section loading, "as of" labels | 0.5 |
| 2 | Headline strip and the attention list (a few new small count queries) | 1 |
| 3 | Money, Orders and Mail sections from the existing overview queries and charts | 1 |
| 4 | Count and control section; Stock section moved in unchanged | 0.5 |
| 5 | Tally section: status and Tally vs sheets first | 0.5 |
| 6 | Ask-the-business strip, polish, dark mode, phone, help text, docs | 0.5 |
| | **Total** | **about 4 days** |
| Later | Tally turnover by month and top customers from vouchers (needs the real Tally PC syncing sales vouchers) | +1 |
| Later | One customer view across orders, invoices, mail and Tally ("customer 360"; needs the 589 spellings of client names cleaned up) | separate plan |

## Limits to be honest about
- Money, orders and mail come from the Google Sheets copy. They are only as fresh as the last sheet sync.
- Tally data is the 26 Oct copy until TallyPrime is open on the office PC and "Sync now" runs. Turnover from Tally waits on that.
- We do not yet record won or lost quotations (the solution document wants a manual Won / Lost / No reply tick), so "won" is not shown.
- Client names are spelled many ways, so "top customers" can split one customer into two until names are cleaned.
- Needs review: after the 30 Oct change the tile counts only the 108 that need a decision.

## Decisions taken (31 Oct 2026)
1. **Home page.** The Business overview is the new home page (`/`); today's stock charts are its Stock section, unchanged.
2. **Who sees the money, order, mail and Tally parts: everyone with a staff login** (owner, admin, approver, accounts, sales, office, viewer), not only the owner and administrators. The owner asked for the same view for everyone ("transparent to all the users"). The outside partner role (`partner_rs`) sees none of it. Downloads (CSV / Excel), "Sync now", the sheet view, the raw sheet search and the AI-spend log stay with the owner and administrators.
   - Later, with a login per person, each screen gets a remark "changed by <person>, <when>". The audit trail already records who made every change; only the on-screen remark is still to come.
3. **Title.** English only: "Business overview". No Hindi line.
4. **Company switch.** SPF / Sai / both, in the filter bar; it applies to the money and order parts.
5. **Tally.** Included now. When the Tally PC has not synced, the part says so and shows what was last received.

## What was built
- Headline strip (8 tiles), "Needs your attention today", jump menu, and the parts: Stock, Money, Orders and dispatch, Mail and leads, Tally, Count and control, Ask the business (`web/src/components/overview/`, data in `web/src/lib/business.ts`).
- Every part loads on its own; if one cannot be read, only that part shows a message. At most three overview questions run at once, because the database connections are few.
- The sidebar, the four section gates (orders, payments, mail, Tally), the top search and the AI questions now use one rule, `canSeeBusiness` (`web/src/lib/auth.ts`), which mirrors the database rule `app.is_internal()`.

## To finish
- **Apply `supabase/migrations/20261031100000_business_data_for_all_staff.sql`.** It switches the sheet views and the Tally tables from "administrators only" to "every staff login" and adds `tally_connector_state()` so the connector's key hash stays private. Until it is applied, only the owner and administrators see data on these parts; other logins see empty figures (today only the administrator account is linked, so nobody is affected).
- Look at the expense list once before staff logins are created: it is now visible to everyone.
