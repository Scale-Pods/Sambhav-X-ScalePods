"""Group the free-text grade spellings in Dispatch FMS into a canonical grade list with aliases.

Output goes to data/ (gitignored, contains client data):
  data/seed_grades.sql      - inserts for public.grades and public.grade_aliases
  data/grades_review.csv    - one row per canonical grade, for a human to check

Rules (conservative on purpose; ambiguous merges are left for a person):
  upper-case, GRADE -> GR, CLASS -> CL, drop punctuation/spaces, drop a leading MS,
  drop a trailing PLATE/PLATES, restore an implied SA prefix on a bare ASME number.
Not merged automatically: ASTM A106 vs SA 106, CL 1 vs CL 2, IS 2062 E250BR vs E250GRBR.
"""
import csv
import io
import re
import sys
import warnings
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

warnings.filterwarnings("ignore")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

DATA = Path(__file__).resolve().parents[2] / "data"
ASME = ("387", "516", "335", "106", "240", "182", "234", "537", "105", "333", "350")
PIPE_HINTS = ("SA335", "SA106", "ASTMA106", "IS1239", "SA234", "SA182", "SA105", "A105", "A234", "ELBOW", "TEE",
              "REDUCER", "FLANGE", "PIPE", "TUBE", "SCH", "FITTING", "BEND")


def group_key(raw: str) -> str:
    s = raw.upper()
    s = re.sub(r"\bGRADE\b", "GR", s)
    s = re.sub(r"\bCLASS\b", "CL", s)
    k = re.sub(r"[^A-Z0-9]", "", s)
    k = re.sub(r"^MS(?=[A-Z0-9])", "", k)
    k = re.sub(r"PLATES?$", "", k)
    if k.startswith(ASME):
        k = "SA" + k
    return k


def clean_display(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.upper().strip())


def sql_str(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


def main() -> None:
    fr = pd.read_excel(DATA / "Dispatch FMS.xlsx", sheet_name="FormResponses", header=1).dropna(how="all")
    counts = Counter(str(v).strip() for v in fr["Grade"].dropna() if str(v).strip() and str(v).strip().lower() != "nan")

    groups: dict[str, Counter] = defaultdict(Counter)
    for raw, n in counts.items():
        groups[group_key(raw)][raw] += n

    rows = []
    for key, spellings in groups.items():
        if not key:
            continue
        nice = [s for s in spellings if re.fullmatch(r"[A-Za-z0-9 .\-/&:;,()]+", s)]
        pool = nice or list(spellings)
        canonical = clean_display(max(pool, key=lambda s: spellings[s]))
        family_m = re.match(r"^(SA\d+|IS\d+|A\d+|SS\d+|S\d+[A-Z]*|ROCKSTAR\d*|[0-9]+MO3|[A-Z]+\d+)", key)
        rows.append({
            "key": key,
            "code": canonical,
            "family": family_m.group(1) if family_m else None,
            "lines": sum(spellings.values()),
            "aliases": sorted(spellings),
            "is_plate": not any(h in key for h in PIPE_HINTS),
        })
    rows.sort(key=lambda r: -r["lines"])

    # canonical codes must be unique
    seen: dict[str, int] = {}
    for r in rows:
        c = r["code"]
        if c in seen:
            seen[c] += 1
            r["code"] = f"{c} ({seen[c]})"
        else:
            seen[c] = 1

    with open(DATA / "grades_review.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["canonical_grade", "order_lines", "alias_count", "is_plate_guess", "aliases"])
        for r in rows:
            w.writerow([r["code"], r["lines"], len(r["aliases"]), r["is_plate"], " | ".join(r["aliases"])])

    out = ["-- Grade master auto-grouped from Dispatch FMS. NEEDS HUMAN REVIEW (see data/grades_review.csv).", ""]
    out.append("insert into public.grades (code, family, is_plate, notes) values")
    out.append(",\n".join(
        f"  ({sql_str(r['code'])}, {sql_str(r['family']) if r['family'] else 'null'}, {str(r['is_plate']).lower()}, "
        f"{sql_str('auto-grouped from Dispatch FMS (' + str(r['lines']) + ' lines); needs review')})"
        for r in rows) + ";")
    out.append("")
    out.append("insert into public.grade_aliases (grade_id, alias)\nselect g.id, v.alias from (values")
    alias_rows = []
    used_norm = set()
    for r in rows:
        for a in r["aliases"]:
            nrm = re.sub(r"[^A-Z0-9]+", "", a.upper())
            if nrm in used_norm:
                continue
            used_norm.add(nrm)
            alias_rows.append(f"  ({sql_str(r['code'])}, {sql_str(a)})")
    out.append(",\n".join(alias_rows))
    out.append(") as v(code, alias) join public.grades g on g.code = v.code\non conflict (alias_norm) do nothing;")
    (DATA / "seed_grades.sql").write_text("\n".join(out), encoding="utf-8")

    print(f"raw spellings: {len(counts)}  ->  canonical grades: {len(rows)}  aliases: {len(alias_rows)}")
    print("lines covered:", sum(r["lines"] for r in rows), "of", sum(counts.values()))
    print("non-plate guesses:", sum(1 for r in rows if not r["is_plate"]))
    print("top 15:")
    for r in rows[:15]:
        print(f"  {r['code']:32} lines={r['lines']:4d} aliases={len(r['aliases'])}")
    print("singletons:", sum(1 for r in rows if len(r['aliases']) == 1 and r['lines'] == 1))


if __name__ == "__main__":
    main()
