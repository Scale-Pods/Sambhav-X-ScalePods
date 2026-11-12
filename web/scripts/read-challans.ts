// PAID TEST (a few rupees): reads photos of delivery challans from a folder the way the app will, and prints what it read and what the rules flag. Nothing is saved anywhere.
//   npx tsx scripts/read-challans.ts "<folder with the photos>" [--limit 3] [--out result.json]
// Each photo costs about 0.1-0.2 US cents with the first model; the stronger model is only used when the rules or the model show doubt.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { CHALLAN_SCHEMA, CHALLAN_SYSTEM, TRIAGE_SCHEMA, TRIAGE_SYSTEM, needsSecondReadFamily, runChallanChecks, type ChallanRead } from "../src/lib/docreader/families";

const env = Object.fromEntries(readFileSync(join(__dirname, "..", ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 150_000 });
const MODELS = { first: { id: "claude-haiku-5-5", in: 0.1, out: 0.5 }, second: { id: "claude-sonnet-5-5", in: 2, out: 10 } } as const;
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const folder = process.argv[2];
if (!folder || folder.startsWith("--")) { console.error('usage: npx tsx scripts/read-challans.ts "<folder>" [--limit N] [--out file.json]'); process.exit(1); }
const limit = Number(arg("--limit") ?? 99);

async function image(buf: Buffer, turn: number): Promise<Anthropic.ImageBlockParam> {
  const upright = await sharp(buf).rotate().toBuffer(); // the camera's own orientation tag first
  const out = await (turn ? sharp(upright).rotate(turn) : sharp(upright)).resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: out.toString("base64") } };
}
const usd = (m: { in: number; out: number }, u: { input_tokens: number; output_tokens: number }) => (u.input_tokens * m.in + u.output_tokens * m.out) / 1e6;

async function main() {
  const files = readdirSync(folder).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort().slice(0, limit);
  let total = 0;
  const results: unknown[] = [];
  for (const f of files) {
    const buf = readFileSync(join(folder, f));
    let spent = 0;
    // 1. what is it, and which way up?
    const first = await image(buf, 0);
    const tri = await client.messages.create({
      model: MODELS.first.id, max_tokens: 100, system: TRIAGE_SYSTEM, output_config: { format: { type: "json_schema", schema: TRIAGE_SCHEMA as Record<string, unknown> } },
      messages: [{ role: "user", content: [first, { type: "text", text: "What kind of document is this?" }] }],
    });
    spent += usd(MODELS.first, tri.usage);
    const t = JSON.parse((tri.content.find((b) => b.type === "text") as Anthropic.TextBlock).text) as { family: string; rotate: string };
    const turn = Number(t.rotate) || 0;
    // 2. the challan read on the upright picture
    const pic = turn ? await image(buf, turn) : first;
    const note = `File name: ${f}. `;
    const read = async (stage: "first" | "second") => {
      const m = MODELS[stage];
      const r = await client.messages.create({
        model: m.id, max_tokens: 8000, system: CHALLAN_SYSTEM, output_config: { format: { type: "json_schema", schema: CHALLAN_SCHEMA as Record<string, unknown> } },
        messages: [{ role: "user", content: [pic, { type: "text", text: `${note}Extract the document.` }] }],
      });
      spent += usd(m, r.usage);
      return { ...(JSON.parse((r.content.find((b) => b.type === "text") as Anthropic.TextBlock).text) as object), family: "challan" } as ChallanRead;
    };
    let stage: "first" | "second" = "first";
    let r = await read("first");
    let checks = runChallanChecks(r);
    const again = needsSecondReadFamily(r, checks);
    if (again.yes) { stage = "second"; r = await read("second"); checks = runChallanChecks(r); }
    total += spent;
    const amber = checks.filter((c) => c.level === "amber");
    console.log(`\n${f}\n  triage: ${t.family}, turn ${turn} | read by ${stage === "second" ? "Sonnet (after doubt: " + again.why.join(", ") + ")" : "Haiku"} | $${spent.toFixed(4)}`);
    console.log(`  ${r.challan_no || "(no number)"} · ${r.challan_date} · ${r.entity} · plot ${r.plot || "-"} · vehicle ${r.vehicle_no || "-"} · to ${r.customer || "-"} · total ${r.total_weight_kg || "-"} kg · ${r.lines.length} line(s)`);
    for (const l of r.lines) console.log(`    ${l.grade} ${l.thickness_mm}x${l.width_mm}x${l.length_mm} ${l.pieces} pcs  heat ${l.heat_no}${l.balance ? "  balance " + l.balance : ""}`);
    for (const c of amber) console.log(`  CHECK: ${c.message}`);
    for (const u of r.uncertain.slice(0, 4)) console.log(`  unsure: ${u}`);
    results.push({ file: f, triage: t, stage, read: r, checks });
  }
  console.log(`\n${files.length} photo(s), about $${total.toFixed(3)} in all (~₹${(total * 88).toFixed(1)})`);
  const out = arg("--out");
  if (out) writeFileSync(out, JSON.stringify(results, null, 1));
}
main().catch((e) => { console.error("failed:", e instanceof Error ? e.message : e); process.exit(1); });
