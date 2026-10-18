import { Soon } from "@/components/Soon";

export default function Page() {
  return (
    <Soon
      title="Quotations"
      hint="One button on an enquiry builds the quotation and sends it back into the same email thread."
      when="December to January"
      items={["Quote number reserved when the enquiry arrives (1xxx for SPF, 2xxx for Sai); revisions keep it: 1217, 1217R, 1217R1", "Line items read from the customer's enquiry table", "PDF and editable sheet from the same data, so they never disagree", "What we last quoted for this item, and whether we won", "Gross profit shown before you send, from the real purchase rate of the plate"]}
    />
  );
}
