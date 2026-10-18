"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  const field = "mt-1.5 w-full rounded-xl border border-line bg-white px-4 py-3 text-[1rem] focus:border-brand";
  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-muted">Email</span>
        <input name="email" type="email" autoComplete="username" required className={field} />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-muted">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className={field} />
      </label>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[0.9rem] text-bad">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-xl bg-brand py-3.5 text-[1rem] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
