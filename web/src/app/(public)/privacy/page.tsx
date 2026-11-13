import Link from "next/link";
import type { Metadata } from "next";
import { PublicPage, H2, P, UL, CONTACT, UPDATED } from "@/components/PublicPage";

export const metadata: Metadata = {
  title: "Privacy policy · Sambhav Stock",
  description: "What Sambhav Stock collects, how Google (Gmail) data is read, summarised, drafted and sent, who can see it, and how to have it removed.",
  robots: { index: true, follow: true },
};

const A = "font-medium text-brand hover:underline";
const code = "rounded bg-card px-1.5 py-0.5 text-[0.85rem]";

export default function Privacy() {
  return (
    <PublicPage>
      <h1 className="font-display text-[2.2rem] font-extrabold tracking-[-0.03em]">Privacy policy</h1>
      <p className="mt-2 text-[0.9rem] text-muted">Last updated {UPDATED}</p>

      <P>Sambhav Stock (&ldquo;the app&rdquo;, &ldquo;we&rdquo;) is the private stock and operations system of Sambhav Pipes &amp; Fittings and Sai Steel &amp; Engineering, built and run for them by ScalePods. It is used only by the companies&apos; own staff. This page explains what information the app handles and, in particular, how it uses data from Google accounts: reading mail, summarising it, drafting replies with AI, and sending mail.</P>

      <H2>1. Information the app handles</H2>
      <UL>
        <li><strong>Staff accounts:</strong> name, work email address and role, used to sign in and to decide what each person may see or approve.</li>
        <li><strong>Business records:</strong> steel stock and plate records, stock counts, orders, dispatches, invoices and payments, loaded from the companies&apos; own spreadsheets and entered by staff.</li>
        <li><strong>Documents:</strong> delivery challans, mill certificates and invoices that staff upload as photos or PDFs, and the text read from them.</li>
        <li><strong>Google account data</strong>, only if an administrator connects a mailbox: see section 2.</li>
        <li><strong>Usage records:</strong> the questions asked in the built-in assistant, with their answers and cost, kept so the owner can review them.</li>
      </UL>

      <H2>2. Google user data (Gmail)</H2>
      <P><strong>Connecting.</strong> Only an administrator of the company can connect a mailbox, and only a mailbox they are entitled to connect (for example a company address). Google shows exactly what is being asked for, and nothing is read until the administrator agrees.</P>

      <P><strong>What we ask for.</strong> The app asks Google for the smallest permission each feature needs, and asks again, with a new Google consent screen, when a new feature needs more. Until you agree to the new permission, the app keeps only the permissions you already gave.</P>
      <UL>
        <li><code className={code}>gmail.readonly</code>: read mail. Used to find the mill&apos;s dispatch emails, to show the mailbox&apos;s mail inside the app, and to let staff summarise a mail.</li>
        <li><code className={code}>gmail.compose</code>: create and edit drafts. Used so a reply or new mail written in the app (by a person, or drafted by the AI and corrected by a person) can be saved as a draft in the mailbox.</li>
        <li><code className={code}>gmail.send</code>: send mail. Used only when a person presses Send on a mail written in the app.</li>
      </UL>
      <P>Features that use the second and third permission are being added to the app. They are not switched on, and the permissions are not requested, until the feature is released.</P>

      <P><strong>What the app does with mail.</strong></P>
      <UL>
        <li><strong>Dispatch mails to stock suggestions.</strong> The app looks for the steel mill&apos;s &ldquo;Dispatch details&rdquo; emails, reads the plate table in each, and shows it to staff as a suggestion. A person with approval rights decides whether the plates are added to the stock book. Nothing changes stock by itself.</li>
        <li><strong>Mail view.</strong> Mail of the connected mailbox is shown inside the app, with search and labels, to the staff the company has allowed to see it. The app stores a copy of each mail it shows (sender, recipients, subject, date, text and attachment names) so it can be searched and linked to orders and leads.</li>
        <li><strong>Summaries.</strong> When a person asks for a summary of a mail or a thread, the text of that mail (and of the thread, if asked) is sent to an AI service, and the summary is shown to that person and kept with the mail.</li>
        <li><strong>Drafts.</strong> When a person asks the AI to draft a mail or a reply, it is given the mail being answered, the instruction the person typed, and, if the person asks for it, relevant records of the company such as stock or order details. The result is shown as a draft for the person to read, change and approve. It is sent or saved only when the person presses the button.</li>
        <li><strong>Sending.</strong> The app sends mail only from the mailbox of the person who presses Send, and only the mail they wrote or approved. It never sends mail on its own, never sends in bulk, and is not used for marketing or advertising.</li>
      </UL>

      <P><strong>AI and Google user data.</strong> Mail content goes to an AI service only when a person asks for a summary or a draft, and only the mail or thread needed for that request is sent. We use the business API services of Anthropic and OpenAI (and may add Google&apos;s Gemini API), under terms that state API inputs are not used to train their models. We do not use Google user data to train artificial-intelligence or machine-learning models, whether our own or anyone else&apos;s, and we do not let anyone else do so with it. The AI&apos;s work is limited to producing the summary or draft the person asked for.</P>

      <P><strong>Who can see it.</strong> Mail is visible only to signed-in staff whom the company has allowed to see the mailbox, according to their role. A ScalePods engineer does not read mailbox content, except when a company administrator asks for help with a specific mail and agrees to it, when it is needed to keep the app secure or working, or when the law requires it.</P>

      <P><strong>What we never do.</strong> We do not sell Google user data, share it with third parties other than the AI and hosting providers named in this policy for the purposes above, use it for advertising, or use it for any purpose other than the features described here.</P>

      <P><strong>Limited Use.</strong> Sambhav Stock&apos;s use and transfer to any other app of information received from Google APIs will adhere to the <a className={A} href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</P>

      <P><strong>How it is stored and protected.</strong> The Google sign-in token is stored encrypted (AES-256-GCM) and is used only on our server, never in the browser. Mail copies, summaries and drafts are stored in the app&apos;s database, with access limited by role at the database itself. All connections use HTTPS.</P>

      <P><strong>Keeping, removing and revoking.</strong> An administrator can disconnect the mailbox at any time from the Mail page; the stored token is then deleted at once and the app can no longer read or send from the mailbox. You can also remove the app&apos;s access yourself at <a className={A} href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>. Mail copies the app already stored stay until deleted: write to <a className={A} href={`mailto:${CONTACT}`}>{CONTACT}</a> and we will delete the mail copies, summaries and drafts of a mailbox within 30 days. Dispatch mails that were used to add plates to stock are kept as evidence of that receipt unless you ask for them to be removed from the stock record too.</P>

      <H2>3. The built-in assistant (AI)</H2>
      <P>The assistant (Digital Brain and Stock check) answers questions by looking up the companies&apos; records. To write the answer, the question, the records it looked up (for example stock, orders or payments) and any file the person attached are sent to AI services from Anthropic and OpenAI under their business API terms, which state that API inputs are not used to train their models. Mail content is part of this only when the person asks about mail, under the rules in section 2.</P>

      <H2>4. Where the data is kept and who processes it</H2>
      <P>The app runs on Vercel (hosting) and keeps its data in Supabase (database and file storage). AI requests go to Anthropic and OpenAI (and, if added, Google). They process data for us as infrastructure and service providers. We do not give the data to anyone else, except where the law requires it.</P>

      <H2>5. Cookies</H2>
      <P>The app uses only the cookies it needs: a sign-in session cookie and a remembered light or dark display choice. There is no advertising and no third-party tracking.</P>

      <H2>6. Your choices</H2>
      <P>Staff may ask to see, correct or delete their account details, and the owner may ask for any business record to be corrected or deleted, by writing to <a className={A} href={`mailto:${CONTACT}`}>{CONTACT}</a>. Stock records that other records depend on may be kept, with personal details removed, so that the books stay correct.</P>

      <H2>7. Children</H2>
      <P>The app is a business tool for adult staff and is not meant for children.</P>

      <H2>8. Changes to this policy</H2>
      <P>If this policy changes, the new version is shown on this page with a new date. Any change to how Google data is used is shown here before it takes effect, and where a new Google permission is needed, Google asks the administrator to agree again.</P>

      <H2>9. Contact</H2>
      <P>Sambhav Pipes &amp; Fittings, through ScalePods: <a className={A} href={`mailto:${CONTACT}`}>{CONTACT}</a>. See also the <Link className={A} href="/terms">terms of service</Link>.</P>
    </PublicPage>
  );
}
