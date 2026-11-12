import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { connection } from "next/server";
import { Pool, type PoolClient } from "pg";
import { supabaseServer } from "./supabase";

// Every query runs as the signed-in person: inside a transaction we switch to the "authenticated" database role
// and hand it that person's id, so the row-level security rules in the database decide what they may see.
// The connection itself is never used without a signed-in user.
const g = globalThis as unknown as { __pool?: Pool };

// Supabase's session pooler (port 5432) allows only 15 clients in all, which a few serverless instances use up ("EMAXCONNSESSION", the
// whole site failing). Every query here is one self-contained transaction, so in production the transaction pooler (port 6543) is used:
// it serves many more clients and a role switched with "set local" ends with the transaction.
const connectionString = process.env.NODE_ENV === "production" ? (process.env.DATABASE_URL ?? "").replace(/(pooler\.supabase\.com):5432\//, "$1:6543/") : process.env.DATABASE_URL;

const pool =
  g.__pool ??
  (g.__pool = new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 6),
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    // never wait for ever: a connection that cannot be had in 8 s, or a query that runs over 25 s, fails with an error the page can show.
    // Idle connections are dropped after 10 s so a connection that went stale while the server slept is never reused.
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 25_000,
    keepAlive: true,
  }));
g.__pool.on("error", (e) => console.warn(`[db-pool] idle connection error: ${e.message}`));

/** Can the database be reached at all? For the uptime check (/api/health): no sign-in needed, nothing is read. */
export async function ping(): Promise<boolean> {
  try {
    await Promise.race([pool.query("select 1"), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000))]);
    return true;
  } catch {
    return false;
  }
}

export type Tx = Pick<PoolClient, "query">;

// A streamed answer keeps working after the request handler has returned, when the session cookie can no longer be read. The handler reads the verified
// person once, up front, and runs the rest as that person with runAs.
const asUser = new AsyncLocalStorage<string>();
export const runAs = <T,>(userId: string, fn: () => Promise<T>) => asUser.run(userId, fn);

/** The signed-in person's id from the verified session cookie, or null. */
export const currentUserId = cache(async (): Promise<string | null> => {
  const forced = asUser.getStore();
  if (forced) return forced;
  await connection(); // everything here is per person: render at request time, never in the prerendered shell
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TRANSIENT = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"]);

/** A connection from the pool. A brief network failure (a failed name lookup, a reset) is retried twice before it is shown as an error. */
async function connect(): Promise<PoolClient> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await pool.connect();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (attempt >= 3 || !code || !TRANSIENT.has(code)) throw e;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
}

async function inTx<T>(userId: string, readOnly: boolean, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new NotSignedIn(); // the id comes from a verified session; this keeps the inlined claim string safe
  const client = await connect();
  try {
    // open the transaction, say who is asking, and switch role: one round trip instead of three
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await client.query(`${readOnly ? "begin read only" : "begin"}; select set_config('request.jwt.claims', '${claims}', true); set local role authenticated`);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export class NotSignedIn extends Error {
  constructor() {
    super("Not signed in");
  }
}

/** Slow database work is written to the server log (Vercel runtime logs) with how long it took, so a slow page can be traced to the query. */
async function timed<T>(what: string, run: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await run();
  } finally {
    const ms = Date.now() - t0;
    if (ms >= 400) console.warn(`[slow-db] ${ms} ms ${what.replace(/\s+/g, " ").slice(0, 110)}`);
  }
}

/** Read as the signed-in person. */
export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const id = await currentUserId();
  if (!id) throw new NotSignedIn();
  return timed(sql, () => inTx(id, true, async (tx) => (await tx.query(sql, params)).rows as T[]));
}

/** Several reads as the signed-in person in one transaction on one connection. An overview page asks 10-14 questions; sent together they
 *  no longer queue for the pool one by one (the connection runs them in turn, without a round of set-up for each). */
export async function qTx<T>(fn: (q: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  const id = await currentUserId();
  if (!id) throw new NotSignedIn();
  return inTx(id, true, (tx) => {
    // one connection runs one query at a time: queue them, so nothing is sent while another is still running
    let chain: Promise<unknown> = Promise.resolve();
    return fn(<R,>(sql: string, params: unknown[] = []) => {
      const run = chain.then(() => tx.query(sql, params));
      chain = run.catch(() => undefined);
      return run.then((r) => r.rows as R[]);
    });
  });
}

/** For the server's own jobs, with nobody signed in (the mail sync the scheduler starts): runs as the database owner and so skips the row rules.
 *  Only ever called behind a check that cannot be faked: the scheduler's secret, or a signed-in administrator. Never used for a page. */
export async function serviceQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return timed(sql, async () => (await pool.query(sql, params)).rows as T[]);
}

/** Write as the signed-in person. Only ever used to call the checked functions in the database (record_count_line and friends). */
export async function call<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const id = await currentUserId();
  if (!id) throw new NotSignedIn();
  return timed(sql, () => inTx(id, false, async (tx) => (await tx.query(sql, params)).rows as T[]));
}

/** A message that is safe to show: only our own "raise exception" texts and permission errors, never raw database detail. */
export function userMessage(e: unknown): string {
  const err = e as { code?: string; message?: string };
  if (e instanceof NotSignedIn) return "Your session has ended. Please sign in again.";
  if ((err.code === "P0001" || err.code === "42501" || err.code === "23514") && err.message) return err.message;
  return "Something went wrong. Nothing was saved.";
}
