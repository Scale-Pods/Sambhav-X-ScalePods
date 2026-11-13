// The payment reminder e-mail, in the layout of the statement Sagar sent on 28 Oct 2026: a strip of totals, table A (pending invoices, past their due date),
// table B (falling due soon), the request to pay, the UTR line, the reconcile line and the signature. Plain code with no server parts, so the editor on the
// screen can build the preview again when the person changes the tone.

export type Tone = "statement" | "firm";
export type RemRow = { po: string; invoice: string; invoiceDate: string | null; dueDate: string | null; value: number; received: number; balance: number; days: number };
export type RemInput = { entity: "SPF" | "SAI"; party: string; asOf: string; tone: Tone; overdue: RemRow[]; soon: RemRow[] };
export type RemMail = { html: string; text: string };

export const SOON_DAYS = 7; // invoices falling due in the next 7 days are listed for planning

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const rs = (n: number) => "₹" + inr.format(Math.round(n));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dmy = (iso: string | null) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return m && d ? `${d}-${MON[Number(m) - 1]}-${y.slice(2)}` : "";
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The sender's block under the mail: the company's letterhead. (Change here if it changes.) */
const SIGNATURE: Record<"SPF" | "SAI", string[]> = {
  SPF: ["Thanks & Regards,", "Accounts Department", "M/s. SAMBHAV PIPES & FITTINGS", "(An ISO 9001:2015 Certified Company)", "902, 9th Floor, Prasad Chambers, Opera House,", "Charni Road (E), Mumbai-400 004, Maharashtra.", "Tel (D): +91 22 6784 6061", "Email: accounts@sambhavpipes.com", "URL: www.sambhavpipes.com"],
  SAI: ["Thanks & Regards,", "Accounts Department", "M/s. SAI STEEL & ENGINEERING"],
};
const COMPANY: Record<"SPF" | "SAI", string> = { SPF: "Sambhav Pipes & Fittings", SAI: "Sai Steel & Engineering" };

const th = "border:1px solid #cfd6df;background:#eef2f6;padding:6px 8px;font-size:12px;text-align:left;white-space:nowrap";
const td = "border:1px solid #cfd6df;padding:6px 8px;font-size:12px;vertical-align:top";
const tdr = td + ";text-align:right;white-space:nowrap";

function table(title: string, last: string, rows: RemRow[], total: number, totalLabel: string, daysText: (r: RemRow) => string): string {
  const head = ["Sr", "PO No", "Invoice No", "Invoice Date", "Due Date", "Invoice Value", "Less: Advance / Received", "Balance Due", last];
  const body = rows.map((r, i) => `<tr><td style="${td}">${i + 1}</td><td style="${td}">${esc(r.po)}</td><td style="${td}">${esc(r.invoice)}</td><td style="${td};white-space:nowrap">${dmy(r.invoiceDate)}</td><td style="${td};white-space:nowrap">${dmy(r.dueDate)}</td>`
    + `<td style="${tdr}">${rs(r.value)}</td><td style="${tdr}">${r.received > 0 ? rs(r.received) : "—"}</td><td style="${tdr};font-weight:bold">${rs(r.balance)}</td><td style="${tdr}">${esc(daysText(r))}</td></tr>`).join("");
  return `<p style="margin:18px 0 6px;font-weight:bold">${esc(title)}</p>`
    + `<table style="border-collapse:collapse;font-family:Arial,sans-serif" cellpadding="0" cellspacing="0"><thead><tr>${head.map((h) => `<th style="${th}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}`
    + `<tr><td colspan="7" style="${tdr};font-weight:bold">${esc(totalLabel)}</td><td style="${tdr};font-weight:bold">${rs(total)}</td><td style="${td}"></td></tr></tbody></table>`;
}

export function buildReminder(i: RemInput): RemMail {
  const total = i.overdue.reduce((a, r) => a + r.balance, 0);
  const soonTotal = i.soon.reduce((a, r) => a + r.balance, 0);
  const oldest = i.overdue.reduce<RemRow | null>((a, r) => (!a || r.days > a.days ? r : a), null);
  const co = COMPANY[i.entity];
  const intro = i.tone === "firm"
    ? [`We would like to bring to your attention that our payment is currently overdue${oldest ? ` (the oldest invoice by ${plural(oldest.days, "day")})` : ""}. We humbly request that you make the payment of the outstanding amount immediately.`, `Please find the details below as on ${dmy(i.asOf)}:`]
    : [`Greetings from ${co}.`, `We hope this finds you well. Please find below your statement of account as on ${dmy(i.asOf)} for your kind reference.`];
  const outro = [
    `We would request you to kindly arrange the payment of ${rs(total)} at the earliest, as these invoices are now past the due date.`,
    "If the payment has already been released, please share the UTR / payment details so that we can update our records.",
    "In case of any query or difference in the above, please let us know and we will be happy to reconcile it.",
    "Thank you for your continued support. We value our association and look forward to your kind cooperation.",
  ];
  const sig = SIGNATURE[i.entity];
  const p = (s: string) => `<p style="margin:10px 0">${esc(s)}</p>`;
  const cell = (label: string, big: string, small: string, color: string) =>
    `<td style="border:1px solid #cfd6df;padding:10px 14px;vertical-align:top;min-width:140px"><div style="font-size:10px;letter-spacing:1px;color:#6b7785;font-weight:bold">${esc(label)}</div><div style="font-size:20px;font-weight:bold;color:${color};margin-top:3px">${esc(big)}</div><div style="font-size:11px;color:#6b7785;margin-top:2px">${esc(small)}</div></td>`;
  const strip = `<table style="border-collapse:collapse;font-family:Arial,sans-serif;margin:14px 0" cellpadding="0" cellspacing="0"><tr>`
    + cell("TOTAL PENDING", rs(total), plural(i.overdue.length, "invoice"), "#b3261e")
    + cell("OLDEST OVERDUE", oldest ? plural(oldest.days, "day") : "—", oldest ? `Inv ${oldest.invoice}` : "", "#b3261e")
    + cell("PAYMENT REQUESTED", "At the earliest", "", "#1a2530") + `</tr></table>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a2530;line-height:1.5">`
    + p("Dear Sir / Madam,") + intro.map(p).join("") + strip
    + table("A. Pending Invoices", "Days Overdue", i.overdue, total, "TOTAL", (r) => String(r.days))
    + (i.soon.length ? table("B. Invoices Falling Due Soon (for your planning)", "Due In", i.soon, soonTotal, "TOTAL FALLING DUE", (r) => plural(r.days, "day")) : "")
    + `<div style="margin-top:16px">${outro.map(p).join("")}</div>`
    + `<p style="margin:14px 0 0">${sig.map((l, k) => (k < 2 ? `<b>${esc(l)}</b>` : esc(l))).join("<br>")}</p></div>`;

  const line = (r: RemRow, k: number, last: string) => `${k + 1}. PO ${r.po || "-"} | Invoice ${r.invoice} | ${dmy(r.invoiceDate)} | due ${dmy(r.dueDate)} | invoice ${rs(r.value)} | received ${r.received > 0 ? rs(r.received) : "-"} | balance ${rs(r.balance)} | ${last}`;
  const text = ["Dear Sir / Madam,", "", ...intro.flatMap((s) => [s, ""]),
    `TOTAL PENDING ${rs(total)} (${plural(i.overdue.length, "invoice")})${oldest ? `, oldest overdue ${plural(oldest.days, "day")} (Inv ${oldest.invoice})` : ""}`, "",
    "A. Pending Invoices", ...i.overdue.map((r, k) => line(r, k, `${plural(r.days, "day")} overdue`)), `TOTAL ${rs(total)}`, "",
    ...(i.soon.length ? ["B. Invoices Falling Due Soon (for your planning)", ...i.soon.map((r, k) => line(r, k, `due in ${plural(r.days, "day")}`)), `TOTAL FALLING DUE ${rs(soonTotal)}`, ""] : []),
    ...outro.flatMap((s) => [s, ""]), ...sig].join("\n");
  return { html, text };
}
