"""Download a random sample of vendor purchase invoices and mill certificates from the Drive links in the sheets, for trying the readers.
  python tools/docs-trial/fetch_family_samples.py [count per family]
Files go to data/phase0-fam/ (git-ignored: they are the client's documents). Uses the robot account that already reads the sheets (read only).
"""
import csv, io, os, random, re, sys

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
N = int(sys.argv[1]) if len(sys.argv) > 1 else 25
OUT = os.path.join(ROOT, "data", "phase0-fam")
creds = service_account.Credentials.from_service_account_file(os.path.join(ROOT, "secrets", "google-service-account.json"), scopes=["https://www.googleapis.com/auth/drive.readonly"])
drive = build("drive", "v3", credentials=creds, cache_discovery=False)


def fid(u):
    m = re.search(r"(?:id=|/d/)([A-Za-z0-9_-]{20,})", u)
    return m.group(1) if m else None


rows = list(csv.DictReader(open(os.path.join(ROOT, "data", "document-links.csv"), encoding="utf-8")))
sets = {
    "invoices": [r for r in rows if r["tab"] in ("Spf Pur", "Sai Pur") and r["column"] == "Upload Invoice"],
    "certs": [r for r in rows if r["file"].startswith("1_") and r["column"] in ("col 9", "col 12", "col 15")],
}
random.seed(11)
OK = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}
for kind, pool in sets.items():
    os.makedirs(os.path.join(OUT, kind), exist_ok=True)
    random.shuffle(pool)
    seen, got = set(), 0
    for r in pool:
        f = fid(r["url"])
        if not f or f in seen:
            continue
        seen.add(f)
        try:
            m = drive.files().get(fileId=f, fields="id,name,mimeType,size", supportsAllDrives=True).execute()
            if m["mimeType"] not in OK or int(m.get("size", 0)) > 8_000_000:
                continue
            buf = io.BytesIO()
            dl = MediaIoBaseDownload(buf, drive.files().get_media(fileId=f, supportsAllDrives=True))
            done = False
            while not done:
                _, done = dl.next_chunk()
            name = f"{got + 1:02d}_{f[:8]}{OK[m['mimeType']]}"
            open(os.path.join(OUT, kind, name), "wb").write(buf.getvalue())
            got += 1
            print(kind, name, m["mimeType"], m.get("size"))
        except Exception as e:  # not shared, deleted, a folder ...
            continue
        if got >= N:
            break
    print(kind, "downloaded", got)
