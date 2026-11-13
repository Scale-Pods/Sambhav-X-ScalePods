// "Show me where it changed": a link to the stock sheet with the affected rows highlighted, like the green and red of a code diff.
// The highlights travel in the address, as one parameter "hl": a dot-separated list of marks.
//   a123  stock movement 123 was ADDED to the stock (green)        d44  movement 44 TOOK stock out (red)
//   s9    movement 9 is what is being looked at (blue)             l3017  every row of plate (lot) 3017 (blue)
// A movement's number is its "seq" in the stock table. The balance row of a plate whose movement is marked is marked too.

export type Tone = "add" | "del" | "see";
export type Hl = { moves: Map<number, Tone>; lots: Set<number> };

const CODE: Record<Tone, string> = { add: "a", del: "d", see: "s" };
const TONE: Record<string, Tone> = { a: "add", d: "del", s: "see" };

export function parseHl(v: string | undefined | null): Hl {
  const out: Hl = { moves: new Map(), lots: new Set() };
  for (const tok of (v ?? "").split(".").slice(0, 400)) {
    const m = /^([adsl])(\d{1,12})$/.exec(tok.trim());
    if (!m) continue;
    if (m[1] === "l") out.lots.add(Number(m[2])); else out.moves.set(Number(m[2]), TONE[m[1]]);
  }
  return out;
}

export function buildHl(moves: { seq: number; tone: Tone }[], lots: number[] = []): string {
  return [...moves.map((m) => `${CODE[m.tone]}${m.seq}`), ...lots.map((l) => `l${l}`)].join(".");
}

export const hasHl = (h: Hl) => h.moves.size > 0 || h.lots.size > 0;

/** The classes of a highlighted row (the plain row classes are the caller's). */
export const ROW_TONE: Record<Tone, string> = {
  add: "bg-ok/20 shadow-[inset_3px_0_0_var(--ok)]",
  del: "bg-bad/20 shadow-[inset_3px_0_0_var(--bad)]",
  see: "bg-brand/15 shadow-[inset_3px_0_0_var(--brand)]",
};
