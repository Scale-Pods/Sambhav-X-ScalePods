"""Change the Tally connector's secret key without a gap in service. The key is never printed.

  python tools/tally/connector/rotate_key.py prepare   make a new key, store its hash in the database as "pending", and write a ready
                                                       config.json to data/tally-connector-new-config/ (copy that file to the Tally PC,
                                                       then run install.ps1 there so the key is stored encrypted)
  python tools/tally/connector/rotate_key.py status    is the new key pending, or already in use?
  python tools/tally/connector/rotate_key.py finish    once the PC has used the new key (the old one stops working at that moment):
                                                       keep the new key as the current one on this laptop and rebuild the package

The old key keeps working until the PC first uses the new one, so there is no moment when the connector is locked out.
"""
import hashlib, json, os, re, secrets, subprocess, sys
import psycopg

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SECRETS = os.path.join(ROOT, "data", "secrets")
CURRENT = os.path.join(SECRETS, "tally-connector-key.txt")
NEXT = os.path.join(SECRETS, "tally-connector-key-next.txt")
NEW_CONFIG = os.path.join(ROOT, "data", "tally-connector-new-config")


def env(name):
    for line in open(os.path.join(ROOT, "web", ".env.local"), encoding="utf-8"):
        m = re.match(rf"\s*{name}\s*=\s*(.+?)\s*$", line)
        if m:
            return m.group(1).strip("\"'")
    raise SystemExit(f"{name} missing in web/.env.local")


def sha(key):
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def connect():
    return psycopg.connect(env("DATABASE_URL"))


def prepare():
    os.makedirs(SECRETS, exist_ok=True)
    key = "spk_" + secrets.token_urlsafe(48)[:54]
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("update public.tally_connectors set key_hash_next = %s where active returning id", (sha(key),))
        if cur.rowcount != 1:
            raise SystemExit(f"Expected one active connector, found {cur.rowcount}; nothing changed")
        conn.commit()
    open(NEXT, "w").write(key)
    os.makedirs(NEW_CONFIG, exist_ok=True)
    cfg = {
        "supabaseUrl": env("NEXT_PUBLIC_SUPABASE_URL"), "apiKey": env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), "connectorKey": key,
        "tallyUrl": "http://localhost:9001", "companyMatch": "SAMBHAV|SAI STEEL", "fyStart": "20260401", "fyEnd": "20270331",
        "lookbackDays": 45, "chunkDays": 10, "batchSize": 100,
    }
    json.dump(cfg, open(os.path.join(NEW_CONFIG, "config.json"), "w"), indent=2)
    print("A new key is stored as pending (the old key still works).")
    print("Copy this file to the Tally PC, over config.json in E:\\Export\\tally-connector-package\\ScalePods, then run install.ps1 there:")
    print("  " + os.path.join(NEW_CONFIG, "config.json"))


def state():
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("select key_hash, key_hash_next from public.tally_connectors where active")
        rows = cur.fetchall()
    if len(rows) != 1:
        raise SystemExit(f"Expected one active connector, found {len(rows)}")
    return rows[0]


def status():
    cur_h, next_h = state()
    new = open(NEXT).read().strip() if os.path.exists(NEXT) else None
    if new and cur_h == sha(new):
        print("The new key is IN USE: the PC has switched and the old key no longer works. Run `finish`.")
    elif next_h:
        print("A new key is PENDING: the PC has not used it yet; the old key still works.")
    else:
        print("No rotation in progress.")


def finish():
    cur_h, _ = state()
    if not os.path.exists(NEXT):
        raise SystemExit("There is no pending new key on this laptop.")
    new = open(NEXT).read().strip()
    if cur_h != sha(new):
        raise SystemExit("The PC has not used the new key yet, so the old one is still the live key. Nothing changed.")
    open(CURRENT, "w").write(new)
    os.remove(NEXT)
    subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "make_package.py")], check=True)
    for f in os.listdir(NEW_CONFIG) if os.path.isdir(NEW_CONFIG) else []:
        os.remove(os.path.join(NEW_CONFIG, f))
    print("Done: the new key is now the current key here and the package was rebuilt.")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    {"prepare": prepare, "status": status, "finish": finish}.get(cmd, lambda: sys.exit(__doc__))()
