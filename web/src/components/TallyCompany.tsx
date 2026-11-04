"use client";

import { useSearchParams } from "next/navigation";
import { ParamSelect } from "./FilterBar";

const COMPANIES = [{ value: "SPF", label: "Sambhav Pipes & Fittings (SPF)" }, { value: "SAI", label: "Sai Steel & Engineering (Sai)" }];

/** Which of the two Tally companies the Tally pages show. The choice lives in the address (entity) and follows you from tab to tab; Sambhav is the default. */
export function TallyCompany() {
  const sp = useSearchParams();
  return (
    <div className="mb-4">
      <ParamSelect name="entity" label="Company" value={sp.get("entity") === "SAI" ? "SAI" : "SPF"} options={COMPANIES} />
    </div>
  );
}
