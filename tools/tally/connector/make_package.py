"""Build the folder to copy to the Tally PC: the connector, install/uninstall scripts and a ready config.json holding the secret key.
  python tools/tally/connector/make_package.py
Output: data/tally-connector-package/ (git-ignored: it contains the secret key) and a zip next to it.
The key is read from data/secrets/tally-connector-key.txt. It is never printed.
"""
import json, os, re, shutil, zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "data", "tally-connector-package")


def env(name):
    for line in open(os.path.join(ROOT, "web", ".env.local"), encoding="utf-8"):
        m = re.match(rf"\s*{name}\s*=\s*(.+?)\s*$", line)
        if m:
            return m.group(1).strip("\"'")
    raise SystemExit(f"{name} missing in web/.env.local")


key = open(os.path.join(ROOT, "data", "secrets", "tally-connector-key.txt")).read().strip()
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
here = os.path.dirname(__file__)
for f in ("tally-connector.ps1", "install.ps1", "uninstall.ps1"):
    shutil.copy(os.path.join(here, f), OUT)
cfg = {
    "supabaseUrl": env("NEXT_PUBLIC_SUPABASE_URL"),
    "apiKey": env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    "connectorKey": key,
    "tallyUrl": "http://localhost:9001",
    "companyMatch": "SAMBHAV|SAI STEEL",  # companies to read, separated by |; check the exact names with -Mode Companies
    "fyStart": "20260401",
    "fyEnd": "20270331",
    "lookbackDays": 45,
    "chunkDays": 10,
    "batchSize": 100,
}
json.dump(cfg, open(os.path.join(OUT, "config.json"), "w"), indent=2)
open(os.path.join(OUT, "README.txt"), "w").write(
    """ScalePods Tally connector
=========================
Reads TallyPrime on this PC (read-only) and sends it to ScalePods over the internet. Installs no software.

1. Copy this whole folder to E:\\ScalePods (keep config.json private: it holds the secret key).
2. Open TallyPrime with the Sambhav Pipes & Fittings company loaded (port 9001).
3. Open PowerShell in the folder and run, once:
     powershell -ExecutionPolicy Bypass -File .\\tally-connector.ps1 -Mode Detect
   It prints which date format this Tally accepts. Send ScalePods a screenshot.
4. Then install the two scheduled tasks:
     powershell -ExecutionPolicy Bypass -File .\\install.ps1
5. The first night reads the whole financial year, then the last 45 days each night.
   Logs are in the logs folder. To stop: run uninstall.ps1.

Keep Tally open and the PC on. DISCONNECT the remote session instead of signing out.
""")
zpath = OUT + ".zip"
if os.path.exists(zpath):
    os.remove(zpath)
with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
    for f in os.listdir(OUT):
        z.write(os.path.join(OUT, f), os.path.join("ScalePods", f))
print("package:", OUT)
print("zip:    ", zpath, f"({os.path.getsize(zpath):,} bytes)")
print("files:  ", sorted(os.listdir(OUT)))
