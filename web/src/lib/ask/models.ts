// The models the question screens can use. Prices are US dollars per 1 million tokens, standard tier (Anthropic: docs, OpenAI: developers.openai.com pricing page,
// both as read on 30 Oct 2026). To add a model: one more line here; nothing else needs to change. This file is also read by the screens, so it holds no secrets.

export type ProviderName = "anthropic" | "openai";

export type ModelDef = {
  key: string;            // what is stored with a chat and sent by the screen (the model's API id)
  provider: ProviderName;
  id: string;             // the API model id
  name: string;           // as people know it: "Haiku 5.5"
  tier: string;           // what it is good for, in a word: shown in brackets
  in: number; out: number; cached?: number; // $ per 1M tokens: new input, output, input served from the provider's cache
  effort?: "low" | "medium" | "high"; // how hard an Anthropic 5.5 model thinks before answering (more thinking = more output tokens = more cost)
  forceFinal: boolean;    // may the final step be forced to the answer tool? (Anthropic 5.5 Sonnet / Opus refuse forced tool use)
  note: string;           // one line on when to pick it
  measured?: number;      // US cents per question, averaged over the 8 real test questions on 30 Oct 2026 (tools/model-compare); absent = not tested
};

export const MODEL_LIST: ModelDef[] = [
  { key: "claude-haiku-5-5", provider: "anthropic", id: "claude-haiku-5-5", name: "Haiku 5.5", tier: "Fast", in: 0.1, out: 0.5, effort: "low", forceFinal: true, note: "Everyday questions: stock, orders, money, mail. Quick and very cheap.", measured: 0.147 },
  { key: "claude-sonnet-5-5", provider: "anthropic", id: "claude-sonnet-5-5", name: "Sonnet 5.5", tier: "Balanced", in: 2, out: 10, effort: "low", forceFinal: false, note: "Vague or multi-part questions that Haiku gets wrong.", measured: 2.25 },
  { key: "claude-opus-5-5", provider: "anthropic", id: "claude-opus-5-5", name: "Opus 5.5", tier: "Best", in: 4, out: 20, effort: "medium", forceFinal: false, note: "The hardest questions and careful analysis. Use sparingly.", measured: 5.45 },
  { key: "gpt-5-nano", provider: "openai", id: "gpt-5-nano", name: "GPT-5 nano", tier: "Lowest cost", in: 0.05, out: 0.4, cached: 0.005, forceFinal: true, note: "Lowest price, but in our test it wrote some numbers wrongly. Simple lookups only.", measured: 0.054 },
  { key: "gpt-6-luna", provider: "openai", id: "gpt-6-luna", name: "GPT-6 Luna", tier: "Fast", in: 0.1, out: 0.5, cached: 0.01, forceFinal: true, note: "Everyday questions, and the default: as good as Haiku 5.5 in our test at about a third of the cost.", measured: 0.055 },
  { key: "gpt-5-mini", provider: "openai", id: "gpt-5-mini", name: "GPT-5 mini", tier: "Low cost", in: 0.25, out: 2, cached: 0.025, forceFinal: true, note: "Not recommended: in our test it sometimes asked what was meant instead of looking it up.", measured: 0.179 },
  { key: "gpt-6.1-terra", provider: "openai", id: "gpt-6.1-terra", name: "GPT-6.1 Terra", tier: "Balanced", in: 1, out: 5, cached: 0.05, forceFinal: true, note: "Harder or vaguer questions (used by Think harder): careful like Sonnet 5.5 at a quarter of the cost.", measured: 0.523 },
  { key: "gpt-6.1-sol", provider: "openai", id: "gpt-6.1-sol", name: "GPT-6.1 Sol", tier: "Strong", in: 2, out: 10, cached: 0.1, forceFinal: true, note: "Same price as Sonnet 5.5; cached input is cheaper." },
  { key: "gpt-6-astra", provider: "openai", id: "gpt-6-astra", name: "GPT-6 Astra", tier: "Best", in: 10, out: 50, cached: 1, forceFinal: true, note: "OpenAI's top model: complex reasoning. Expensive." },
];

/** Names used before the model list existed. */
const LEGACY: Record<string, string> = { fast: "claude-haiku-5-5", balanced: "claude-sonnet-5-5" };

/** The model a screen should start on, and the ones AI mode uses. Set in the environment to change them without code. */
export const DEFAULT_KEY = process.env.ASK_DEFAULT_MODEL || "gpt-6-luna";
export const AI_MODE_KEY = process.env.AI_MODE_MODEL || "gpt-6-luna";
export const THINK_HARDER_KEY = process.env.THINK_HARDER_MODEL || "gpt-6.1-terra";

export const modelByKey = (k: unknown): ModelDef | null => {
  if (typeof k !== "string") return null;
  const key = LEGACY[k] ?? k;
  return MODEL_LIST.find((m) => m.key === key) ?? null;
};
export const defaultModel = () => modelByKey(DEFAULT_KEY) ?? MODEL_LIST[0];

/** What one typical question costs on this model: about 6,000 tokens in (instructions, the lookups' rows) and 700 out. A guide, not a promise. */
export const typicalUsd = (m: ModelDef) => (6000 * m.in + 700 * m.out) / 1e6;
/** Rupees per US dollar used for every price shown on screen. Change here when the rate moves a lot. */
export const INR_PER_USD = 88;
export const label = (m: ModelDef) => `${m.name} (${m.tier})`;
