import { LogOut } from "lucide-react";
import { currentStaff } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

const ROLE: Record<string, string> = { owner: "Owner", admin: "Administrator", approver: "Approver", accounts: "Accounts", sales: "Sales", office: "Office", viewer: "View only", partner_rs: "Partner" };

export async function UserChip() {
  let me = null;
  try {
    me = await currentStaff();
  } catch {
    /* signed out: the gate handles it */
  }
  if (!me) return null;
  const initials = me.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right leading-tight md:block">
        <p className="text-[0.9rem] font-semibold">{me.full_name}</p>
        <p className="text-[0.75rem] text-muted">{ROLE[me.role] ?? me.role}</p>
      </div>
      <span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-sm font-semibold text-white">{initials}</span>
      <form action={signOut}>
        <button title="Sign out" aria-label="Sign out" className="rounded-lg p-2 text-muted hover:bg-surface hover:text-ink"><LogOut className="h-[1.1rem] w-[1.1rem]" /></button>
      </form>
    </div>
  );
}
