"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type RefLink = { id: string; n: number; label: string; url: string; kind: "sheet" | "app"; note?: string };

const safeUrl = (u: string) => (u.startsWith("/") && !u.startsWith("//")) || u.startsWith("https://docs.google.com/");

/**
 * The answer cites its sources as [r3]. While it is still being written (no references yet) the markers are hidden, even a half-written one at the end;
 * once the references are known each marker becomes a small numbered link to the exact sheet row or page.
 */
function withLinks(text: string, refs?: RefLink[]) {
  if (!refs) return text.replace(/\s*\[(?:r\d*(?:\s*[,;]\s*(?:r\d*)?)*)?$/i, "").replace(/\s*\[\s*r\d+(?:\s*[,;]\s*r\d+)*\s*\]/gi, "");
  const by = new Map(refs.map((r) => [r.id, r]));
  return text.replace(/\[(r\d+)\]/gi, (_m, id: string) => { const r = by.get(id.toLowerCase()); return r && safeUrl(r.url) ? `[${r.n}](#ref-${r.id})` : ""; });
}

/** An answer with its simple formatting (bold, lists, tables). Raw HTML in the text is never rendered. */
export function Markdown({ text, refs }: { text: string; refs?: RefLink[] }) {
  const by = new Map((refs ?? []).map((r) => [r.id, r]));
  return (
    <div className="ask-md text-[0.97rem] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          a: ({ children, href }) => {
            const r = href?.startsWith("#ref-") ? by.get(href.slice(5)) : undefined;
            if (r) return <a href={r.url} target="_blank" rel="noreferrer" title={`${r.label}${r.note ? `: ${r.note}` : ""} (opens in a new tab)`} className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-0.5 items-center justify-center rounded-full bg-brand-soft px-1 align-baseline text-[0.68rem] font-semibold text-brand no-underline hover:bg-brand hover:text-white">{children}</a>;
            return <a href={href} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">{children}</a>;
          },
          code: ({ children }) => <code className="rounded bg-surface px-1 py-0.5 font-mono text-[0.88em]">{children}</code>,
          table: ({ children }) => <div className="my-3 overflow-x-auto rounded-md border border-line"><table className="w-full text-[0.88rem]">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-surface text-left text-[0.74rem] uppercase tracking-wider text-muted">{children}</thead>,
          th: ({ children }) => <th className="px-3 py-2 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-t border-line px-3 py-1.5 align-top">{children}</td>,
          h1: ({ children }) => <p className="my-2 font-display text-[1.05rem] font-bold">{children}</p>,
          h2: ({ children }) => <p className="my-2 font-display text-[1.02rem] font-bold">{children}</p>,
          h3: ({ children }) => <p className="my-2 font-display font-bold">{children}</p>,
        }}
      >
        {withLinks(text, refs)}
      </ReactMarkdown>
    </div>
  );
}
