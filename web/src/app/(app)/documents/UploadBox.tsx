"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileUp } from "lucide-react";

type Item = { key: string; name: string; state: "waiting" | "uploading" | "reading" | "done" | "duplicate" | "error"; msg?: string };

const LABEL: Record<Item["state"], string> = {
  waiting: "Waiting", uploading: "Uploading…", reading: "Reading…", done: "Read, ready to review", duplicate: "Already uploaded before", error: "Failed",
};
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

export function UploadBox() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);

  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  async function one(file: File, key: string) {
    try {
      patch(key, { state: "uploading" });
      const fd = new FormData();
      fd.set("file", file);
      const up = await fetch("/api/documents/upload", { method: "POST", body: fd });
      const u = await up.json().catch(() => ({}));
      if (!up.ok) return patch(key, { state: "error", msg: u.error ?? "Upload failed" });
      if (u.duplicate_of) return patch(key, { state: "duplicate", msg: "This exact file is already in the list." });
      patch(key, { state: "reading" });
      const rd = await fetch(`/api/documents/${u.id}/read`, { method: "POST" });
      const r = await rd.json().catch(() => ({}));
      patch(key, rd.ok && r.ok ? { state: "done" } : { state: "error", msg: r.error ?? "Could not be read. Open it from the list to try again." });
    } catch {
      patch(key, { state: "error", msg: "The connection dropped. Try again." });
    } finally {
      router.refresh();
    }
  }

  async function add(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list).slice(0, 30);
    const fresh: Item[] = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, state: "waiting" }));
    setItems((xs) => [...fresh, ...xs]);
    let next = 0; // two at a time: the reading takes a while and the screen should stay calm
    const worker = async () => { while (next < files.length) { const i = next++; await one(files[i], fresh[i].key); } };
    await Promise.all([worker(), worker()]);
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        className={"flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors " + (over ? "border-brand bg-info-soft" : "border-line bg-card")}
      >
        <p className="text-[0.97rem] font-semibold">Drop purchase orders here, or choose them</p>
        <p className="max-w-xl text-[0.88rem] text-muted">PDF, JPG, PNG or WebP, up to 25 MB each and 30 at a time. Photos of handwritten orders and WhatsApp screenshots are fine. Nothing is saved to orders until a person confirms it.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => pick.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"><FileUp className="h-4 w-4" />Choose files</button>
          <button type="button" onClick={() => cam.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-surface"><Camera className="h-4 w-4" />Take a photo</button>
        </div>
        <input ref={pick} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>
      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-card text-[0.9rem]">
          {items.slice(0, 12).map((x) => (
            <li key={x.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="truncate">{x.name}</span>
              <span className={"shrink-0 text-[0.82rem] font-medium " + (x.state === "error" ? "text-bad" : x.state === "done" ? "text-ok" : "text-muted")} title={x.msg}>
                {LABEL[x.state]}{x.msg && x.state !== "done" ? ` – ${x.msg}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
