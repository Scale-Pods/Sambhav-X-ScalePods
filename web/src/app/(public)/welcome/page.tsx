import Link from "next/link";
import type { Metadata } from "next";
import { PublicPage, H2, P, CONTACT } from "@/components/PublicPage";

export const metadata: Metadata = {
  title: "Sambhav Stock · Stock and operations for Sambhav Pipes & Fittings",
  description: "Sambhav Stock is the private stock and operations system of Sambhav Pipes & Fittings and Sai Steel & Engineering: plates, stock counts, certificates, documents, orders and payments.",
  robots: { index: true, follow: true },
};

const FEATURES: [string, string][] = [
  ["Every plate, accounted for", "A checked stock book of every steel plate: what came in, what went out, and what is left, by grade, thickness and size. The balance is always calculated from the records, never typed."],
  ["Documents read for you", "Delivery challans, mill certificates and invoices are read from a photo or PDF, checked by a person, and only then used."],
  ["Stock from the mill's dispatch mail", "When the mill emails its dispatch details, the app reads the table in that mail and suggests the plates to add to stock. A person approves it before anything changes."],
  ["Mail inside the app", "The company's mailbox shown next to its orders and leads. The AI can summarise a mail, and draft a reply for a person to read, change and send. Nothing is sent without a person pressing Send."],
  ["Orders, invoices and payments", "Who owes us, whom we owe, and which orders are open, read from the company's payment sheets."],
  ["Ask in plain words", "A built-in assistant answers questions such as “Do we have 12 mm SA 516 Gr 70, 1500 × 6000?” from the company's own records and shows where each answer came from."],
];

export default function Welcome() {
  return (
    <PublicPage>
      <section>
        <div className="mb-4 h-1.5 w-14 rounded-full bg-accent" />
        <h1 className="font-display text-[2.4rem] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[3rem]">Sambhav Stock</h1>
        <p className="mt-4 max-w-2xl text-[1.1rem] leading-relaxed text-muted">The stock and operations system of Sambhav Pipes &amp; Fittings and Sai Steel &amp; Engineering, authorised dealers and stockists of steel plates. It keeps stock, documents, orders and payments in one place, for the company&apos;s own staff.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/login" className="rounded-lg bg-brand px-5 py-2.5 font-medium text-white hover:bg-brand-dark">Sign in</Link>
          <Link href="/privacy" className="rounded-lg border border-line bg-card px-5 py-2.5 font-medium hover:bg-surface">Privacy policy</Link>
        </div>
        <p className="mt-3 text-[0.88rem] text-muted">Access is by invitation: staff sign in with the email and password given to them by the office.</p>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-2">
        {FEATURES.map(([t, d]) => (
          <div key={t} className="rounded-lg border border-line bg-card p-5">
            <h2 className="font-display text-[1.05rem] font-bold">{t}</h2>
            <p className="mt-1.5 text-[0.93rem] leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </section>

      <section id="google">
        <H2>How the app uses Google (Gmail)</H2>
        <P>An administrator of the company can connect a company Gmail mailbox. The app uses it to read the mill&apos;s “Dispatch details” emails and suggest plates for staff to approve, to show the mailbox&apos;s mail inside the app, to summarise a mail when a person asks, and to help a person write a reply: the AI drafts, the person reads and changes it, and the mail is saved as a draft or sent only when the person presses the button. The app never sends mail on its own, and Google data is never sold, used for advertising or used to train AI models. Each new permission (reading, drafting, sending) is asked for on Google&apos;s own consent screen, and access can be removed at any time from the app or from the Google account&apos;s permissions page.</P>
        <P>Sambhav Stock&apos;s use and transfer of information received from Google APIs adheres to the <a className="font-medium text-brand hover:underline" href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. Details are in the <Link className="font-medium text-brand hover:underline" href="/privacy">privacy policy</Link>.</P>
      </section>

      <section>
        <H2>Contact</H2>
        <P>Questions about the app, your data or access: <a className="font-medium text-brand hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>. Read the <Link className="font-medium text-brand hover:underline" href="/terms">terms of service</Link> and the <Link className="font-medium text-brand hover:underline" href="/privacy">privacy policy</Link>.</P>
      </section>
    </PublicPage>
  );
}
