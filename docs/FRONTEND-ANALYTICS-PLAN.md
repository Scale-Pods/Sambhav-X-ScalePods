# Charts and filters: implementation plan (for approval)

## What the data can support
- **Dates we have:** each plate's receipt date, and each sale's date. Purchases run from 2017 (old stock still on hand), and the data is busiest from Dec 2025 onwards: 250–490 t a month in, 150–440 t a month out.
- **Data issues that affect date filters:**
  - The sheets stop around 8 October, so "Last 7 days" will look nearly empty until live entry starts. That's expected.
  - A few sales carry typing-error dates: one in 2006, and two in Nov / Dec 2026, which is in the future. They are on the Needs-review list.
  - The charts mark these dates rather than hiding them.
- **Speed:** the database already has date indexes, and a filtered summary takes about 10 ms. No new infrastructure is needed.

## 1. One filter bar, the same on every page
A filter bar sits under the page title, and the header's "FY 2026-27" pill becomes the date picker.

| Filter | Options |
|---|---|
| **Period** | Today · Last 7 / 15 / 30 / 90 days · This month · Last month · This FY (Apr–Mar) · Last FY · All time · **Custom** (from date to date) |
| **Stock book** | All · WB1 · WB2 |
| **Grade** | Searchable multi-select (e.g. SA 387 GR 22 CL2 + 16M03) |
| **Thickness** | From / to mm |
| **Units** | Tonnes / kg |

- **Filters live in the page address.** A filtered view can be bookmarked or shared, and the browser's Back button works.
- **Filters carry across pages.** Moving between Overview, Summary and Plates keeps the same period and book.
- **Clear all** resets everything in one click, and active filters show as removable chips.

## 2. Overview: charts chosen for this data

| # | Chart | Why this form |
|---|---|---|
| 1 | **KPI tiles**: stock now, received in the period, sold in the period, plates in stock, needs review. Each shows a ▲▼ change against the previous period | The five numbers HJ asks first |
| 2 | **In vs out by month**: grouped bars (received / sold), with closing stock as a line | Shows whether stock is building up or running down |
| 3 | **Stock by grade**: horizontal bars, top 10 plus "others". Click a bar to open that grade's plates | Grade names are long; horizontal bars keep them readable |
| 4 | **Stock ageing**: one stacked bar in day bands (0–30, 31–90, 91–180, 181–365, over a year), in tonnes | Shows old stock tying up money; later feeds carrying cost |
| 5 | **Fastest-moving grades in the period**: horizontal bars of tonnes sold | What to reorder |
| 6 | **Grade × thickness heat map**: tonnes left in each grade and thickness cell | Where the stock actually sits, in one glance |
| 7 | **Latest sales**: the existing table, now following the filters | Detail behind the charts |

- **Look:** charts follow the option C style (teal for stock, orange for sales and alerts) in light and dark mode.
- **Tooltips:** every chart shows exact figures on hover.
- **Accessible view:** every chart has a "view as table" switch.
- **No pie charts:** with 20+ grades, bars are far easier to read.

## 3. Summary: two views
- **Sheet view.** The current layout, with grade and thickness against purchased, sold and balance. The figures are "as of" the end of the chosen period.
- **Period view.** A stock statement for the chosen dates:
  - Columns: **opening stock** (on the start date), **received in period**, **sold in period**, **closing stock** (on the end date), and plates left.
  - Grade subtotals, and a total row.
- **Export:** "Download as Excel / CSV" exports exactly what is on screen.

## 4. Plates: full filtering
- **Date filter:** choose what the dates apply to, either **received** or **sold**, plus all the filters from section 1.
- **More filters:** in stock / sold out / sold more than received; has a certificate link / none.
- **Table controls:**
  - Sort by any column (received date, weight left, thickness, grade).
  - Show 25, 50 or 100 rows per page.
  - Download as CSV.

## 5. Needs review
Adds a date filter and a grade filter on top of the type filter it already has.

## Build steps and effort

| Step | What | Days |
|---|---|---|
| 1 | Filter bar, date presets, custom range, filters in the address | 1 |
| 2 | Date-aware queries ("stock as of a date", in / out per period, ageing) | 0.5 |
| 3 | Overview charts (items 1–7) | 1.5 |
| 4 | Summary period view, heat map, export | 1 |
| 5 | Plates filters, sorting, page size, export; Review filters | 0.5 |
| 6 | Polish: empty states, chart loading skeletons, phone layout, dark mode, table view | 0.5 |
| | **Total** | **≈ 5 working days** |

- **Charts are built with Recharts**, an established, open-source React charting library. They are themed to our colours, and the data is prepared on the server, so pages stay fast.

## Decisions for you
1. **Default period** when a page opens. **Recommend "This FY"**, because the data is a snapshot to 8 Oct.
2. **Default unit.** **Recommend tonnes,** with kg on hover and in tables.
3. **Who may download CSV / Excel.** **Recommend owner and administrator only**, because exports take data outside the system.
4. **Overview vs a separate Analytics page.** **Recommend charts on Overview** (as you suggested), with a full Analytics page later, once orders and quotations exist.
