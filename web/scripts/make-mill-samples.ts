// Makes the dummy "Dispatch details" mails used to test the mail sync before any real Evonith mail is connected:  npx tsx scripts/make-mill-samples.ts
// They copy the layout of the real mills' table but every number, batch and invoice is made up (batches start with TEST), so they can be added and deleted freely.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(__dirname, "..", "..", "tools", "mail-samples");
mkdirSync(OUT, { recursive: true });

const HEADERS = ["Cust. Name", "Material Desc", "Material", "SO No./Item", "Thick", "Width", "Length", "Pieces", "Quantity", "Class", "Inv.No./Item", "Invoice Value", "Inv.Date", "Batch", "UPR", "Freight Per Ton", "Quality", "Cus. Grade", "Order Type", "Ship-to-Party Name", "Destination", "Driver phonenumner", "Trans. Name", "Truck No.", "Gross Weight", "TC Number", "Supplier Batch", "Supplied HR Material", "Material Group", "Customer Segment", "Discount"];

const indian = (n: number, d = 2) => { const [i, f] = n.toFixed(d).split("."); const l = i.slice(-3), r = i.slice(0, -3); return (r ? r.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + l + "." + f; };
type S = { cust: string; desc: string; code: string; so: string; thk: number; w: number; l: number; pcs: number; t: number; inv: string; date: string; batch: string; upr: number; grade: string; type: string; dest: string; trans: string; truck: string; tc: string; phone?: string };
const cells = (s: S) => [s.cust, s.desc, s.code, s.so, s.thk.toFixed(2), indian(s.w, 3).replace(/\.000$/, ".000"), String(s.l).replace(/\B(?=(\d{3})+(?!\d))/g, ","), String(s.pcs), s.t.toFixed(3), "", s.inv, indian(s.t * s.upr * 1.18, 3), s.date, s.batch, indian(s.upr), indian(2178), "OK", s.grade, s.type, s.cust, s.dest, s.phone ?? "", s.trans, s.truck, "", s.tc, "", "", "H03", "TRD", "0.00"];

const SPF = "SAMBHAV PIPES & FITTINGS", SAI = "SAI STEEL AND ENGINEERING COMPANY";
const spf = (n: number, batch: string, thk: number, pcs: number, t: number, inv: string): S => ({ cust: SPF, desc: "HR SHEET(5 TO 10MM)", code: "H03000LAS010B0H", so: "0000099001/000010", thk, w: 1250, l: 6300, pcs, t, inv, date: "11-11-2026", batch, upr: 120178, grade: "SA387 GR11CL2", type: "ZPRM", dest: "TALOJA", trans: "TEST CARRIERS PVT LTD", truck: "MH00TS0001", tc: "99000001", phone: "9000000001" });
const sai = (batch: string, inv: string, tc: string): S => ({ cust: SAI, desc: "HR PLATE", code: "H01000LAS070000", so: "0000099002/000010", thk: 20, w: 1250, l: 5000, pcs: 1, t: 1.012, inv, date: "11-11-2026", batch, upr: 67678, grade: "EVSLAS07 (EVONITH HARD)", type: "ZPRM", dest: "KALAMBOLI", trans: "TEST SONIC CARRIER", truck: "MH00TS0002", tc });

const mail1 = [spf(1, "TEST1A01", 10, 5, 3.158, "2699000001/000010"), spf(2, "TEST1A02", 10, 8, 5.058, "2699000001/000020"), spf(3, "TEST1A03", 10, 8, 5.067, "2699000001/000030")];
const mail2 = [sai("TEST2B01", "2699000002/000010", "99000002"), sai("TEST2B02", "2699000002/000020", "99000002"), sai("TEST2B03", "2699000002/000030", "99000002"), sai("TEST2B04", "2699000003/000010", "99000003")];

const html = (rows: S[]) => `<!doctype html><html><body><p>Dispatch details</p>\n<table border="1" cellspacing="0">\n<tr>${HEADERS.map((h) => `<th>${h}</th>`).join("")}</tr>\n${rows.map((r) => `<tr>${cells(r).map((c) => `<td>${(c || "&nbsp;").replace(/&/g, "&amp;").replace("&amp;nbsp;", "&nbsp;")}</td>`).join("")}</tr>`).join("\n")}\n</table></body></html>\n`;

// the mail body as copied out of Gmail: the table twice, once with the empty cells missing and once with them as blanks
const body = (rows: S[]) => {
  const head = HEADERS.join("\n\n");
  const first = rows.map((r) => cells(r).filter((c) => c !== "").join("\n\n")).join("\n\n\n");
  const second = rows.map((r) => cells(r).map((c) => (c === "" ? " " : c)).join("\n\n")).join("\n\n");
  return `Dear Team,\n\nPlease find below the material inward / dispatch details received from Evonith (TEST).\n\nRegards,\nTest Sender\n\n---------- Forwarded message ----------\nDispatch details\n\n${head}\n\n${first}\n\nDispatch details\n\n${head}\n\n${second}\n`;
};

writeFileSync(join(OUT, "evonith-test-1-spf.html"), html(mail1));
writeFileSync(join(OUT, "evonith-test-2-sai.html"), html(mail2));
writeFileSync(join(OUT, "evonith-test-3-body.txt"), body(mail1));
writeFileSync(join(OUT, "README.md"), "# Dummy Evonith mails for testing\n\nMade up (batches start with TEST). Attach `evonith-test-1-spf.html` or `evonith-test-2-sai.html` to a mail with the subject `Dispatch details` and send it to the connected inbox; `evonith-test-3-body.txt` is the same table as it looks when pasted into a mail body.\nRemake them with `npx tsx scripts/make-mill-samples.ts` (in `web/`).\n");
console.log("written to", OUT);
