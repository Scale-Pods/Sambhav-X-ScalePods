const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const kg = (v: number | string | null | undefined) => (v == null ? "-" : inr.format(Number(v)));
export const tonnes = (v: number | string | null | undefined) => (v == null ? "-" : inr1.format(Number(v) / 1000));
export const mm = (v: number | string | null | undefined) => (v == null ? "-" : String(Number(v)));
export function date(v: Date | string | null | undefined) {
  if (!v) return "-";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
export const num = (v: unknown) => Number(v ?? 0);
