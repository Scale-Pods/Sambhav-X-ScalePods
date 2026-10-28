import { NextResponse, type NextRequest } from "next/server";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { call, currentUserId, q, runAs } from "@/lib/db";
import { FILE_LIMITS, MODELS, runAsk, type AskEvent, type AskFile, type ModelKey, type PageCtx } from "@/lib/ask/engine";
import { recentMessages } from "@/lib/ask/chats";
import { SCOPES, type Scope } from "@/lib/ask/tools";

export const maxDuration = 60;

/**
 * A question in plain words, answered from the read-only lookups the person's role may use (lib/ask). The reply is a stream of JSON lines:
 * {type: meta|status|delta|reset|done|error}. The chat, the question and the answer are saved as the person goes.
 */
const ALLOWED: Record<string, AskFile["kind"]> = {
  "application/pdf": "pdf", "image/png": "image", "image/jpeg": "image", "image/webp": "image", "image/gif": "image",
  "text/plain": "text", "text/csv": "text", "text/tab-separated-values": "text", "text/markdown": "text", "application/json": "text",
};

/** The attached files, checked: a few, small, of a known kind. "bad" when anything is off. */
function readFiles(v: unknown): AskFile[] | "bad" {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > FILE_LIMITS.count) return "bad";
  const out: AskFile[] = [];
  let bytes = 0;
  for (const x of v as { name?: unknown; mime?: unknown; data?: unknown }[]) {
    const kind = typeof x?.mime === "string" ? ALLOWED[x.mime] : undefined;
    if (!kind || typeof x.name !== "string" || typeof x.data !== "string" || x.data.length === 0) return "bad";
    bytes += kind === "text" ? x.data.length : Math.floor((x.data.length * 3) / 4);
    if (bytes > FILE_LIMITS.bytes) return "bad";
    if (kind !== "text" && !/^[A-Za-z0-9+/=]+$/.test(x.data)) return "bad";
    out.push({ name: x.name.replace(/[^\w .()\-]/g, "_").slice(0, 100), kind, mime: x.mime as string, data: x.data });
  }
  return out;
}

/** The page AI mode was opened on, kept small and plain. */
function readPage(v: unknown): PageCtx | undefined {
  const x = v as { path?: unknown; title?: unknown; params?: unknown } | null;
  if (!x || typeof x.path !== "string" || !x.path.startsWith("/") || x.path.length > 200) return undefined;
  const params: Record<string, string> = {};
  if (x.params && typeof x.params === "object") for (const [k, val] of Object.entries(x.params as Record<string, unknown>).slice(0, 10)) if (typeof val === "string" && k.length <= 30) params[k] = val.slice(0, 80);
  return { path: x.path, title: typeof x.title === "string" ? x.title.slice(0, 80) : x.path, params };
}

export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  const uid = await currentUserId().catch(() => null);
  if (!me || !uid) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { question?: unknown; chatId?: unknown; model?: unknown; scope?: unknown; regenerate?: unknown; files?: unknown; mode?: unknown; page?: unknown } | null;
  const model: ModelKey = typeof body?.model === "string" && body.model in MODELS ? (body.model as ModelKey) : "balanced";
  const scope: Scope = typeof body?.scope === "string" && (SCOPES as readonly string[]).includes(body.scope) ? (body.scope as Scope) : "all";
  const chatIn = typeof body?.chatId === "string" && /^[0-9a-f-]{36}$/i.test(body.chatId) ? body.chatId : null;
  const regenerate = body?.regenerate === true && chatIn !== null;
  let question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!regenerate && (question.length < 2 || question.length > 600)) return NextResponse.json({ error: "Ask a question of up to 600 characters." }, { status: 400 });

  const quick = body?.mode === "quick";
  const page = quick ? readPage(body?.page) : undefined;
  const files = readFiles(body?.files);
  if (files === "bad") return NextResponse.json({ error: `Attach up to ${FILE_LIMITS.count} files (PDF, picture or text), 3 MB in all.` }, { status: 400 });
  if (files.length > 0 && !canUploadDocs(me.role)) return NextResponse.json({ error: "Your account cannot attach files." }, { status: 403 });

  // limits are checked before anything is saved
  const gate = await q<{ why: string | null }>(`select public.ask_allowed() why`);
  if (gate[0]?.why) return NextResponse.json({ error: gate[0].why }, { status: 429 });

  try {
    let chatId = chatIn;
    if (!chatId) {
      chatId = (await call<{ id: string }>(`select public.ask_new_chat($1, $2, $3, $4) id`, [question.slice(0, 60), model, scope, quick ? "ai_mode" : "brain"]))[0].id;
    } else {
      await call(`select public.ask_update_chat($1::uuid, null, null, $2, $3)`, [chatId, model, scope]);
    }
    let history: { role: "user" | "assistant"; content: string }[];
    if (regenerate) {
      const rows = await recentMessages(chatId!, 10);
      let at = -1;
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].role === "user") { at = i; break; }
      if (at < 0) return NextResponse.json({ error: "There is nothing to answer again." }, { status: 400 });
      question = rows[at].content;
      history = rows.slice(0, at);
      await call(`select public.ask_drop_last_answer($1::uuid)`, [chatId]);
    } else {
      history = await recentMessages(chatId!, 6);
      await call(`select public.ask_add_message($1::uuid, 'user', $2, $3::jsonb)`, [chatId, question, JSON.stringify(files.length ? { files: files.map((f) => f.name) } : {})]);
    }

    const enc = new TextEncoder();
    const finalChat = chatId!;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (e: AskEvent | { type: "meta"; chatId: string } | { type: "saved"; messageId: string }) => { try { controller.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { /* the person left */ } };
        send({ type: "meta", chatId: finalChat });
        try {
          await runAs(uid, async () => {
            const res = await runAsk({ mode: quick ? "quick" : undefined, page, files, question, history, role: me.role, model, scope, chatId: finalChat }, (e) => { if (e.type !== "done") send(e); });
            if (res) {
              const meta = { sources: res.sources, refs: res.refs, follow_ups: res.follow_ups, confidence: res.confidence, used: res.used.map((u) => ({ name: u.name, rows: u.rows })), usd: res.usd, model: res.model };
              const saved = await call<{ id: string }>(`select public.ask_add_message($1::uuid, 'assistant', $2, $3::jsonb) id`, [finalChat, res.answer, JSON.stringify(meta)]);
              send({ type: "saved", messageId: saved[0].id });
              send({ type: "done", result: res });
            }
          });
        } catch {
          send({ type: "error", error: "The question could not be answered right now. Please try again." });
        }
        try { controller.close(); } catch { /* already closed */ }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch {
    return NextResponse.json({ error: "The question could not be started. Please try again." }, { status: 500 });
  }
}
