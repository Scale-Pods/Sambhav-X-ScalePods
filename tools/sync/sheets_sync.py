"""One-way mirror of the client's Google Sheets into Supabase (sheets -> database; nothing is ever written back to a sheet).

  python tools/sync/sheets_sync.py --seed         register the sheets from data/sheets-registry.json (first time, or when a sheet is added)
  python tools/sync/sheets_sync.py                sync every active sheet that changed since the last run
  python tools/sync/sheets_sync.py --force        re-read every active sheet
  python tools/sync/sheets_sync.py --only dispatch_fms

How it works: for each sheet, ask Drive for its "modified" time (one cheap call). If it has not changed since the last run, do nothing.
Otherwise read the whole sheet once (displayed text + any link behind a cell), compare each row's hash with what is stored, and
write only new / edited rows. Edits to rows that were already stored are listed in sheet_row_changes; the very first read of a sheet
is a silent baseline. Rows that became empty are marked deleted, never removed.

Credentials: GOOGLE_SERVICE_ACCOUNT_JSON (the key as text) or the file secrets/google-service-account.json. DATABASE_URL from the
environment or .env.local. Nothing secret is ever printed.
"""
import argparse
import hashlib
import io
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from psycopg.types.json import Jsonb

if (sys.stdout.encoding or '').lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.readonly"]
# tabs that hold keys, passwords or add-on settings are never copied
DEFAULT_SKIP = {"indiamart": ["Settings", "CEOITBOX"], "email_tracker": ["Settings"]}


def db_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    sys.exit("DATABASE_URL missing")


def google():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if raw:
        creds = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=SCOPES)
    else:
        creds = service_account.Credentials.from_service_account_file(str(ROOT / "secrets" / "google-service-account.json"), scopes=SCOPES)
    return (build("sheets", "v4", credentials=creds, cache_discovery=False), build("drive", "v3", credentials=creds, cache_discovery=False))


def read_sheet(sheets, spreadsheet_id: str, skip: set[str]) -> tuple[dict[str, list[tuple[int, list[str], dict]]], list[dict]]:
    """(tab -> [(row_no, cells, links)] for the non-empty rows, [{title, hidden, gid}] in the sheet's own tab order (gid lets a link open the exact tab))."""
    fields = "sheets(properties(sheetId,title,index,hidden),data(startRow,rowData(values(formattedValue,hyperlink))))"
    meta = sheets.spreadsheets().get(spreadsheetId=spreadsheet_id, includeGridData=True, fields=fields).execute(num_retries=3)
    out, order = {}, []
    for sh in sorted(meta["sheets"], key=lambda x: x["properties"].get("index", 0)):
        title = sh["properties"]["title"]
        if title in skip:
            continue
        order.append({"title": title, "hidden": bool(sh["properties"].get("hidden")), "gid": sh["properties"].get("sheetId")})
        rows = []
        for grid in sh.get("data", []):
            start = grid.get("startRow", 0)
            for i, rd in enumerate(grid.get("rowData", [])):
                vals = rd.get("values", [])
                cells = [v.get("formattedValue", "") for v in vals]
                while cells and cells[-1] == "":
                    cells.pop()
                if not cells:
                    continue
                links = {str(j): v["hyperlink"] for j, v in enumerate(vals) if v.get("hyperlink")}
                rows.append((start + i + 1, cells, links))
        out[title] = rows
    return out, order


def digest(cells, links) -> str:
    return hashlib.sha1(json.dumps([cells, links], ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def seed(cur) -> None:
    reg = json.load(open(ROOT / "data" / "sheets-registry.json", encoding="utf-8"))
    for s in reg:
        cur.execute("""insert into public.sheet_sources (key, name, spreadsheet_id, skip_tabs) values (%s,%s,%s,%s)
                       on conflict (key) do update set name = excluded.name, spreadsheet_id = excluded.spreadsheet_id""",
                    (s["key"], s["name"], s["id"], DEFAULT_SKIP.get(s["key"], [])))
    print(f"registered {len(reg)} sheets")


def sync_one(conn, sheets, drive, src, force: bool) -> str:
    key, name, sid, skip, last_mod = src
    cur = conn.cursor()
    cur.execute("select pg_try_advisory_lock(hashtext(%s))", (key,))
    if not cur.fetchone()[0]:
        return "busy"
    cur.execute("insert into public.sheet_sync_runs (source_key) values (%s) returning id", (key,))
    run = cur.fetchone()[0]
    conn.commit()
    try:
        modified = drive.files().get(fileId=sid, fields="modifiedTime", supportsAllDrives=True).execute(num_retries=3)["modifiedTime"]
        mod_dt = datetime.fromisoformat(modified.replace("Z", "+00:00"))
        if not force and last_mod and mod_dt <= last_mod:
            cur.execute("update public.sheet_sync_runs set status='skipped', finished_at=now() where id=%s", (run,))
            conn.commit()
            return "unchanged"

        data, order = read_sheet(sheets, sid, set(skip or []))
        cur.execute("select count(*) from public.sheet_rows where source_key=%s", (key,))
        baseline = cur.fetchone()[0] == 0
        seen = new = changed = removed = 0
        for tab, rows in data.items():
            cur.execute("select row_no, row_hash, deleted_at is not null from public.sheet_rows where source_key=%s and tab=%s", (key, tab))
            have = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
            now_rows = {n: (cells, links, digest(cells, links)) for n, cells, links in rows}
            seen += len(now_rows)
            todo = [n for n, (_, _, h) in now_rows.items() if n not in have or have[n][0] != h or have[n][1]]
            old = {}
            edited = [n for n in todo if n in have and not have[n][1]]
            if edited:
                cur.execute("select row_no, cells from public.sheet_rows where source_key=%s and tab=%s and row_no = any(%s)", (key, tab, edited))
                old = {r[0]: r[1] for r in cur.fetchall()}
            if todo:
                cur.executemany("""insert into public.sheet_rows (source_key, tab, row_no, cells, links, row_hash) values (%s,%s,%s,%s,%s,%s)
                                   on conflict (source_key, tab, row_no) do update
                                   set cells = excluded.cells, links = excluded.links, row_hash = excluded.row_hash, changed_at = now(), deleted_at = null""",
                                [(key, tab, n, Jsonb(now_rows[n][0]), Jsonb(now_rows[n][1]) if now_rows[n][1] else None, now_rows[n][2]) for n in todo])
            if not baseline:
                logs = []
                for n in todo:
                    if n not in have or have[n][1]:
                        logs.append((key, tab, n, "new", None, Jsonb(now_rows[n][0])))
                    else:
                        logs.append((key, tab, n, "edit", Jsonb(old.get(n)), Jsonb(now_rows[n][0])))
                if logs:
                    cur.executemany("insert into public.sheet_row_changes (source_key, tab, row_no, kind, old_cells, new_cells) values (%s,%s,%s,%s,%s,%s)", logs)
            new += sum(1 for n in todo if n not in have)
            changed += sum(1 for n in todo if n in have)
            gone = [n for n, (_, was_deleted) in have.items() if not was_deleted and n not in now_rows]
            if gone:
                cur.execute("select row_no, cells from public.sheet_rows where source_key=%s and tab=%s and row_no = any(%s)", (key, tab, gone))
                was = {r[0]: r[1] for r in cur.fetchall()}
                cur.execute("update public.sheet_rows set deleted_at = now(), changed_at = now() where source_key=%s and tab=%s and row_no = any(%s)", (key, tab, gone))
                if not baseline:
                    cur.executemany("insert into public.sheet_row_changes (source_key, tab, row_no, kind, old_cells) values (%s,%s,%s,'removed',%s)",
                                    [(key, tab, n, Jsonb(was.get(n))) for n in gone])
                removed += len(gone)
        # a tab that disappeared from the sheet: its rows are marked deleted
        cur.execute("update public.sheet_rows set deleted_at = now(), changed_at = now() where source_key=%s and deleted_at is null and not (tab = any(%s))", (key, list(data.keys())))
        removed += cur.rowcount
        cur.execute("update public.sheet_sources set last_modified_at=%s, last_synced_at=now(), last_error=null, tabs=%s where key=%s", (mod_dt, Jsonb(order), key))
        cur.execute("""update public.sheet_sync_runs set status='ok', finished_at=now(), tabs=%s, rows_seen=%s, rows_new=%s, rows_changed=%s, rows_removed=%s where id=%s""",
                    (len(data), seen, new, changed, removed, run))
        conn.commit()
        return f"{len(data)} tabs, {seen} rows ({'baseline' if baseline else f'+{new} new, {changed} changed, {removed} removed'})"
    except HttpError as e:
        conn.rollback()
        msg = f"Google {e.resp.status}: " + (json.loads(e.content)["error"]["message"][:200] if e.content else "")
        cur.execute("update public.sheet_sources set last_error=%s where key=%s", (msg, key))
        cur.execute("update public.sheet_sync_runs set status='failed', finished_at=now(), error=%s where id=%s", (msg, run))
        conn.commit()
        return "FAILED " + msg
    except Exception as e:  # keep going with the other sheets; the error is stored and visible
        conn.rollback()
        msg = f"{type(e).__name__}: {str(e)[:200]}"
        cur.execute("update public.sheet_sources set last_error=%s where key=%s", (msg, key))
        cur.execute("update public.sheet_sync_runs set status='failed', finished_at=now(), error=%s where id=%s", (msg, run))
        conn.commit()
        return "FAILED " + msg
    finally:
        cur.execute("select pg_advisory_unlock(hashtext(%s))", (key,))
        conn.commit()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only")
    a = ap.parse_args()
    with psycopg.connect(db_url()) as conn:
        cur = conn.cursor()
        if a.seed:
            seed(cur)
            conn.commit()
            return
        sheets, drive = google()
        cur.execute("select key, name, spreadsheet_id, skip_tabs, last_modified_at from public.sheet_sources where active and (%s::text is null or key = %s) order by key", (a.only, a.only))
        for src in cur.fetchall():
            t = time.time()
            print(f"{src[0]:20} {sync_one(conn, sheets, drive, src, a.force)}  ({time.time() - t:.1f}s)")
        # the app reads stored copies of the sheet-based views (migration 22): rebuild them from what was just synced
        t = time.time()
        cur.execute("select app.refresh_sheet_stores()")
        conn.commit()
        print(f"{'stored views':20} refreshed  ({time.time() - t:.1f}s)")


if __name__ == "__main__":
    main()
