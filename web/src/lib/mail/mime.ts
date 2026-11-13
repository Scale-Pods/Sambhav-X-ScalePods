import "server-only";
import { randomBytes } from "node:crypto";

// A mail message in the form Gmail takes ("raw": the whole message, base64url). Text and HTML versions, attachments, and the headers that keep a reply in its conversation.

export type OutAttachment = { name: string; mime: string; bytes: Buffer };
export type Out = { from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; html: string; text: string; inReplyTo?: string; references?: string; attachments: OutAttachment[] };

const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);
/** A header value with letters outside plain English written the way mail systems expect (RFC 2047). */
const word = (s: string) => (ascii(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const wrap = (b64: string) => b64.replace(/(.{76})/g, "$1\r\n");
export const htmlToText = (h: string) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();

export function buildRaw(o: Out): string {
  const alt = `alt_${randomBytes(8).toString("hex")}`, mixed = `mix_${randomBytes(8).toString("hex")}`;
  const part = (type: string, body: string) => `Content-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(Buffer.from(body, "utf8").toString("base64"))}`;
  const body = `--${alt}\r\n${part("text/plain", o.text)}\r\n--${alt}\r\n${part("text/html", o.html)}\r\n--${alt}--`;
  const head = [
    `From: ${clean(o.from)}`, o.to.length ? `To: ${o.to.map(clean).join(", ")}` : "", o.cc.length ? `Cc: ${o.cc.map(clean).join(", ")}` : "", o.bcc.length ? `Bcc: ${o.bcc.map(clean).join(", ")}` : "",
    `Subject: ${word(clean(o.subject))}`, o.inReplyTo ? `In-Reply-To: ${clean(o.inReplyTo)}` : "", o.references ? `References: ${clean(o.references)}` : "", "MIME-Version: 1.0",
  ].filter(Boolean).join("\r\n");
  let msg: string;
  if (o.attachments.length === 0) {
    msg = `${head}\r\nContent-Type: multipart/alternative; boundary="${alt}"\r\n\r\n${body}\r\n`;
  } else {
    const files = o.attachments.map((a) => {
      const n = clean(a.name).replace(/"/g, "'") || "attachment";
      return `--${mixed}\r\nContent-Type: ${/^[\w.+-]+\/[\w.+-]+$/.test(a.mime) ? a.mime : "application/octet-stream"}; name="${word(n)}"\r\nContent-Disposition: attachment; filename="${ascii(n) ? n : "attachment"}"; filename*=UTF-8''${encodeURIComponent(n)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(a.bytes.toString("base64"))}`;
    });
    msg = `${head}\r\nContent-Type: multipart/mixed; boundary="${mixed}"\r\n\r\n--${mixed}\r\nContent-Type: multipart/alternative; boundary="${alt}"\r\n\r\n${body}\r\n${files.join("\r\n")}\r\n--${mixed}--\r\n`;
  }
  return Buffer.from(msg, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
