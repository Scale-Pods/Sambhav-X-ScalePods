import "server-only";
import { cache } from "react";
import { currentUserId, q } from "./db";

export type Me = { id: string; full_name: string; role: string; email: string | null };

/** The staff member behind the signed-in account, or null when the account is not linked to a staff row (no access). */
export const currentStaff = cache(async (): Promise<Me | null> => {
  if (!(await currentUserId())) return null;
  const rows = await q<Me>(`select s.id, s.full_name, s.role::text, s.email from public.staff s where s.id = app.my_staff_id()`);
  return rows[0] ?? null;
});

export const canDecide = (role?: string) => role === "owner" || role === "admin" || role === "approver";
export const canCount = (role?: string) => role === "owner" || role === "admin" || role === "approver" || role === "office";
export const canRunCount = (role?: string) => role === "owner" || role === "admin";
export const canExport = (role?: string) => role === "owner" || role === "admin";
