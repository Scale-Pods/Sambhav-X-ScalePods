// Run the comparison:   cd web && TEST_UID=<an administrator's auth id> node --env-file=.env.local ../tools/model-compare/run.mjs
// (models to test: MODELS=a,b   ask as AI mode: QUICK=1   results file: OUT=...). Spends real money on every model whose key is set: it asks 8 questions of each.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileSync, rmSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url)).replaceAll("\\", "/");
const web = path.resolve(here, "../../web").replaceAll("\\", "/");
const { build } = createRequire(`${web}/package.json`)("esbuild"); // esbuild lives in the web project
const out = `${web}/zz-model-compare.mjs`;
await build({
  entryPoints: [`${here}/compare.ts`], bundle: true, platform: "node", format: "esm", outfile: out, external: ["pg", "@anthropic-ai/sdk", "openai", "mupdf", "sharp"],
  alias: { "server-only": `${here}/empty.ts` },
  plugins: [{ name: "stub", setup(b) {
    b.onResolve({ filter: /(^|\/)(db|auth)$/ }, (a) => (a.importer.replaceAll("\\", "/").includes("/web/") ? { path: `${here}/stubdb.ts` } : null));
    b.onResolve({ filter: /^@\// }, (a) => ({ path: `${web}/src/${a.path.slice(2)}.ts` }));
  } }],
});
const { spawnSync } = await import("node:child_process");
const r = spawnSync(process.execPath, [out], { stdio: "inherit", cwd: web, env: { ...process.env, OUT: process.env.OUT || `${web}/../data/model-compare.json` } });
rmSync(out, { force: true });
process.exit(r.status ?? 0);
