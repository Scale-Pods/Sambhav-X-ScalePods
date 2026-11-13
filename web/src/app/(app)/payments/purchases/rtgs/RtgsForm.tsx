"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, ExternalLink, FileUp, Loader2, RefreshCw } from "lucide-react";
import { rupeesInWords } from "@/lib/rupeesWords";

type Read = { holder: string; bank: string; account: string; branch: string; ifsc: string; invoice_total: string; warnings: string[]; model: string };
const field = "w-full rounded-md border border-line bg-field px-2.5 py-1.5 text-[0.9rem] focus:border-brand";
const lab = "block text-[0.8rem] font-medium";
const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KEY = (e: string) => `rtgs-remitter-${e}`;

/** Prepares the RTGS / NEFT Excel form for one purchase invoice: the app reads the supplier's bank details off the bill, the person checks them against it, and downloads the file. */
export function RtgsForm({ supplier, invoiceNo, entity, link, invoiceAmount, pending, today, drive }: {
  supplier: string; invoiceNo: string; entity: "SPF" | "SAI"; link: string | null; invoiceAmount: number; pending: number | null; today: string; drive: boolean;
}) {
  const start = pending != null && pending > 0 ? pending : invoiceAmount;
  const [state, setState] = useState<"idle" | "reading" | "done" | "error">(link && drive ? "reading" : "idle");
  const [err, setErr] = useState<string | null>(link && !drive ? "This server cannot open the bill in Drive yet, so upload the invoice file instead." : null);
  const [read, setRead] = useState<Read | null>(null);
  const [holder, setHolder] = useState(""); const [account, setAccount] = useState(""); const [again, setAgain] = useState(""); const [bank, setBank] = useState(""); const [branch, setBranch] = useState(""); const [ifsc, setIfsc] = useState("");
  const [amount, setAmount] = useState(String(start));
  const [mode, setMode] = useState<"RTGS" | "NEFT">(start >= 200000 ? "RTGS" : "NEFT");
  const [date, setDate] = useState(today);
  const [remarks, setRemarks] = useState(`Invoice ${invoiceNo}`);
  const [remitter, setRemitter] = useState(""); const [remitterAccount, setRemitterAccount] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const ran = useRef(false);

  // our own name and account stay in this browser, so they are typed once
  // reading the browser's memory can only happen after the page is on the screen
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { const j = JSON.parse(localStorage.getItem(KEY(entity)) ?? "{}") as { n?: string; a?: string }; if (j.n) setRemitter(j.n); if (j.a) setRemitterAccount(j.a); } catch { /* typed again */ } }, [entity]);
  useEffect(() => { try { localStorage.setItem(KEY(entity), JSON.stringify({ n: remitter, a: remitterAccount })); } catch { /* not remembered */ } }, [entity, remitter, remitterAccount]);

  const apply = useCallback((r: Read) => { setRead(r); setHolder(r.holder); setAccount(r.account); setAgain(""); setBank(r.bank); setBranch(r.branch); setIfsc(r.ifsc); setChecked(false); setState("done"); setErr(null); }, []);
  const fail = (m: string) => { setErr(m); setState("error"); };

  const readFromBill = useCallback(async () => {
    setState("reading"); setErr(null);
    try {
      const res = await fetch("/api/payments/rtgs/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link, supplier }) });
      const j = (await res.json().catch(() => ({}))) as Read & { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) { fail(j.error ?? "The bill could not be read."); return; }
      apply(j);
    } catch { fail("The connection failed. Please try again."); }
  }, [link, supplier, apply]);
  useEffect(() => { if (link && drive && !ran.current) { ran.current = true; void readFromBill(); } }, [link, drive, readFromBill]);

  async function upload(f: File | undefined) {
    if (!f) return;
    setState("reading"); setErr(null);
    const fd = new FormData(); fd.set("file", f); fd.set("supplier", supplier);
    try {
      const res = await fetch("/api/payments/rtgs/read", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as Read & { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) { fail(j.error ?? "The file could not be read."); return; }
      apply(j);
    } catch { fail("The connection failed. Please try again."); }
  }

  const amt = Number(amount);
  const accountOk = /^\d{9,18}$/.test(account), ifscOk = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase());
  const sameAccount = again.length > 0 && again.replace(/\D/g, "") === account.replace(/\D/g, "");
  const words = useMemo(() => (amt > 0 ? rupeesInWords(amt) : ""), [amt]);
  const ready = holder.trim() && accountOk && ifscOk && sameAccount && checked && amt > 0;
  const mismatch = read && Number(read.invoice_total) > 0 && Math.abs(Number(read.invoice_total) - invoiceAmount) > 1;

  async function download() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/payments/rtgs/xlsx", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, date, remitter, remitterAccount, holder, account, bank, branch, ifsc, amount: amt, remarks, supplier, invoiceNo }) });
      if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; setErr(j.error ?? "The file could not be made."); return; }
      const blob = await res.blob();
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `rtgs-${invoiceNo.replace(/[^\w.-]+/g, "-")}.xlsx`; document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch { setErr("The connection failed. Please try again."); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
      <div className="space-y-5">
        <section className="rounded-lg border border-line bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-[1rem] font-bold">1. The supplier&apos;s bank details</h3>
            <div className="flex flex-wrap items-center gap-2 text-[0.82rem]">
              {link && <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">Open the bill<ExternalLink className="h-3.5 w-3.5" /></a>}
              {link && drive && <button type="button" onClick={() => void readFromBill()} disabled={state === "reading"} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-medium hover:bg-surface disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Read again</button>}
              <button type="button" onClick={() => file.current?.click()} disabled={state === "reading"} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-medium hover:bg-surface disabled:opacity-50"><FileUp className="h-3.5 w-3.5" />Upload an invoice file</button>
              <input ref={file} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
          </div>
          {state === "reading" && <p className="flex items-center gap-2 py-6 text-[0.9rem] text-muted"><Loader2 className="h-4 w-4 animate-spin" />Reading the supplier&apos;s bank details from the bill…</p>}
          {state === "error" && err && <p className="mb-3 rounded-md bg-bad-soft px-3 py-2 text-[0.88rem] text-bad">{err}</p>}
          {state === "idle" && err && <p className="mb-3 rounded-md bg-warn-soft px-3 py-2 text-[0.88rem] text-warn">{err}</p>}
          {state === "idle" && !err && <p className="py-4 text-[0.9rem] text-muted">This invoice has no bill file linked. Upload the supplier&apos;s invoice (PDF or picture) to read its bank details, or type them below.</p>}
          {read && read.warnings.length > 0 && (
            <ul className="mb-3 space-y-1 rounded-md bg-warn-soft px-3 py-2 text-[0.84rem] text-warn">
              {read.warnings.map((w, i) => <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</li>)}
            </ul>
          )}
          {mismatch && <p className="mb-3 rounded-md bg-warn-soft px-3 py-2 text-[0.84rem] text-warn">The bill&apos;s total (₹{inr.format(Number(read!.invoice_total))}) is not the invoice amount in the sheet (₹{inr.format(invoiceAmount)}). Check the amount below.</p>}
          {state !== "reading" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={lab + " sm:col-span-2"}>Account holder (beneficiary name)<input value={holder} onChange={(e) => setHolder(e.target.value)} className={field + " mt-1"} autoComplete="off" /></label>
              <label className={lab}>Account number<input value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={field + " mt-1 font-mono" + (account && !accountOk ? " border-bad" : "")} autoComplete="off" /></label>
              <label className={lab}>Type the account number again to confirm<input value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={field + " mt-1 font-mono" + (again && !sameAccount ? " border-bad" : "")} autoComplete="off" onPaste={(e) => e.preventDefault()} /></label>
              <label className={lab}>Bank<input value={bank} onChange={(e) => setBank(e.target.value)} className={field + " mt-1"} autoComplete="off" /></label>
              <label className={lab}>IFSC code<input value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={11} className={field + " mt-1 font-mono" + (ifsc && !ifscOk ? " border-bad" : "")} autoComplete="off" /></label>
              <label className={lab + " sm:col-span-2"}>Branch<input value={branch} onChange={(e) => setBranch(e.target.value)} className={field + " mt-1"} autoComplete="off" /></label>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-line bg-card p-4">
          <h3 className="mb-3 font-display text-[1rem] font-bold">2. Our side <span className="text-[0.8rem] font-normal text-muted">(optional: kept in this browser, so you type it once)</span></h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={lab}>Customer&apos;s name (who pays)<input value={remitter} onChange={(e) => setRemitter(e.target.value)} placeholder={entity === "SAI" ? "Sai Steel & Engineering" : "Sambhav Pipes & Fittings"} className={field + " mt-1"} autoComplete="off" /></label>
            <label className={lab}>Our HDFC account number<input value={remitterAccount} onChange={(e) => setRemitterAccount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={field + " mt-1 font-mono"} autoComplete="off" /></label>
          </div>
        </section>
      </div>

      <div className="h-fit space-y-4 rounded-lg border border-line bg-card p-4">
        <h3 className="font-display text-[1rem] font-bold">3. Amount and download</h3>
        <label className={lab}>Amount to pay (₹)<input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className={field + " mt-1 text-[1rem] font-semibold"} /></label>
        <p className="-mt-2 text-[0.78rem] text-muted">{pending != null && pending > 0 && pending !== invoiceAmount ? `Still to pay on this invoice: ₹${inr.format(pending)} (invoice total ₹${inr.format(invoiceAmount)}).` : `Invoice amount: ₹${inr.format(invoiceAmount)}.`}</p>
        {words && <p className="rounded-md bg-surface px-3 py-2 text-[0.84rem]">{words}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className={lab}>Transfer by<select value={mode} onChange={(e) => setMode(e.target.value as "RTGS" | "NEFT")} className={field + " mt-1"}><option value="RTGS">RTGS</option><option value="NEFT">NEFT</option></select></label>
          <label className={lab}>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field + " mt-1"} /></label>
        </div>
        {mode === "NEFT" && amt >= 200000 && <p className="text-[0.78rem] text-warn">RTGS is usually used from ₹2,00,000 upward.</p>}
        {mode === "RTGS" && amt > 0 && amt < 200000 && <p className="text-[0.78rem] text-warn">RTGS needs at least ₹2,00,000. Use NEFT for a smaller amount.</p>}
        <label className={lab}>Remarks<input value={remarks} onChange={(e) => setRemarks(e.target.value.slice(0, 140))} className={field + " mt-1"} autoComplete="off" /></label>
        <label className="flex items-start gap-2 rounded-md border border-line bg-surface/60 px-3 py-2 text-[0.84rem]">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
          <span>I have checked the account number, the IFSC and the name against the supplier&apos;s bill.</span>
        </label>
        <button type="button" disabled={!ready || busy} onClick={() => void download()} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download the Excel form
        </button>
        {!ready && state !== "reading" && <p className="text-[0.78rem] text-muted">{!holder.trim() || !accountOk || !ifscOk ? "Fill the name, a valid account number and a valid IFSC." : !sameAccount ? "Type the account number again; it must match." : !checked ? "Tick the box once you have checked the details." : "Enter the amount."}</p>}
        {err && state !== "error" && <p className="text-[0.84rem] text-bad">{err}</p>}
      </div>
    </div>
  );
}
