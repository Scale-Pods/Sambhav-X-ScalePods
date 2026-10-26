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
