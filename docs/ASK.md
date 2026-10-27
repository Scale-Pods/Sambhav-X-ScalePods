# Ask (question box over the business records)

A person types a question in plain words; the answer comes from the system's own records.

**How it works**
- The model (Claude Sonnet 5.5) never sees the database and never writes SQL. It chooses from a fixed list of read-only lookups in `web/src/lib/ask/tools.ts`, fills in a few parameters, reads the rows returned, and ends by calling `final_answer`, whose input schema fixes the shape of the answer (answer, sources, up to 3 follow-ups, confidence).
- Lookups: stock check (same rules as the Stock check page), stock summary, plate lookup by heat/plate/TC/lot number, overview, orders and order lines, vehicle register, receivables, payables, sales and purchase invoices, GPay payments, leads / mail / quotations, Tally vouchers and parties, documents, physical counts, and a last-resort search over all copied sheets.
- Each lookup runs as the signed-in person, so the database's row rules still apply. Role lists: everyone internal gets stock lookups; document roles also get documents and counts; the owner and administrators get everything (money, Tally, orders, mail).
- Results are treated as data: the instructions to the model say to ignore text inside records that looks like an instruction. The box cannot change anything.
- Limits (table `app_limits`): `ask_daily_usd` (5) for everyone together and `ask_per_person_hour` (40). Every question, the lookups used, tokens and cost are in `ask_log` (administrators can read it).

**Adding a lookup:** add an entry to `TOOLS` (name, description, JSON schema, who may use it, a function returning a small set of rows). Keep results short and parameters typed.

**Later:** the same lookups can be exposed as an MCP server so Claude Desktop or another client can use them with a staff token.

## The Ask screen (28 Oct 2026)

Laid out like Claude: a left panel of the person's own past chats (search, pin, rename, delete; grouped Pinned / Today / Yesterday / Previous 7 days / Older), the conversation in the middle, and a typing box with a model picker and a "Look in" picker.
- **Models:** Fast = Claude Haiku 5.5 (under about 1 cent a question), Balanced = Claude Sonnet 5.5 (about 2 to 3 cents, default). Set per chat.
- **Look in:** Everything, Stock, Orders and dispatch, Money, Mail and leads, Tally, Documents, Sheets. It narrows which lookups the model may use (`SCOPE_OF` in `lib/ask/tools.ts`); non-admin roles only get the scopes they may read.
- **Streaming:** `POST /api/ask` answers with JSON lines (`meta`, `status`, `delta`, `reset`, `saved`, `done`, `error`). The answer text is read from the partial JSON of the `final_answer` tool as it arrives. The work continues after the handler returns, so the verified person id is captured up front and the rest runs under `runAs` in `lib/db.ts`.
- **Chats:** tables `ask_chats` and `ask_messages` (migration 36), private by row rules; writes only through `ask_new_chat`, `ask_add_message`, `ask_update_chat`, `ask_delete_chat`, `ask_drop_last_answer`, `ask_set_feedback`. Deleting hides a chat; `ask_log` (administrators only) keeps every question.
- **Per answer:** copy, thumbs up/down, answer again, "Looked at" (the lookups used and their row counts), follow-up questions.
- **Administrators:** today's spend against the daily limit and the cost of the current chat; `/ask/log` lists every question (who, lookups, model, cost, time) and the answers marked not good (`ask_feedback_log()`).
- **Not yet:** attaching a file, export to CSV, saved shared questions, scheduled questions, actions.

## Checking an answer: references (28 Oct 2026)

Every record a lookup returns carries a reference id (r1, r2 ...). The model cites them after each fact (`[r3]`); the server keeps only ids a lookup really handed out (an invented id is dropped) and numbers them in order of first use. The screen shows each as a small numbered link in the text and a "Check it here" list under the answer.

- **Sheet rows** open the Google sheet at the exact tab and row (`#gid=<tab>&range=A<row>:Z<row>`), with the row's own text as a preview. Only the owner and administrators get these (the sheets are theirs to read).
- **App pages** (plate, order, Tally invoice trail, document, draft, party search) open the screen in the app. Everyone gets these.
- Tab ids (`gid`) come from the daily sheet sync (`sheet_sources.tabs`). Plates and heat numbers are found in the live stock sheets by their number (trigram index on the row text), so a link points at the live row, not at the 8 Oct import.
- Stock answers also say when the stock book was loaded; the sheets keep changing in between, and the stock book is not re-derived from them yet.
- Code: `web/src/lib/ask/refs.ts` (reference book, `sheetRef`, `findSheetRows`, `citeRefs`), `tools.ts` (each lookup adds refs), `Markdown.tsx` and `AskApp.tsx` (display).

## Export, attachments and saved questions (29 Oct 2026)

- **Download an answer** (the download icon under it): its table as CSV for Excel (with a last column of links to check each row; cells that start with `=`, `+`, `@` are protected), print or save as PDF (opens a clean page and the browser's print dialog), or text with the numbered sources. The download icon at the top of the chat saves the whole chat as text.
- **Attach files** (the paperclip; owner, administrators, approvers, accounts, sales, office): up to 3 files, 3 MB together. PDF, pictures (png, jpg, webp, gif) and text files (txt, csv, tsv, md, json). The model reads the file for that question and checks it against the records ("do we have stock for this PO?"). The file itself is NOT stored: only its name stays on the question. Excel and Word are not read yet (save as PDF or CSV). A question with a file cannot be re-answered with the circular arrow (the file is gone); attach it again. File contents are treated as data, never as instructions. Cost: a one-page PO on the Fast model was about half a cent.
- **Saved questions** (the bookmark beside a question you asked): your own list (up to 50) with the model and "Look in" you used; shown in the left column and on the empty screen; one click asks it again. Private to the person (`ask_saved`, migration 37).
- Code: `web/src/app/(app)/ask/AskApp.tsx` (all three), `api/ask/route.ts` (files checked: kind, count, size), `lib/ask/engine.ts` (`userContent`), `api/ask/saved/**`.

## Stock refresh from the live sheets (28 Oct 2026)

`python tools/import/stock_refresh.py` (dry run) and `--commit`. Reads WB1 and WB2 live with typed values, runs the same parsers as the first load, matches each plate to the database by heat/plate number + grade + size, and ADDS only plates and sale lines the database does not have. It never changes or deletes: plates missing from the sheet, differing weights and unread tabs (MIX GRADE, MANGANESE PLATE, Corten) are only listed (`data/stock-refresh-report.csv`). Plates without a receipt date are skipped and noted in `exceptions`, as in the first load. First run on 28 Oct: 83 plates and 174 sale lines added (WB1 1,251 → 1,302 plates, WB2 582 → 614). Run it whenever the stock sheets have changed a lot; a button in the app and a schedule can follow.
