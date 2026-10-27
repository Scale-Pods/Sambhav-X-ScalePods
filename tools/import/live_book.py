"""Read a Google Sheet as typed values, shaped like an openpyxl workbook, so the WB1 / WB2 parsers can read the live sheets.

The Sheets API gives, per cell, the real value (a number is a number, a date is a serial number with a date format), the formula if there is one
and the link behind the cell: the same three things the xlsx copy gave. Nothing is ever written to a sheet.
"""
import datetime as dt

FIELDS = ("sheets(properties(sheetId,title,hidden),data(startRow,startColumn,rowData(values("
          "effectiveValue,userEnteredValue,hyperlink,effectiveFormat(numberFormat(type))))))")


class _Link:
    def __init__(self, target):
        self.target = target


class _Cell:
    __slots__ = ("value", "hyperlink")

    def __init__(self, value=None, link=None):
        self.value = value
        self.hyperlink = _Link(link) if link else None


_EMPTY = _Cell()


class Sheet:
    def __init__(self, cells: dict, max_row: int, max_col: int):
        self._c, self.max_row, self.max_column = cells, max_row, max_col

    def cell(self, r: int, c: int) -> _Cell:
        return self._c.get((r, c), _EMPTY)


def _typed(v: dict):
    ev = v.get("effectiveValue")
    if not ev:
        return None
    if "numberValue" in ev:
        n = ev["numberValue"]
        if v.get("effectiveFormat", {}).get("numberFormat", {}).get("type") in ("DATE", "DATE_TIME"):
            return dt.datetime(1899, 12, 30) + dt.timedelta(days=n)
        return int(n) if float(n).is_integer() else n
    if "stringValue" in ev:
        return ev["stringValue"]
    if "boolValue" in ev:
        return ev["boolValue"]
    return None


def fetch(sheets, spreadsheet_id: str, tabs: set[str]) -> tuple[dict, dict]:
    """-> (values, formulas): tab -> Sheet. `formulas` shows '=...' text where a cell holds a formula."""
    meta = sheets.spreadsheets().get(spreadsheetId=spreadsheet_id, includeGridData=True, fields=FIELDS).execute(num_retries=3)
    vals, forms = {}, {}
    for sh in meta["sheets"]:
        title = sh["properties"]["title"]
        if title not in tabs:
            continue
        cv, cf, mr, mc = {}, {}, 0, 0
        for grid in sh.get("data", []):
            r0, c0 = grid.get("startRow", 0), grid.get("startColumn", 0)
            for i, rd in enumerate(grid.get("rowData", [])):
                for j, v in enumerate(rd.get("values", [])):
                    t = _typed(v)
                    link = v.get("hyperlink")
                    f = v.get("userEnteredValue", {}).get("formulaValue")
                    if t is None and not link and not f:
                        continue
                    r, c = r0 + i + 1, c0 + j + 1
                    cv[(r, c)] = _Cell(t, link)
                    cf[(r, c)] = _Cell(f if f else t, link)
                    mr, mc = max(mr, r), max(mc, c)
        vals[title], forms[title] = Sheet(cv, mr, mc), Sheet(cf, mr, mc)
    return vals, forms


class Book(dict):
    """workbook[tab] -> Sheet"""
