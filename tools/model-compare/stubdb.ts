// A stand-in for web/src/lib/db.ts and auth.ts so the question engine can run from the command line: every query runs as one signed-in person (TEST_UID) inside a
// transaction that is rolled back, exactly like the site does, and nothing is ever written.
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
async function run(sql: string, params: unknown[] | undefined) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: process.env.TEST_UID, role: "authenticated" })]);
    const r = await c.query(sql, params as never);
    await c.query("rollback");
    return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
export const q = <T>(sql: string, params?: unknown[]) => run(sql, params) as Promise<T[]>;
export const call = q;
export async function qTx<T>(fn: (q: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin read only");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: process.env.TEST_UID, role: "authenticated" })]);
    return await fn(async (sql, params) => (await c.query(sql, params as never)).rows as never);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}
export const canExport = (r?: string) => r === "owner" || r === "admin";
export const canUploadDocs = (r?: string) => ["owner", "admin", "approver", "accounts", "sales", "office"].includes(r ?? "");
