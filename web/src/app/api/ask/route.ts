import { NextResponse, type NextRequest } from "next/server";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { call, currentUserId, q, runAs } from "@/lib/db";
import { DEFAULT_FILE_QUESTION, FILE_LIMITS, runAsk, type AskEvent, type AskFile, type PageCtx } from "@/lib/ask/engine";
import { prepareFiles, type RawFile } from "@/lib/ask/files";
import { AI_MODE_KEY, THINK_HARDER_KEY, defaultModel, modelByKey } from "@/lib/ask/models";
import { providerReady } from "@/lib/ask/providers";
import { recentMessages } from "@/lib/ask/chats";
import { SCOPES, type Scope } from "@/lib/ask/tools";

export const maxDuration = 60;

/**
 * A question in plain words, answered from the read-only lookups the person's role may use (lib/ask). The reply is a stream of JSON lines:
 * {type: meta|status|delta|reset|done|error}. The chat, the question and the answer are saved as the person goes.
 */
/** The attached files, checked (a few, small, each with a name and its bytes), then read: pictures and PDFs as they are, everything else turned into text. A sentence for the person when anything is off. */
async function readFiles(v: unknown): Promise<{ files: AskFile[] } | { error: string }> {
  if (v == null) return { files: [] };
  if (!Array.isArray(v)) return { error: "The files could not be read." };
  if (v.length > FILE_LIMITS.count) return { error: `Attach up to ${FILE_LIMITS.count} files at a time.` };
  const raw: RawFile[] = [];
  let bytes = 0;
  for (const x of v as { name?: unknown; mime?: unknown; data?: unknown }[]) {
    if (typeof x?.name !== "string" || typeof x.data !== "string" || x.data.length === 0 || !/^[A-Za-z0-9+/=]+$/.test(x.data)) return { error: "The files could not be read." };
    bytes += Math.floor((x.data.length * 3) / 4);
    if (bytes > FILE_LIMITS.bytes) return { error: `The files together can be ${FILE_LIMITS.bytes / 1_000_000} MB at most.` };
    raw.push({ name: x.name, mime: typeof x.mime === "string" ? x.mime : "", data: x.data });
  }
  const r = await prepareFiles(raw);
  return r.ok ? { files: r.files } : { error: r.error };
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
  // AI mode asks for "ai_mode" (its usual model) or "think_harder" (the stronger one); the Digital Brain names a model from the list
  const asked = body?.mode === "quick" ? (body?.model === "think_harder" ? THINK_HARDER_KEY : body?.model === "ai_mode" ? AI_MODE_KEY : body?.model) : body?.model;
  const chosen = modelByKey(asked) ?? (body?.mode === "quick" ? modelByKey(AI_MODE_KEY) : null) ?? defaultModel();
  const model = chosen.key;
  if (!providerReady(chosen.provider)) return NextResponse.json({ error: `${chosen.name} needs the ${chosen.provider === "openai" ? "OpenAI" : "Anthropic"} key, which is not set on this server. Pick another model.` }, { status: 400 });
  const scope: Scope = typeof body?.scope === "string" && (SCOPES as readonly string[]).includes(body.scope) ? (body.scope as Scope) : "all";
  const chatIn = typeof body?.chatId === "string" && /^[0-9a-f-]{36}$/i.test(body.chatId) ? body.chatId : null;
  const regenerate = body?.regenerate === true && chatIn !== null;
  const read = await readFiles(body?.files);
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });
  const files = read.files;
  if (files.length > 0 && !canUploadDocs(me.role)) return NextResponse.json({ error: "Your account cannot attach files." }, { status: 403 });
  let question = typeof body?.question === "string" ? body.question.trim() : "";
  const noQuestion = !regenerate && question.length < 2 && files.length > 0;
  if (noQuestion) question = DEFAULT_FILE_QUESTION; // a file with no question: read it and say what is in it
  if (!regenerate && (question.length < 2 || question.length > 600)) return NextResponse.json({ error: "Ask a question of up to 600 characters." }, { status: 400 });

  const quick = body?.mode === "quick";
  const page = quick ? readPage(body?.page) : undefined;

  // limits are checked before anything is saved
  const gate = await q<{ why: string | null }>(`select public.ask_allowed() why`);
  if (gate[0]?.why) return NextResponse.json({ error: gate[0].why }, { status: 429 });

  try {
    let chatId = chatIn;
    if (!chatId) {
      chatId = (await call<{ id: string }>(`select public.ask_new_chat($1, $2, $3, $4) id`, [(noQuestion ? `File: ${files[0].name}` : question).slice(0, 60), model, scope, quick ? "ai_mode" : "brain"]))[0].id;
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
