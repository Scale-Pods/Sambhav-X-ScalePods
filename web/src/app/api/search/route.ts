import { NextResponse, type NextRequest } from "next/server";
import { canSeeBusiness, currentStaff } from "@/lib/auth";
import { q } from "@/lib/db";

export type Hit = { kind: "plate" | "invoice" | "order"; label: string; sub: string; href: string };

/** Exact matches for the top search bar, shown as you type: plates by heat / plate / certificate / lot number, and (owner and administrators) Tally invoices and orders. Reads only; free. */
export async function GET(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const text = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (text.length < 3) return NextResponse.json([]);
  const like = `%${text.replace(/[\%_]/g, (c) => "\\" + c)}%`;
  const admin = canSeeBusiness(me.role);
  const [plates, invoices, orders] = await Promise.all([
    q<{ lot_no: number; key: string | null; grade: string | null; thk: number; kg: number; status: string }>(
      `select l.lot_no::int lot_no, coalesce(l.plate_no, l.heat_no) "key", g.code grade, l.thickness_mm::float8 thk, l.balance_kg::float8 kg, l.current_status status
         from public.v_lots_current l left join public.grades g on g.id = l.grade_id
        where l.heat_no ilike $1 or l.plate_no ilike $1 or l.tc_no ilike $1 or l.lot_no::text = $2 order by l.receipt_date desc nulls last limit 5`, [like, text]),
    admin ? q<{ id: string; voucher_no: string; party: string | null; amount: number }>(
      `select id, voucher_no, party_ledger party, amount::float8 amount from public.tally_vouchers
        where voucher_type = 'Sales' and deleted_at is null and voucher_no ilike $1 order by voucher_date desc limit 4`, [like]) : Promise.resolve([]),
    admin ? q<{ order_no: string; client: string | null; po_no: string | null }>(
      `select order_no, client, po_no from public.v_orders where order_no = $2 or po_no ilike $1 order by order_date desc nulls last limit 3`, [like, text]) : Promise.resolve([]),
  ]);
  const hits: Hit[] = [
    ...plates.map((p) => ({ kind: "plate" as const, label: `Plate ${p.lot_no} · ${p.key ?? ""}`.trim(), sub: `${p.grade ?? ""} · ${p.thk} mm · ${Math.round(p.kg).toLocaleString("en-IN")} kg left`, href: `/stock/${p.lot_no}` })),
    ...invoices.map((v) => ({ kind: "invoice" as const, label: `Tally invoice ${v.voucher_no}`, sub: `${(v.party ?? "").replace(/\s*\((Sale|Pur|Rent)\)\s*$/i, "")} · ₹${Math.round(v.amount).toLocaleString("en-IN")}`, href: `/tally/invoices/${v.id}` })),
    ...orders.map((o) => ({ kind: "order" as const, label: `Order ${o.order_no}`, sub: `${o.client ?? ""}${o.po_no ? ` · PO ${o.po_no}` : ""}`, href: `/orders/${encodeURIComponent(o.order_no)}` })),
  ];
  return NextResponse.json(hits, { headers: { "Cache-Control": "private, max-age=30" } });
}
