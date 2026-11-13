"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postChallan, unpostChallan, type PostLineIn } from "./actions";

export type PostOption = { id: string; text: string };
export type PostLine = { n: number; label: string; pieces: string; balance: string; verdict: string; options: PostOption[]; lot: string; kg: number | null; warn: string[] };

const SUPPLY = "supply";
const inp = "rounded-md border border-line bg-field px-2 py-1.5 text-[0.88rem] focus:border-brand disabled:opacity-60";
const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

/** The checker's step for a confirmed challan: choose the plate each line comes out of (or "not from our stock"), check the pieces and the weight, and post. */
export function ChallanPostPanel({ id, lines, canDecide }: { id: string; lines: PostLine[]; canDecide: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lot, setLot] = useState<string[]>(() => lines.map((l) => l.lot));
  const [pcs, setPcs] = useState<string[]>(() => lines.map((l) => l.pieces));
  const [kg, setKg] = useState<string[]>(() => lines.map((l) => (l.kg != null ? String(Math.round(l.kg)) : "")));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const undecided = lot.filter((x) => x === "").length;
  const bad = lines.some((_, i) => lot[i] !== "" && lot[i] !== SUPPLY && (!(Number(pcs[i]) >= 1) || !(Number(kg[i]) > 0)));
  const totalKg = useMemo(() => lines.reduce((a, _, i) => a + (lot[i] !== "" && lot[i] !== SUPPLY ? Number(kg[i]) || 0 : 0), 0), [lines, lot, kg]);
  const plates = lot.filter((x) => x !== "" && x !== SUPPLY).length;

  function post() {
    const payload: PostLineIn[] = lines.map((l, i) => ({ n: l.n, lot_id: lot[i] === SUPPLY ? null : lot[i], pieces: Number(pcs[i]) || 0, weight_kg: Number(kg[i]) || 0 }));
    if (!window.confirm(`Post this challan to stock?\n\n${plates} plate line${plates === 1 ? "" : "s"}, about ${fmt(totalKg)} kg go out of stock. You can take it back afterwards.`)) return;
    setMsg(null);
    start(async () => {
      const r = await postChallan(id, payload);
      setMsg({ ok: r.ok, text: r.ok ? r.message : r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="mb-5 space-y-3 rounded-lg border border-line bg-card p-4 text-[0.9rem]">
      <h3 className="font-display text-[0.95rem] font-bold">Post to stock</h3>
      <p className="text-[0.85rem] text-muted">The reading is confirmed. For each line, choose the plate it comes out of, or say it is not from our stock. Pieces and weight go out of that plate&apos;s balance. A written Balance is kept as a note; the plate keeps what is left.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-[0.86rem]">
          <thead><tr className="border-b border-line text-left text-[0.7rem] uppercase tracking-wider text-muted"><th className="px-2 py-2">Line</th><th className="px-2 py-2">Comes out of</th><th className="px-2 py-2">Pieces</th><th className="px-2 py-2">Weight kg</th></tr></thead>
          <tbody className="divide-y divide-line">
            {lines.map((l, i) => (
              <tr key={l.n} className="align-top">
                <td className="px-2 py-2"><span className="font-medium">{l.label}</span>{l.balance && <span className="block text-[0.78rem] text-muted">balance written: {l.balance}</span>}{l.warn.map((w, j) => <span key={j} className="block text-[0.78rem] text-warn">{w}</span>)}</td>
                <td className="px-2 py-2">
                  <select value={lot[i]} disabled={!canDecide || pending} onChange={(e) => setLot((a) => a.map((x, j) => (j === i ? e.target.value : x)))} className={inp + " w-full max-w-[26rem] " + (lot[i] === "" ? "border-warn bg-warn-soft" : "")}>
                    <option value="">Choose…</option>
                    {l.options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
                    <option value={SUPPLY}>Not from our stock (supply material)</option>
                  </select>
                </td>
                <td className="px-2 py-2"><input type="number" min={1} step={1} value={pcs[i]} disabled={!canDecide || pending || lot[i] === SUPPLY} onChange={(e) => setPcs((a) => a.map((x, j) => (j === i ? e.target.value : x)))} className={inp + " w-16"} /></td>
                <td className="px-2 py-2"><input type="number" min={1} step={1} value={kg[i]} disabled={!canDecide || pending || lot[i] === SUPPLY} onChange={(e) => setKg((a) => a.map((x, j) => (j === i ? e.target.value : x)))} className={inp + " w-24"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!canDecide || pending || undecided > 0 || bad} onClick={post} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">{pending ? "Posting…" : "Post to stock"}</button>
        <span className="text-[0.82rem] text-muted">{undecided > 0 ? `${undecided} line${undecided === 1 ? "" : "s"} still to decide` : bad ? "Pieces and weight are needed for each plate" : `${plates} plate line${plates === 1 ? "" : "s"}, about ${fmt(totalKg)} kg`}</span>
      </div>
      {!canDecide && <p className="text-[0.82rem] text-muted">Only an approver, an administrator or the owner can post a challan to stock.</p>}
      {msg && <p className={"text-[0.88rem] " + (msg.ok ? "text-ok" : "text-bad")}>{msg.text}</p>}
    </div>
  );
}

/** Take a posting back, with a reason. */
export function UndoPosting({ id, canDecide }: { id: string; canDecide: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (!canDecide) return null;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-[0.85rem] font-medium text-bad hover:underline">Take this posting back</button>;
  return (
    <div className="space-y-2">
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Why is it being taken back? (required)" disabled={pending} className={inp + " w-full max-w-md"} />
      <div className="flex items-center gap-2">
        <button type="button" disabled={pending || note.trim().length < 3} onClick={() => start(async () => { const r = await unpostChallan(id, note); if (r.ok) router.refresh(); else setMsg(r.error); })} className="rounded-lg bg-bad px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "Working…" : "Take it back"}</button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setMsg(null); }} className="text-sm text-muted hover:underline">Cancel</button>
      </div>
      {msg && <p className="text-[0.85rem] text-bad">{msg}</p>}
    </div>
  );
}
