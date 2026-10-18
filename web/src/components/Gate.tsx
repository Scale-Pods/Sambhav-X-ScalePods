import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ShieldX } from "lucide-react";
import { currentStaff } from "@/lib/auth";
import { NotSignedIn } from "@/lib/db";
import { signOut } from "@/app/login/actions";

/** Nothing renders unless the signed-in account belongs to a staff member. */
export async function Gate({ children }: { children: ReactNode }) {
  let me;
  try {
    me = await currentStaff();
  } catch (e) {
    if (e instanceof NotSignedIn) redirect("/login");
    throw e;
  }
  if (!me) {
    return (
      <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-line bg-card p-8 text-center shadow-[0_1px_2px_rgba(18,41,58,0.04)]">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-warn"><ShieldX className="h-6 w-6" /></span>
        <h1 className="mt-4 text-xl font-semibold">Your account is not set up yet</h1>
        <p className="mt-2 text-[0.95rem] text-muted">You are signed in, but your email has not been added as a staff member, so no stock data is shown. Ask the person who manages access to add your email.</p>
        <form action={signOut} className="mt-6"><button className="rounded-lg border border-line px-4 py-2 font-medium hover:bg-surface">Sign out</button></form>
      </div>
    );
  }
  return <>{children}</>;
}
