import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// A mailbox's Google login (its refresh token) is stored encrypted with AES-256-GCM. The key is MAIL_TOKEN_KEY in the server's environment (32 random bytes, base64);
// without it the stored text is useless, and the database never has the key.

function key(): Buffer {
  const k = Buffer.from(process.env.MAIL_TOKEN_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("MAIL_TOKEN_KEY is missing or is not 32 bytes in base64");
  return k;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function unseal(sealed: string): string {
  const [iv, tag, enc] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !enc) throw new Error("The stored login is damaged");
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
