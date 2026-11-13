"use client";

import { useMemo, useRef, useState } from "react";
import { ImageOff } from "lucide-react";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const link = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');

/**
 * The body of one mail. It is shown in a frame that cannot run script and cannot reach this page, with outside pictures held back until the person asks
 * (a picture loaded from outside tells the sender the mail was opened). Links open in a new tab.
 */
export function MessageBody({ html, text }: { html: string | null; text: string | null }) {
  const [images, setImages] = useState(false);
  const [height, setHeight] = useState(120);
  const frame = useRef<HTMLIFrameElement>(null);
  const hasRemote = useMemo(() => Boolean(html && /<img[^>]+src=["']?https?:/i.test(html)) || Boolean(html && /url\(\s*["']?https?:/i.test(html)), [html]);
  const doc = useMemo(() => {
    const body = html ?? `<div style="white-space:pre-wrap">${link(text ?? "")}</div>`;
    const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: ${images ? "https: http:" : ""}`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">`
      + `<style>html,body{margin:0}body{padding:4px 2px;font:14px/1.5 Arial,sans-serif;color:#1a2530;background:#fff;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#0a76ad}blockquote{margin:8px 0 8px 4px;padding-left:10px;border-left:3px solid #d5dbe2;color:#55606d}</style></head><body>${body}</body></html>`;
  }, [html, text, images]);
  const measure = () => { const d = frame.current?.contentDocument; if (d) setHeight(Math.min(Math.max(d.documentElement.scrollHeight, d.body?.scrollHeight ?? 0) + 8, 6000)); };
  return (
    <div>
      {hasRemote && !images && (
        <p className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-surface px-3 py-1.5 text-[0.82rem] text-muted"><ImageOff className="h-4 w-4" />Pictures from outside are not shown, so the sender cannot tell you opened this mail.
          <button type="button" onClick={() => setImages(true)} className="font-medium text-brand hover:underline">Show pictures</button></p>
      )}
      <iframe ref={frame} title="Mail" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} onLoad={measure} style={{ height }} className="w-full rounded-md border border-line bg-white" />
    </div>
  );
}
