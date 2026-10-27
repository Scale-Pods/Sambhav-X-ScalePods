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
