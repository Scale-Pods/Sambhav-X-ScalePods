"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { signIn, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  const [show, setShow] = useState(false);
  const field = "mt-1.5 w-full rounded-xl border border-line bg-white px-4 py-3 text-[1rem] focus:border-brand";
  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-muted">Email</span>
        <input name="email" type="email" autoComplete="username" required className={field} />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-muted">Password</span>
        <div className="relative">
          <input name="password" type={show ? "text" : "password"} autoComplete="current-password" required className={field + " pr-12"} />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            title={show ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 mt-[0.1rem] -translate-y-1/2 rounded-lg p-2 text-muted hover:bg-surface hover:text-ink"
          >
            {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
      </label>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[0.9rem] text-bad">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-xl bg-brand py-3.5 text-[1rem] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
