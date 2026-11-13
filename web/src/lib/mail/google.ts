import "server-only";

// Google sign-in and the Gmail API, by plain web calls (no extra package). Read-only: the only permission asked for is "read your mail" (gmail.readonly),
// so this app can never send, change or delete anything in a mailbox.

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set on this server`);
  return v;
};

/** The address Google sends the person back to: the app's own address plus the callback path (it must match what is registered in Google Cloud). */
export const redirectUri = (origin: string) => `${process.env.APP_ORIGIN || origin}/api/mail/google/callback`;

export function authUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: need("GOOGLE_CLIENT_ID"), redirect_uri: redirectUri(origin), response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", state, // offline + consent: Google hands back a refresh token every time
  });
  return `${AUTH}?${p}`;
}

async function tokenCall(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string }> {
  const r = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: need("GOOGLE_CLIENT_ID"), client_secret: need("GOOGLE_CLIENT_SECRET"), ...body }), cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`Google refused the login (${j.error ?? r.status}${j.error_description ? ": " + j.error_description : ""})`);
  return { access_token: j.access_token, refresh_token: j.refresh_token };
}

export const exchangeCode = (code: string, origin: string) => tokenCall({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin) });
export const accessToken = async (refresh: string) => (await tokenCall({ grant_type: "refresh_token", refresh_token: refresh })).access_token;

export async function gmail<T>(token: string, path: string, params: Record<string, string | string[]> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) qs.append(k, x); // a list is sent as the same name repeated, as Gmail wants
  const r = await fetch(`${API}${path}?${qs}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) throw new Error(`Gmail said ${r.status} for ${path.split("/").slice(0, 2).join("/")}`);
  return (await r.json()) as T;
}

// ---------------------------------------------------------------- a message, as Gmail returns it
export type Part = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { size?: number; data?: string; attachmentId?: string }; parts?: Part[] };
export type Message = { id: string; threadId: string; internalDate?: string; payload: Part };

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
export const header = (m: Message, name: string) => m.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

export type Found = { html: string[]; text: string[]; files: { name: string; mime: string; attachmentId: string; size: number }[] };
/** The bodies and the attachments of a message, wherever they sit in its parts. */
export function collect(part: Part, out: Found = { html: [], text: [], files: [] }): Found {
  const mime = (part.mimeType ?? "").toLowerCase();
  if (part.filename && part.body?.attachmentId) out.files.push({ name: part.filename, mime, attachmentId: part.body.attachmentId, size: part.body.size ?? 0 });
  else if (part.filename && part.body?.data) { // a small attachment can arrive inline
    (mime === "text/html" ? out.html : out.text).push(b64url(part.body.data));
  } else if (!part.filename && part.body?.data) {
    if (mime === "text/html") out.html.push(b64url(part.body.data));
    else if (mime === "text/plain") out.text.push(b64url(part.body.data));
  }
  for (const p of part.parts ?? []) collect(p, out);
  return out;
}

export async function attachmentText(token: string, messageId: string, attachmentId: string): Promise<string> {
  const j = await gmail<{ data?: string }>(token, `/messages/${messageId}/attachments/${attachmentId}`);
  return j.data ? b64url(j.data) : "";
}
