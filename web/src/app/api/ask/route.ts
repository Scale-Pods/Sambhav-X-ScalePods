import { NextResponse, type NextRequest } from "next/server";
import { currentStaff } from "@/lib/auth";
import { call, currentUserId, q, runAs } from "@/lib/db";
import { MODELS, runAsk, type AskEvent, type ModelKey } from "@/lib/ask/engine";
import { recentMessages } from "@/lib/ask/chats";
import { SCOPES, type Scope } from "@/lib/ask/tools";

export const maxDuration = 60;

/**
 * A question in plain words, answered from the read-only lookups the person's role may use (lib/ask). The reply is a stream of JSON lines:
 * {type: meta|status|delta|reset|done|error}. The chat, the question and the answer are saved as the person goes.
 */
export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  const uid = await currentUserId().catch(() => null);
  if (!me || !uid) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { question?: unknown; chatId?: unknown; model?: unknown; scope?: unknown; regenerate?: unknown } | null;
  const model: ModelKey = typeof body?.model === "string" && body.model in MODELS ? (body.model as ModelKey) : "balanced";
  const scope: Scope = typeof body?.scope === "string" && (SCOPES as readonly string[]).includes(body.scope) ? (body.scope as Scope) : "all";
  const chatIn = typeof body?.chatId === "string" && /^[0-9a-f-]{36}$/i.test(body.chatId) ? body.chatId : null;
  const regenerate = body?.regenerate === true && chatIn !== null;
  let question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!regenerate && (question.length < 2 || question.length > 600)) return NextResponse.json({ error: "Ask a question of up to 600 characters." }, { status: 400 });

  // limits are checked before anything is saved
  const gate = await q<{ why: string | null }>(`select public.ask_allowed() why`);
  if (gate[0]?.why) return NextResponse.json({ error: gate[0].why }, { status: 429 });

  try {
    let chatId = chatIn;
    if (!chatId) {
      chatId = (await call<{ id: string }>(`select public.ask_new_chat($1, $2, $3) id`, [question.slice(0, 60), model, scope]))[0].id;
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
      await call(`select public.ask_add_message($1::uuid, 'user', $2, '{}'::jsonb)`, [chatId, question]);
    }

    const enc = new TextEncoder();
    const finalChat = chatId!;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (e: AskEvent | { type: "meta"; chatId: string } | { type: "saved"; messageId: string }) => { try { controller.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { /* the person left */ } };
        send({ type: "meta", chatId: finalChat });
        try {
          await runAs(uid, async () => {
            const res = await runAsk({ question, history, role: me.role, model, scope, chatId: finalChat }, (e) => { if (e.type !== "done") send(e); });
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
