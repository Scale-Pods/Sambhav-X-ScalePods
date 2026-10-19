import type { PlateQuery, PlateSort } from "./analytics";
import { parseFilter } from "./filters";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The Plates page's filters, sort and paging, read from the address. Shared by the page and the CSV export. */
export function readPlateQuery(sp: Record<string, string | string[] | undefined>): PlateQuery {
  const status = one(sp.status);
  const cert = one(sp.cert);
  return {
    f: parseFilter(sp, "all"),
    search: one(sp.q)?.trim() || undefined,
    dateOn: one(sp.on) === "sold" ? "sold" : "received",
    status: status === "soldout" || status === "oversold" || status === "all" ? status : "instock",
    cert: cert === "has" || cert === "none" ? cert : undefined,
    sort: (one(sp.sort) as PlateSort) || "received_desc",
    page: Number(one(sp.page) ?? 1) || 1,
    size: Number(one(sp.size) ?? 25) || 25,
  };
}

