// Checks Auto mode's rules on their own (no model is called, nothing is spent):  npx tsx scripts/check-auto-router.ts
// Each line is a real or typical question and the level it should get (1 cheap, 2 careful, 3 strong) for an owner; the last column is what a normal staff login should get.
import { chooseTier, struggled, type AutoFile } from "../src/lib/ask/router";

type Case = { q: string; owner: 1 | 2 | 3; staff: 1 | 2 | 3; files?: AutoFile[]; prev?: string };
const cases: Case[] = [
  // simple one-fact lookups
  { q: "Which plates are the oldest in stock?", owner: 1, staff: 1 },
  { q: "how many order of q lar is pending", owner: 1, staff: 1 },
  { q: "how much did we sell material of sa gr 11", owner: 1, staff: 1 },
  { q: "HOW MANY TONS 3 MM 16MO3 I HAVE", owner: 1, staff: 1 },
  { q: "What changed in stock this week?", owner: 1, staff: 1 },
  { q: "Give me the overview", owner: 1, staff: 1 },
  { q: "Do we have 12 mm SA 516 Gr 70, 1500 x 6000?", owner: 1, staff: 1 },
  { q: "who owes us the most", owner: 1, staff: 1 },
  { q: "where is invoice 730/26-27", owner: 1, staff: 1 },
  { q: "balance payment", owner: 1, staff: 1 },
  { q: "show the plate with heat number 33067TC2", owner: 1, staff: 1 },
  { q: "is Tally connected", owner: 1, staff: 1 },
  // vague, multi-part, or mixed: careful
  { q: "How is business this month compared with last month and which customers are slow to pay?", owner: 2, staff: 2 },
  { q: "Which orders are open, and do we have the stock to complete them?", owner: 2, staff: 2 },
  { q: "Which invoices have no PO and which of those customers owe us money? Also list their vehicles.", owner: 2, staff: 2 },
  { q: "why is our SA 387 GR 11 stock so low?", owner: 2, staff: 2 },
  // files
  { q: "Read the attached file and tell me what it contains. Then check the important details against our records.", owner: 2, staff: 2, files: [{ kind: "text" }] },
  { q: "check this PO against our stock", owner: 2, staff: 2, files: [{ kind: "pdf" }] },
  // hard analysis
  { q: "Analyse our sales by grade for the last six months, compare it with stock now, and recommend what we should buy from the mill next month and why.", owner: 3, staff: 2 },
  { q: "What should we do about the overdue receivables? Explain the reasons and suggest a plan for each big customer, and also tell me the stock impact.", owner: 3, staff: 2 },
  // follow-ups keep the level of the chat
  { q: "and for 20 mm?", owner: 2, staff: 2, prev: "gpt-6.1-terra" },
  { q: "and for 20 mm?", owner: 1, staff: 1 },
];

let bad = 0;
const rows: string[] = [];
for (const c of cases) {
  const o = chooseTier({ question: c.q, files: c.files, role: "owner", previousModel: c.prev });
  const s = chooseTier({ question: c.q, files: c.files, role: "accounts", previousModel: c.prev });
  const ok = o.tier === c.owner && s.tier === c.staff;
  if (!ok) bad++;
  rows.push(`${ok ? "ok  " : "FAIL"} owner L${o.tier} (want ${c.owner})  staff L${s.tier} (want ${c.staff})  score ${o.score}  ${c.q.slice(0, 70)}${o.reasons.length ? "  [" + o.reasons.join("; ") + "]" : ""}`);
}
console.log(rows.join("\n"));

// when the cheap model struggles
const R = (answer: string, used: string[], confidence = "found") => ({ answer, used: used.map((name) => ({ name })), confidence });
const s: [string, boolean, boolean][] = [
  ["null result (error or too many steps)", struggled(null, false), true],
  ["asks the person what they meant, no lookups", struggled(R("Which grade do you mean?", []), false), true],
  ["no lookup and not found", struggled(R("I can't tell.", [], "not_found"), false), true],
  ["honest nothing found after a real lookup", struggled(R("No such plate.", ["stock_check"], "not_found"), false), false],
  ["good answer with lookups", struggled(R("481 t sold.", ["stock_movements"]), false), false],
  ["asked to change something", struggled(R("I can only look things up.", [], "not_found"), false), false],
  ["no lookups but a file was attached", struggled(R("The file lists 3 plates.", [], "partly"), true), false],
];
for (const [name, got, want] of s) { const ok = got === want; if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} struggled: ${name} -> ${got}`); }
console.log(bad ? `\n${bad} check(s) failed` : "\nall checks passed");
process.exit(bad ? 1 : 0);
