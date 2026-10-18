import { Soon } from "@/components/Soon";

export default function Page() {
  return (
    <Soon
      title="Mail & leads"
      hint="All ten mailboxes and IndiaMART leads in one tracker."
      when="December to January"
      items={["Enquiries, quotations and replies across every mailbox, one row per negotiation", "IndiaMART leads with an owner, a status and a follow-up date", "Follow-up reminders: no reply in 2 days, dead lead after 30 days", "Win and loss captured in two clicks"]}
    />
  );
}
