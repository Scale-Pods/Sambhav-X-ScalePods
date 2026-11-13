// Rupee amounts the way the business reads them: lakh and crore, Indian digit grouping.
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** ₹12,34,567 */
export const rupees = (v: number | string | null | undefined) => (v == null || v === "" ? "-" : "₹" + inr0.format(Math.round(Number(v))));
/** 12,34,567.50 (no symbol): for table cells */
export const amount = (v: number | string | null | undefined) => (v == null || v === "" ? "-" : inr0.format(Math.round(Number(v))));
/** ₹12,34,567.00 : a rupee amount with its paise, as the payment sheets show it */
export const rupees2 = (v: number | string | null | undefined) => (v == null || v === "" ? "-" : "₹" + inr2.format(Number(v)));
export const amount2 = (v: number | string | null | undefined) => (v == null || v === "" ? "-" : inr2.format(Number(v)));

/** ₹1.62 cr · ₹45.3 L · ₹8,500 */
export function rupeesShort(v: number | string | null | undefined) {
  if (v == null || v === "") return "-";
  const n = Number(v), a = Math.abs(n), sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e8 ? 1 : 2)} cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)} L`;
  return `${sign}₹${inr0.format(Math.round(a))}`;
}

/** yyyy-mm-dd from a database date (a Date object or text), without a time-zone shift. Empty when there is none. */
export function isoDay(v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  return String(v).slice(0, 10);
}
