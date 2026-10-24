import "server-only";
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
  }));

export type Tx = Pick<PoolClient, "query">;

/** The signed-in person's id from the verified session cookie, or null. */
export const currentUserId = cache(async (): Promise<string | null> => {
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

/** Read as the signed-in person. */
export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const id = await currentUserId();
  if (!id) throw new NotSignedIn();
  return inTx(id, true, async (tx) => (await tx.query(sql, params)).rows as T[]);
}

/** Several reads as the signed-in person in one transaction on one connection. An overview page asks 10-14 questions; sent together they
 *  no longer queue for the pool one by one (the connection runs them in turn, without a round of set-up for each). */
export async function qTx<T>(fn: (q: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  const id = await currentUserId();
  if (!id) throw new NotSignedIn();
  return inTx(id, true, (tx) => fn(async <R,>(sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows as R[]));
}

/** Write as the signed-in person. Only ever used to call the checked functions in the database (record_count_line and friends). */
export async function call<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const id = await currentUserId();
  if (!id) throw new NotSignedIn();
  return inTx(id, false, async (tx) => (await tx.query(sql, params)).rows as T[]);
}

/** A message that is safe to show: only our own "raise exception" texts and permission errors, never raw database detail. */
export function userMessage(e: unknown): string {
  const err = e as { code?: string; message?: string };
  if (e instanceof NotSignedIn) return "Your session has ended. Please sign in again.";
  if ((err.code === "P0001" || err.code === "42501" || err.code === "23514") && err.message) return err.message;
  return "Something went wrong. Nothing was saved.";
}
