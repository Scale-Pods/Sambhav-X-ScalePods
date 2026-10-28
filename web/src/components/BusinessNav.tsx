import { BookOpenCheck, FileText, Mail, Package, ReceiptIndianRupee } from "lucide-react";
import { canExport, currentStaff } from "@/lib/auth";
import { NavLink } from "./NavLink";

const icon = "h-[1.15rem] w-[1.15rem] shrink-0";
const group = "px-3 pb-1.5 font-display text-[0.68rem] font-bold uppercase tracking-[0.14em] text-steel-muted group-data-[rail=true]/side:hidden";

/** The Business section of the sidebar. Orders, mail, leads and payments hold prices, customers and phone numbers, so only people who may open them see them. */
export async function BusinessNav() {
  let role: string | undefined;
  try {
    role = (await currentStaff())?.role;
  } catch {
    role = undefined;
  }
  if (!canExport(role)) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className={group}>Business</p>
      <NavLink href="/orders"><Package className={icon} />Orders &amp; dispatch</NavLink>
      <NavLink href="/quotations" soon><FileText className={icon} />Quotations</NavLink>
      <NavLink href="/mail"><Mail className={icon} />Mail &amp; leads</NavLink>
      <NavLink href="/payments"><ReceiptIndianRupee className={icon} />Invoices &amp; payments</NavLink>
      <NavLink href="/tally"><BookOpenCheck className={icon} />Tally</NavLink>
    </div>
  );
}
