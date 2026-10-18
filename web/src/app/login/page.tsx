import Image from "next/image";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-surface px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mx-auto mb-8 w-fit rounded-2xl bg-white px-6 py-4 shadow-[0_1px_2px_rgba(18,41,58,0.05)]">
          <Image src="/logo.jpg" alt="Sambhav Pipes & Fittings" width={361} height={86} priority className="h-auto w-64" />
        </div>
        <div className="rounded-2xl border border-line bg-card p-8 shadow-[0_8px_30px_rgba(18,41,58,0.07)]">
          <h1 className="text-[1.5rem] font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-[0.95rem] text-muted">Use the email and password given to you by your office.</p>
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-[0.85rem] text-muted">Having trouble? Ask the person who set up your access.</p>
      </div>
    </main>
  );
}
