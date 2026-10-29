# Models for the Digital Brain and AI mode (30 Oct 2026)

Documents are always read by Anthropic (Haiku 5.5 first, Sonnet 5.5 only when the first read is doubtful). Everything below is about the question screens.

## The list (`web/src/lib/ask/models.ts`, one line per model)
| Model | Provider | $ per 1M tokens in / out | Measured cost per question* | Use it for |
|---|---|---|---|---|
| Haiku 5.5 (Fast) | Anthropic | 0.10 / 0.50 | **0.15 cent** (about ₹0.13) | Everyday questions. Fallback; was the default until 30 Oct 2026 |
| Sonnet 5.5 (Balanced) | Anthropic | 2 / 10 | 2.3 cents (₹2) | Vague or multi-part questions Haiku gets wrong |
| Opus 5.5 (Best) | Anthropic | 4 / 20 | 5.5 cents (₹4.8) | The hardest analysis; use sparingly |
| GPT-5 nano (Lowest cost) | OpenAI | 0.05 / 0.40 | 0.054 cent, 12 s | Simple lookups only; wrote wrong number formats once and pads answers. Not the default |
| GPT-6 Luna (Fast) | OpenAI | 0.10 / 0.50 | **0.055 cent**, 7.7 s | Everyday questions, the default. Cheapest good model: same list price as Haiku, but cached input is billed much lower |
| GPT-5 mini (Low cost) | OpenAI | 0.25 / 2 | 0.179 cent, 11.6 s | Not recommended: asked for clarification instead of looking things up |
| GPT-6.1 Terra (Balanced) | OpenAI | 1 / 5 | 0.523 cent, 9 s | Think harder, and harder questions, at a quarter of Sonnet's cost |
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
Switching provider does not cut the bill much by itself: **GPT-6 Luna costs the same as Haiku 5.5, and GPT-6.1 Sol the same as Sonnet 5.5.** Real savings come from (1) staying on Haiku for most questions (already the default), and (2) choosing a cheaper step-up than Sonnet: GPT-6.1 Terra (half the price) or GPT-5 mini (about an eighth). The test (below) showed Terra is the one that holds up as the step-up; mini is not worth it.

## What the test showed (OpenAI models, same 8 questions, run 30 Oct 2026, about 6.5 cents in all)
- **Luna** answered all 8, cited sources, 0.055 cent and 7.7 s per question: a third of Haiku's cost and as fast. It is the best everyday model.
- **Terra** answered all 8 with Sonnet-like care at 0.52 cent (a quarter of Sonnet). It calls the orders lookup more often than needed, so it is slower on order questions.
- **nano** answered all 8 but wrote some numbers wrongly formatted, added filler follow-up offers and was slowest (12 s). Cheap, but the accuracy risk is not worth saving 0.001 cent.
- **mini** answered, but sometimes asked what was meant instead of using the lookups, and once said there were no leads when there were. Costs 3 times Luna.
- Nothing needed changing in the OpenAI connection itself. The one fix found was shared by all models: the answer length limit was too small for a long table (Haiku came back empty on "new leads" and "open and late orders"). Raised to 1500 tokens in AI mode and 4000 in the Digital Brain; Haiku re-tested on both questions and now answers (0.17 and 0.41 cent).

## Recommended setup
| Where | Model | About per question |
|---|---|---|
| Digital Brain (default) | GPT-6 Luna | 0.055 cent |
| AI mode | GPT-6 Luna | 0.055 cent |
| Think harder | GPT-6.1 Terra | 0.52 cent |
| Hardest analysis (pick by hand) | Sonnet 5.5 or Opus 5.5 | 2 to 5 cents |
| Documents | Haiku 5.5, then Sonnet 5.5 | unchanged |

These are now the built-in defaults in `web/src/lib/ask/models.ts` (30 Oct 2026). To change them without code, set the Vercel variables `ASK_DEFAULT_MODEL`, `AI_MODE_MODEL`, `THINK_HARDER_MODEL` to a model key and redeploy. Haiku stays in the picker as a fallback if OpenAI has an outage.

The **i** button next to the model box in the Digital Brain opens three tables in rupees (cost of a question, list price per 1M tokens, which model for what), built from the same list. The rupee rate is `INR_PER_USD` in `models.ts`.

## Adding the OpenAI key (the OpenAI models stay greyed out until it is set)
1. Create a key at platform.openai.com/api-keys.
2. **Local:** add a line `OPENAI_API_KEY=sk-...` to `web/.env.local` and restart the dev server.
3. **Live site:** Vercel, project sambhav-stock, Settings, Environment Variables, add `OPENAI_API_KEY` (Production), then redeploy. (Also set it for Preview if you use previews.)
4. **GitHub Actions** does not need it.
Never put the key in chat, in a file in the repository or in a screenshot.

## Testing a model against our questions
`cd web && TEST_UID=<an administrator's auth id> MODELS=gpt-6-luna,gpt-5-mini,gpt-6.1-terra node --env-file=.env.local ../tools/model-compare/run.mjs`
It asks the same 8 questions of each model through the real engine and real data, prints cost, time and which lookups were used, and saves every answer to `data/model-compare.json` (git-ignored) so the answers can be compared side by side. It spends real money on each model named (about 0.5 to 6 cents per model; add `ONLY=6,7` to run just some questions, `MAX_USD=0.3` as a hard stop).

## Which screen uses which model
- **Digital Brain:** the model picked in the box under the chat (starts on `ASK_DEFAULT_MODEL`, default GPT-6 Luna). Saved per chat.
- **AI mode:** `AI_MODE_MODEL` (default GPT-6 Luna). **Think harder** uses `THINK_HARDER_MODEL` (default GPT-6.1 Terra). These are environment settings, not code.
- Chats started on the old "Fast" or "Balanced" were moved to Haiku 5.5 and Sonnet 5.5.
