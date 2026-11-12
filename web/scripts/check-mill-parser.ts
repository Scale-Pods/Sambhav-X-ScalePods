// Checks the mill dispatch table reader on the dummy mails (and, if you give a path, on a real file, only printing a summary):
//   npx tsx scripts/make-mill-samples.ts && npx tsx scripts/check-mill-parser.ts [path-to-a-real-mail-file]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDispatch } from "../src/lib/mill/dispatchTable";

const DIR = join(__dirname, "..", "..", "tools", "mail-samples");
let bad = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };

const h1 = readDispatch({ html: readFileSync(join(DIR, "evonith-test-1-spf.html"), "utf8") });
check("html mail 1: 3 rows, read as html", h1.rows.length === 3 && h1.how === "html", `${h1.rows.length} rows`);
check("html mail 1: no warnings on any row", h1.rows.every((r) => r.warnings.length === 0), JSON.stringify(h1.rows.flatMap((r) => r.warnings)));
check("html mail 1: 13.283 t, 21 pieces, one truck", h1.totals.tonnes === 13.283 && h1.totals.pieces === 21 && h1.consignments.length === 1, `${h1.totals.tonnes} t, ${h1.totals.pieces} pcs, ${h1.consignments.length} consignment(s)`);
check("html mail 1: entity SPF, batch, date, rate read", h1.rows[0].entity === "SPF" && h1.rows[0].batch === "TEST1A01" && h1.rows[0].invoice_date === "2026-11-11" && h1.rows[0].upr === 120178 && h1.rows[0].width_mm === 1250 && h1.rows[0].length_mm === 6300);

const h2 = readDispatch({ html: readFileSync(join(DIR, "evonith-test-2-sai.html"), "utf8") });
check("html mail 2: 4 plates for Sai in two consignments", h2.rows.length === 4 && h2.rows.every((r) => r.entity === "SAI") && h2.consignments.length === 2, `${h2.consignments.length} consignment(s)`);
check("html mail 2: invoice values match tonnes x rate + GST", h2.rows.every((r) => r.warnings.length === 0), JSON.stringify(h2.rows.flatMap((r) => r.warnings)));

const t3 = readDispatch({ text: readFileSync(join(DIR, "evonith-test-3-body.txt"), "utf8") });
check("text body (table twice, empty cells missing): the 3 rows once", t3.rows.length === 3 && t3.how === "text", `${t3.rows.length} rows`);
check("text body: same totals as the html mail", t3.totals.tonnes === h1.totals.tonnes && t3.rows.every((r) => r.warnings.length === 0), `${t3.totals.tonnes} t`);
check("text body: repeated rows are mentioned", t3.warnings.some((w) => /repeated/.test(w)), t3.warnings.join("; "));
check("text and html give the same batches", JSON.stringify(t3.rows.map((r) => r.batch)) === JSON.stringify(h1.rows.map((r) => r.batch)));

const bent = readFileSync(join(DIR, "evonith-test-1-spf.html"), "utf8").replace("5.058", "5.558");
const b = readDispatch({ html: bent });
check("a changed weight is caught by the value check", b.rows.some((r) => r.warnings.some((w) => /does not match/.test(w))), b.rows.flatMap((r) => r.warnings).join("; ").slice(0, 120));
const clipped = readDispatch({ text: readFileSync(join(DIR, "evonith-test-3-body.txt"), "utf8") + "\n...\n[Message clipped]  View entire message" });
check("a clipped mail is flagged", clipped.warnings.some((w) => /clipped/.test(w)));
const none = readDispatch({ text: "Hello, nothing here" });
check("a mail with no table gives no rows", none.rows.length === 0 && none.how === "none");

const real = process.argv[2];
if (real) {
  const raw = readFileSync(real, "utf8");
  const r = readDispatch(/<table/i.test(raw) ? { html: raw } : { text: raw });
  console.log(`\nreal file: ${r.rows.length} rows read as ${r.how}, ${r.totals.pieces} pieces, ${r.totals.tonnes} t, value ${r.totals.value.toLocaleString("en-IN")}, ${r.consignments.length} consignment(s), ${r.rows.filter((x) => x.warnings.length).length} row(s) with warnings; ${r.warnings.join("; ") || "no mail-level warnings"}`);
  for (const c of r.consignments) console.log(`  truck ${c.truck_no} tc ${c.tc_no} ${c.entity} ${c.destination}: ${c.plates} plates, ${c.pieces} pieces, ${c.tonnes} t, invoices ${c.invoices.join(", ")}`);
}
console.log(bad ? `\n${bad} check(s) failed` : "\nall checks passed");
process.exit(bad ? 1 : 0);
