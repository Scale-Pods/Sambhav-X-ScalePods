import "server-only";
import { Pool } from "pg";

// Local demo only: reads straight from the database on the server, read-only.
// Before this is deployed, reads go through Supabase login + row-level security instead.
const g = globalThis as unknown as { __pool?: Pool };

export const pool =
  g.__pool ??
  (g.__pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    options: "-c default_transaction_read_only=on",
  }));

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}
