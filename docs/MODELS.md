# Models for the Digital Brain and AI mode (30 Oct 2026)

Documents are always read by Anthropic (Haiku 5.5 first, Sonnet 5.5 only when the first read is doubtful). Everything below is about the question screens.

## The list (`web/src/lib/ask/models.ts`, one line per model)
| Model | Provider | $ per 1M tokens in / out | Measured cost per question* | Use it for |
|---|---|---|---|---|
| Haiku 5.5 (Fast) | Anthropic | 0.10 / 0.50 | **0.15 cent** (about ₹0.13) | Everyday questions. The default for the Digital Brain and AI mode |
| Sonnet 5.5 (Balanced) | Anthropic | 2 / 10 | 2.3 cents (₹2) | Vague or multi-part questions Haiku gets wrong |
| Opus 5.5 (Best) | Anthropic | 4 / 20 | 5.5 cents (₹4.8) | The hardest analysis; use sparingly |
| GPT-5 nano (Lowest cost) | OpenAI | 0.05 / 0.40 | not measured yet | Simple lookups at the lowest price |
| GPT-6 Luna (Fast) | OpenAI | 0.10 / 0.50 | not measured yet | Same price as Haiku 5.5 |
| GPT-5 mini (Low cost) | OpenAI | 0.25 / 2 | not measured yet | A cheap step up from nano |
| GPT-6.1 Terra (Balanced) | OpenAI | 1 / 5 | not measured yet | Half the price of Sonnet 5.5 |
| GPT-6.1 Sol (Strong) | OpenAI | 2 / 10 | not measured yet | Same price as Sonnet 5.5; cached input is cheaper |
| GPT-6 Astra (Best) | OpenAI | 10 / 50 | not measured yet | OpenAI's top model; expensive |

*Average over 8 real questions on live data (stock, debtors, Tally invoice trail, invoices without a PO, a vague "what is the balance payment", leads, open and late orders), asked through the real engine, with Anthropic's thinking effort set to low. Opus and Sonnet "effort" is set in `models.ts`: more effort = more hidden thinking = more output tokens = more cost.

Prices are from Anthropic's price list and OpenAI's pricing page (developers.openai.com/api/docs/pricing), read on 30 Oct 2026. Check them before quoting to a client.

## What the test showed (Claude models, 8 questions each)
- **Haiku** answered 7 of 8 correctly and cited sources; it failed once ("which orders are open and late?", it did not finish the answer). It averaged 0.15 cent and 8 seconds.
- **Sonnet** answered all 8, with better care (it noticed the list was cut off and said so, spotted that six invoices were placeholders). 15 times Haiku's cost.
- **Opus** answered all 8 and added detail (days late, salesperson) at 36 times Haiku's cost. Not worth it for routine questions.
- The vague question "what is the balance payment": Haiku and Opus gave the company-wide totals; Sonnet listed the biggest parties and said it lacked grand totals.

## Where the money really goes
Switching provider does not cut the bill much by itself: **GPT-6 Luna costs the same as Haiku 5.5, and GPT-6.1 Sol the same as Sonnet 5.5.** Real savings come from (1) staying on Haiku for most questions (already the default), and (2) choosing a cheaper step-up than Sonnet: GPT-6.1 Terra (half the price) or GPT-5 mini (about an eighth). Whether those two answer as well as Sonnet on our questions has to be tested with the same 8 questions (below).

## Adding the OpenAI key (the OpenAI models stay greyed out until it is set)
1. Create a key at platform.openai.com/api-keys.
2. **Local:** add a line `OPENAI_API_KEY=sk-...` to `web/.env.local` and restart the dev server.
3. **Live site:** Vercel, project sambhav-stock, Settings, Environment Variables, add `OPENAI_API_KEY` (Production), then redeploy. (Also set it for Preview if you use previews.)
4. **GitHub Actions** does not need it.
Never put the key in chat, in a file in the repository or in a screenshot.

## Testing a model against our questions
`cd web && TEST_UID=<an administrator's auth id> MODELS=gpt-6-luna,gpt-5-mini,gpt-6.1-terra node --env-file=.env.local ../tools/model-compare/run.mjs`
It asks the same 8 questions of each model through the real engine and real data, prints cost, time and which lookups were used, and saves every answer to `data/model-compare.json` (git-ignored) so the answers can be compared side by side. It spends real money on each model named (about 1 to 12 cents per model).

## Which screen uses which model
- **Digital Brain:** the model picked in the box under the chat (starts on `ASK_DEFAULT_MODEL`, default Haiku 5.5). Saved per chat.
- **AI mode:** `AI_MODE_MODEL` (default Haiku 5.5). **Think harder** uses `THINK_HARDER_MODEL` (default Sonnet 5.5). These are environment settings, not code.
- Chats started on the old "Fast" or "Balanced" were moved to Haiku 5.5 and Sonnet 5.5.
