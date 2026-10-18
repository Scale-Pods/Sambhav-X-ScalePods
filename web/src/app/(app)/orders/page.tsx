import { Soon } from "@/components/Soon";

export default function Page() {
  return (
    <Soon
      title="Orders & dispatch"
      hint="Replaces the order dispatch form and the Dispatch FMS sheet."
      when="December"
      items={["One order form with automatic, never-repeated order numbers", "Pick the exact plates for an order; the PO and certificates attach themselves", "Vehicle, weighbridge and outward slip in one place", "Weight check: more than 5% off needs a named approver and a reason"]}
    />
  );
}
