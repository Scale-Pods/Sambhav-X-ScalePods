import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-surface lg:grid-cols-[1.05fr_1fr]">
      {/* brushed-steel panel */}
      <section className="steel-panel relative hidden flex-col justify-between p-12 text-white lg:flex">
        <div className="w-fit rounded-lg bg-white px-4 py-3">
          <Image src="/logo.jpg" alt="Sambhav Pipes & Fittings" width={361} height={86} priority className="h-auto w-56" />
        </div>
        <div className="max-w-md">
          <div className="mb-5 h-1.5 w-14 rounded-full bg-accent" />
          <h2 className="font-display text-[3.1rem] font-extrabold leading-[1.02] tracking-[-0.03em]">Every plate,<br />accounted for.</h2>
          <p className="mt-5 text-[1.05rem] leading-relaxed text-white/80">Stock, counts and certificates for Sambhav Pipes &amp; Fittings, in one place.</p>
        </div>
        <p className="text-sm text-white/55">Authorised Dealer &amp; Stockist of Plates</p>
      </section>

      {/* form */}
      <section className="relative grid place-items-center px-5 py-12">
        <ThemeToggle className="absolute right-5 top-5" />
        <div className="w-full max-w-sm">
          <div className="mb-8 w-fit rounded-lg bg-white px-4 py-3 lg:hidden">
            <Image src="/logo.jpg" alt="Sambhav Pipes & Fittings" width={361} height={86} className="h-auto w-52" />
          </div>
          <div className="mb-3 h-1 w-10 rounded-full bg-accent" />
          <h1 className="font-display text-[2rem] font-extrabold tracking-[-0.02em]">Sign in</h1>
          <p className="mt-1.5 text-[0.97rem] text-muted">Use the email and password given to you by your office.</p>
          <LoginForm />
          <p className="mt-8 text-[0.85rem] text-muted">Having trouble? Ask the person who set up your access.</p>
        </div>
      </section>
    </main>
  );
}
