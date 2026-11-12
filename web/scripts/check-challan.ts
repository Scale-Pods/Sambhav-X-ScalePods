// Checks the rules for outward delivery challans on their own (no AI, no database, nothing is spent):  npx tsx scripts/check-challan.ts
import { needsSecondReadFamily, runChallanChecks, type ChallanRead, type ChallanLine } from "../src/lib/docreader/families";

const line = (o: Partial<ChallanLine> = {}): ChallanLine => ({ grade: "GR11", thickness_mm: "6", width_mm: "1250", length_mm: "6300", pieces: "4", heat_no: "33067TC2", weight_kg: "", balance: "", ...o });
const ok = (o: Partial<ChallanRead> = {}): ChallanRead => ({
  family: "challan", challan_no: "T801", challan_date: "2026-10-24", entity: "SPF", plot: "D15", vehicle_no: "MH43BP1234", order_no: "", customer: "", total_weight_kg: "1560",
  loaded_by: "Babu", lines: [line()], readable: true, uncertain: [], ...o,
});
const NOW = new Date("2026-11-13T10:00:00");
let bad = 0;
const t = (name: string, r: ChallanRead, expect: { amber?: RegExp[]; none?: boolean; second?: boolean }) => {
  const checks = runChallanChecks(r, NOW);
  const amber = checks.filter((c) => c.level === "amber");
  let good = true;
  if (expect.none && amber.length) good = false;
  for (const re of expect.amber ?? []) if (!amber.some((c) => re.test(c.field + " " + c.message))) good = false;
  if (expect.second !== undefined && needsSecondReadFamily(r, checks).yes !== expect.second) good = false;
  if (!good) bad++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}${amber.length ? "  -> " + amber.map((c) => c.message.slice(0, 70)).join(" | ") : ""}`);
};

// 4 plates 6x1250x6300 = 1484 kg by the formula; a mill's plates run about 3% heavier, so 1560 kg written is right
t("a good challan: no flags, no second read", ok(), { none: true, second: false });
t("total 3% over the formula is fine", ok({ total_weight_kg: "1530" }), { none: true });
t("a total far off the lines is flagged and re-read", ok({ total_weight_kg: "2400" }), { amber: [/total_weight_kg/], second: true });
t("no heat number on a line", ok({ lines: [line({ heat_no: "" })] }), { amber: [/no heat or plate number/], second: true });
t("a heat that does not look like one", ok({ lines: [line({ heat_no: "??" })] }), { amber: [/does not look like a heat/] });
t("incomplete size", ok({ lines: [line({ width_mm: "" })] }), { amber: [/size is incomplete/] });
t("pieces missing", ok({ lines: [line({ pieces: "" })] }), { amber: [/pieces/] });
t("a written line weight far from the size", ok({ lines: [line({ weight_kg: "900" })] }), { amber: [/should weigh about/] });
t("no challan number", ok({ challan_no: "" }), { amber: [/challan_no/], second: true });
t("a number that is not a challan number", ok({ challan_no: "hello" }), { amber: [/does not look like a challan number/] });
t("K-series numbers are fine", ok({ challan_no: "K302" }), { none: true });
t("a date in the future", ok({ challan_date: "2026-12-31" }), { amber: [/future/] });
t("a date missing", ok({ challan_date: "" }), { amber: [/date/] });
t("entity unclear", ok({ entity: "unclear" }), { amber: [/SPF or Sai/] });
t("no lines", ok({ lines: [] }), { amber: [/No plate lines/], second: true });
t("not readable", ok({ readable: false }), { amber: [/could not read/], second: true });
t("the model flags doubt", ok({ uncertain: ["lines.0.heat_no: could be 33067TC2 or 33067TG2"] }), { none: true, second: true });
t("two heats on one size row (one line each) add up", ok({ lines: [line({ heat_no: "33067TC2", pieces: "2" }), line({ heat_no: "33067TC3", pieces: "2" })] }), { none: true });
t("a thickness typo (60 instead of 6) is flagged by the total", ok({ lines: [line({ thickness_mm: "60" })] }), { amber: [/total_weight_kg/] });
console.log(bad ? `\n${bad} check(s) failed` : "\nall checks passed");
process.exit(bad ? 1 : 0);
