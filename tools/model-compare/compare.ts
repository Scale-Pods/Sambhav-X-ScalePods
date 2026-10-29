import fs from "node:fs";
import { runAsk } from "../../web/src/lib/ask/engine";
import { MODEL_LIST, modelByKey } from "../../web/src/lib/ask/models";

// The same questions, asked of each model through the real engine and the real data. Reads its settings from the environment:
//   MODELS=claude-haiku-5-5,gpt-6-luna   (default: every model whose key is set)   QUICK=1 (ask as AI mode does)   OUT=path of the results file
const QUESTIONS: { q: string; scope: string; page?: { path: string; title: string; params: Record<string, string> } }[] = [
  { q: "Do we have 40 mm SA 387 Gr 22 Cl2 plates, 1250 wide and 6000 long?", scope: "stock" },
  { q: "Who are our top 3 customers by money they owe us, and how much?", scope: "money" },
  { q: "For Tally invoice 730/26-27: which vehicle took it and does it have a PO and certificates?", scope: "tally" },
  { q: "Which invoices have no PO on file?", scope: "tally" },
  { q: "what is the balance payment", scope: "all" },
  { q: "How much SA 516 Gr 70 do we have in stock?", scope: "stock" },
  { q: "Any new leads this week?", scope: "mail" },
  { q: "Which orders are open and late?", scope: "orders" },
];
const have = (p: string) => Boolean(p === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);
const wanted = (process.env.MODELS ? process.env.MODELS.split(",") : MODEL_LIST.filter((m) => have(m.provider)).map((m) => m.key)).map((k) => modelByKey(k.trim())!).filter(Boolean);
const rows: Record<string, unknown>[] = [];
for (const m of wanted) {
  if (!have(m.provider)) { console.log(`skip ${m.key}: no ${m.provider} key`); continue; }
  let total = 0, secs = 0, fails = 0;
  for (const x of QUESTIONS) {
    const t0 = Date.now();
    const r = await runAsk({ mode: process.env.QUICK ? "quick" : undefined, page: x.page, question: x.q, history: [], role: "admin", model: m.key, scope: x.scope as never, chatId: null }, () => {});
    const s = (Date.now() - t0) / 1000;
    if (!r) { fails++; console.log(`  ${m.key} | FAILED | ${x.q}`); rows.push({ model: m.key, q: x.q, failed: true }); continue; }
    total += r.usd; secs += s;
    rows.push({ model: m.key, q: x.q, usd: r.usd, seconds: s, tokens: r.tokens, lookups: r.used.map((u) => u.name), confidence: r.confidence, answer: r.answer });
    console.log(`  ${m.key.padEnd(18)} ${(r.usd * 100).toFixed(3).padStart(7)} c ${s.toFixed(1).padStart(5)} s  ${r.used.map((u) => u.name).join(",").padEnd(34)} ${x.q.slice(0, 50)}`);
  }
  console.log(`== ${m.name} (${m.tier}): ${(total * 100).toFixed(2)} cents for ${QUESTIONS.length - fails} answers, avg ${(total / Math.max(1, QUESTIONS.length - fails) * 100).toFixed(3)} c and ${(secs / Math.max(1, QUESTIONS.length - fails)).toFixed(1)} s, ${fails} failed\n`);
}
const out = process.env.OUT || "../data/model-compare.json";
fs.mkdirSync(out.replace(/[\/][^\/]*$/, "") || ".", { recursive: true });
fs.writeFileSync(out, JSON.stringify(rows, null, 1));
console.log("results saved to", out);
process.exit(0);
