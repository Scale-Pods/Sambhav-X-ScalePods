import Link from "next/link";
import type { Metadata } from "next";
import { PublicPage, H2, P, UL, CONTACT, UPDATED } from "@/components/PublicPage";

export const metadata: Metadata = {
  title: "Terms of service · Sambhav Stock",
  description: "The terms for using Sambhav Stock, the private stock and operations system of Sambhav Pipes & Fittings.",
  robots: { index: true, follow: true },
};

const A = "font-medium text-brand hover:underline";

export default function Terms() {
  return (
    <PublicPage>
      <h1 className="font-display text-[2.2rem] font-extrabold tracking-[-0.03em]">Terms of service</h1>
      <p className="mt-2 text-[0.9rem] text-muted">Last updated {UPDATED}</p>

      <P>These terms apply to Sambhav Stock (&ldquo;the app&rdquo;), the stock and operations system of Sambhav Pipes &amp; Fittings and Sai Steel &amp; Engineering, built and run for them by ScalePods. By signing in or connecting a mailbox you agree to them.</P>

      <H2>1. Who may use the app</H2>
      <P>The app is for the companies&apos; own staff and people they invite. There is no public sign-up: access is given by the office with an email address and a role (for example reviewer, approver, administrator or owner). The role decides what a person may see and do.</P>

      <H2>2. Your account</H2>
      <UL>
        <li>Keep your password private and do not share your login. You are responsible for what is done with your account.</li>
        <li>Tell the office at once if you think someone else has used your login.</li>
        <li>The office may change or remove access at any time, for example when someone leaves.</li>
      </UL>

      <H2>3. Using the app properly</H2>
      <UL>
        <li>Use it only for the companies&apos; business.</li>
        <li>Do not try to reach data you have not been given access to, interfere with the app, or upload anything unlawful or harmful.</li>
        <li>Anything that changes stock (adding plates from a mail, posting a delivery challan, counts) is checked and approved by a person with the right role. Approving is a real business decision: check before you approve.</li>
      </UL>

      <H2>4. Connecting a Google (Gmail) mailbox</H2>
      <P>Only an administrator may connect a mailbox, and only one they are entitled to connect. By connecting it, the administrator confirms that the mailbox may be read, and shown inside the app to the staff the company allows, for the purposes in the <Link className={A} href="/privacy">privacy policy</Link>. The permissions given (reading, and later drafting and sending) are the ones shown on Google&apos;s consent screen. You can disconnect the mailbox at any time from the app or from your Google account&apos;s permissions page. Your use of Google&apos;s services remains subject to Google&apos;s own terms.</P>

      <H2>5. Writing and sending mail from the app</H2>
      <UL>
        <li>When the app lets you write, draft or send mail, it does so from the mailbox you connected, in your name or the company&apos;s. You are responsible for every mail you send.</li>
        <li>The app sends a mail only when a person presses Send. It does not send mail by itself.</li>
        <li>Do not use it to send spam, bulk or marketing mail, anything misleading, unlawful or abusive, or anything that breaks Google&apos;s rules for Gmail.</li>
      </UL>

      <H2>6. Accuracy and the AI assistant</H2>
      <P>Figures in the app come from the companies&apos; records, sheets and documents, and from readings of uploaded files. A reading of a document can be wrong. The built-in assistant, and the AI that summarises mail and drafts replies, can be incomplete or mistaken, can misread a mail, and can write something that sounds right but is not. Read every AI summary and every AI draft before you rely on it, correct it, and check prices, quantities, dates, names and commitments before you send or act on them. The person who sends or approves is responsible for the result, not the AI.</P>

      <H2>7. Availability</H2>
      <P>We aim to keep the app running but do not promise it will always be available or error-free. We may change or stop features, with notice to the office where we can.</P>

      <H2>8. Ownership</H2>
      <P>The companies own their business data and their mail. ScalePods owns the app&apos;s software, design and the tools it was built with. These terms give you the right to use the app for the companies&apos; business, nothing more.</P>

      <H2>9. Liability</H2>
      <P>The app is provided as it is. To the extent the law allows, ScalePods is not liable for losses that come from using, or not being able to use, the app, including losses from decisions made on its figures or from mail sent from it. Nothing in these terms limits liability that cannot be limited by law.</P>

      <H2>10. Ending use</H2>
      <P>You may stop using the app at any time. We may suspend or end access if these terms are broken or the app is no longer needed. Sections that by their nature should continue (such as ownership and liability) continue afterwards.</P>

      <H2>11. Changes and law</H2>
      <P>We may update these terms; the new version is shown on this page with its date, and continued use means you accept it. These terms are governed by the laws of India.</P>

      <H2>12. Contact</H2>
      <P><a className={A} href={`mailto:${CONTACT}`}>{CONTACT}</a>. See also the <Link className={A} href="/privacy">privacy policy</Link>.</P>
    </PublicPage>
  );
}
