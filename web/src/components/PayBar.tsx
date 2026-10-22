"use client";

import type { ReactNode } from "react";
import { ParamSearch, ParamSelect } from "./FilterBar";

const ENTITIES = [{ value: "all", label: "SPF and Sai" }, { value: "SPF", label: "SPF only" }, { value: "SAI", label: "Sai only" }];

/** Entity choice and search for the money pages that have no period (debtors, creditors). `children` adds page-specific choices. */
export function PayBar({ entity, q, placeholder, children }: { entity: string; q: string; placeholder: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <ParamSelect name="entity" label="Company" value={entity} options={ENTITIES} />
      {children}
      <ParamSearch placeholder={placeholder} value={q} />
    </div>
  );
}

/** The same two controls, to sit inside the period filter bar of the pages that have a period. */
export function PayExtras({ entity, q = "", placeholder }: { entity: string; q?: string; placeholder?: string }) {
  return (
    <>
      <ParamSelect name="entity" label="Company" value={entity} options={ENTITIES} />
      {placeholder && <ParamSearch placeholder={placeholder} value={q} />}
    </>
  );
}
