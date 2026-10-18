import { Soon } from "@/components/Soon";

export default function Page() {
  return (
    <Soon
      title="Payments"
      hint="Invoices, dues and reminders, checked against Tally."
      when="January onwards"
      items={["Sales and purchase invoice register with correct financial-year numbers", "Dues by salesperson and customer, with reminders", "Read-only match with Tally; nothing is ever written to Tally", "GST return check against your invoices"]}
    />
  );
}
