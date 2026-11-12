import { AUTO_TIERS, autoMaxTier, modelByKey, tierOfModel, type ModelDef } from "./models";

// Auto mode: which model should answer this question? A fixed set of plain rules decides, in code, before any model is called: it costs nothing and takes no time.
//   level 1 (cheap)    simple, one-fact lookups: "how many tons 3 mm 16Mo3", "who owes us"
//   level 2 (careful)  vague or multi-part questions, or a file to check against the records
//   level 3 (strong)   hard analysis, long or mixed questions (owner and administrators only)
// Each question earns points for signs of difficulty; the points decide the level. If the cheap model clearly struggles, route.ts tries once one level up.
// This file imports nothing that needs a server, so the rules can be checked on their own (scripts/check-auto-router.ts).

export type Tier = 1 | 2 | 3;
export type AutoFile = { kind: "pdf" | "image" | "text" };
export type Route = { tier: Tier; max: Tier; score: number; reasons: string[] };

const AREAS: Record<string, RegExp> = {
  stock: /\b(plates?|stock|grades?|thick(ness)?|heat|\d+\s?mm|kgs?|tonnes?|tons?|mt)\b/,
  money: /\b(owe[sd]?|invoices?|payments?|overdue|receivables?|payables?|balance|outstanding|dues?|rs|lakh|crore|₹)\b/,
  orders: /\b(orders?|dispatch(es|ed)?|po|vehicles?|deliver(y|ies|ed)|pending)\b/,
  mail: /\b(mails?|emails?|leads?|quot(e|es|ations?)|enquir(y|ies))\b/,
  tally: /\b(tally|vouchers?|ledgers?|irn|e-?way)\b/,
  documents: /\b(documents?|certificates?|drafts?|mtc|tc)\b/,
};
// words that ask for reasoning, not for a fact: the first strong one is worth a level on its own, every further one adds a little
const STRONG = /\b(why|compar(e|ed|es|ing|ison)|analy[sz]e|analysis|recommend(ation)?s?|explain|root cause|what should|should we|pros and cons|forecast|predict|what if)\b/g;
const WEAK = /\b(versus|vs|trends?|suggest|reasons?|insights?|which is better|plan)\b/g;
const CHAIN = /\b(and also|also|then|after that|as well as|plus|along with)\b/;
const NEXT_QUESTION = /\b(and|then) (do|does|did|which|what|how|who|is|are|can|will|list|show)\b/;

/** Points for signs of difficulty (more = harder), with a plain reason for each. */
export function scoreQuestion(question: string, files: AutoFile[] = []): { score: number; reasons: string[] } {
  const q = question.toLowerCase().replace(/\s+/g, " ").trim();
  const words = q ? q.split(" ").length : 0;
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => { score += n; reasons.push(why); };
  if (words > 40) add(2, "a very long question"); else if (words > 20) add(1, "a long question");
  const marks = (q.match(/\?/g) ?? []).length;
  if (marks > 1) add(Math.min(marks - 1, 2), "more than one question");
  if (CHAIN.test(q)) add(1, "asks for several things");
  if (NEXT_QUESTION.test(q)) add(2, "a second question in the same sentence");
  const strong = new Set(q.match(STRONG) ?? []).size, weak = new Set(q.match(WEAK) ?? []).size;
  if (strong + weak > 0) add((strong > 0 ? 3 : 2) + Math.min(strong + weak - 1, 2), "asks for reasoning or advice");
  const areas = Object.values(AREAS).filter((r) => r.test(q)).length;
  if (areas >= 3) add(2, "mixes several parts of the business"); else if (areas === 2) add(1, "mixes two parts of the business");
  if (files.length > 0) add(3, "a file to read and check");
  if (files.some((f) => f.kind === "pdf" || f.kind === "image")) add(1, "a picture or PDF");
  return { score, reasons };
}

export const tierForScore = (score: number): Tier => (score >= 6 ? 3 : score >= 3 ? 2 : 1);

/** The level for a question: its points, kept at or above the level of the chat's last answer for a short follow-up, and never above what the role may use. */
export function chooseTier(i: { question: string; files?: AutoFile[]; role?: string; previousModel?: string | null }): Route {
  const { score, reasons } = scoreQuestion(i.question, i.files);
  const max = autoMaxTier(i.role);
  let tier = tierForScore(score);
  const prev = tierOfModel(i.previousModel);
  if (prev > tier && i.question.trim().split(/\s+/).length <= 8) { tier = prev as Tier; reasons.push("a short follow-up to a harder answer"); }
  if (tier > max) { tier = max; reasons.push("kept to the highest level this role may use"); }
  return { tier, max, score, reasons };
}

/** The model for a level: the one set for it, or, when its provider's key is not set here, the nearest level that is. */
export function modelForTier(tier: Tier, ready: (provider: "anthropic" | "openai") => boolean): ModelDef | null {
  const order: Tier[] = [tier, ...([3, 2, 1] as Tier[]).filter((t) => t < tier), ...([1, 2, 3] as Tier[]).filter((t) => t > tier)];
  for (const t of order) { const m = modelByKey(AUTO_TIERS[t]); if (m && ready(m.provider)) return m; }
  return null;
}

/** Did the model clearly fail to answer (so one more try on a stronger one is worth the extra cost)? An honest "nothing found" after real lookups is NOT failing. */
export function struggled(res: { answer: string; used: { name: string }[]; confidence: string } | null, hasFiles: boolean): boolean {
  if (!res) return true; // an error or too many steps
  const a = res.answer.trim();
  if (/could not put an answer together|needs a longer look/i.test(a)) return true;
  if (res.used.length === 0 && !hasFiles) {
    if (/can only look things up/i.test(a)) return false; // asked to change something: nothing to look up, and a stronger model would say the same
    return /\?\s*$/.test(a) || /\b(could you|can you|please) (clarify|specify|tell me|confirm)\b|do you mean|which one|what do you mean/i.test(a) || res.confidence !== "found";
  }
  return false;
}

/** What the screen says under the answer. */
export const levelWord = (tier: number) => (tier >= 3 ? "a hard question" : tier === 2 ? "a question needing care" : "a simple question");
