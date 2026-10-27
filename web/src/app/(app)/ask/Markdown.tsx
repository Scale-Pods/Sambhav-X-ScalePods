"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** An answer with its simple formatting (bold, lists, tables). Raw HTML in the text is never rendered. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="ask-md text-[0.97rem] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">{children}</a>,
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
        {text}
      </ReactMarkdown>
    </div>
  );
}
