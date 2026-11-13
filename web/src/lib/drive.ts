import "server-only";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Opens a file in the company's Google Drive (a supplier's bill) with the same "robot" Google account the sheets sync uses. Read-only.
// On the server the account's key is in the environment (GOOGLE_SERVICE_ACCOUNT_JSON). On a developer's computer the key file in /secrets is used.

type Key = { client_email: string; private_key: string };
let cached: { token: string; until: number } | null = null;

function key(): Key | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  try {
    const j = JSON.parse(raw ?? readFileSync(join(process.cwd(), "..", "secrets", "google-service-account.json"), "utf8")) as Key;
    return j.client_email && j.private_key ? j : null;
  } catch { return null; }
}

export const driveReady = () => key() !== null;

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

async function token(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const k = key();
  if (!k) throw new Error("The Google robot account is not set up on this server.");
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(JSON.stringify({ iss: k.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(k.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }), cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!r.ok || !j.access_token) throw new Error("Google did not accept the robot account's login.");
  cached = { token: j.access_token, until: Date.now() + ((j.expires_in ?? 3600) - 120) * 1000 };
  return j.access_token;
}

/** The id inside a Drive link such as https://drive.google.com/open?id=ABC or .../file/d/ABC/view. */
export const driveId = (url: string | null | undefined): string | null => {
  const m = /[?&]id=([\w-]{10,})/.exec(url ?? "") ?? /\/d\/([\w-]{10,})/.exec(url ?? "");
  return m ? m[1] : null;
};

/** The bytes of a Drive file (up to 8 MB) and its type. */
export async function driveFile(id: string): Promise<{ bytes: Buffer; mime: string; name: string }> {
  const t = await token();
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType,size&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" });
  if (!meta.ok) throw new Error(meta.status === 404 ? "The bill could not be found in Drive (is it shared with the robot account?)." : "Drive would not open the bill.");
  const m = (await meta.json()) as { name: string; mimeType: string; size?: string };
  if (Number(m.size ?? 0) > 8_000_000) throw new Error("The bill file is too large to read here.");
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" });
  if (!r.ok) throw new Error("Drive would not give the bill file.");
  return { bytes: Buffer.from(await r.arrayBuffer()), mime: m.mimeType, name: m.name };
}
