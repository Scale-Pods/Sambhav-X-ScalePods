import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AskFile } from "./engine";
import type { ModelDef } from "./models";
import { answerSoFar } from "./answerSoFar";

// One conversation with one model. The engine (engine.ts) asks for a round, runs the lookups the model asked for, hands the results back and asks again,
// until the model gives its answer. The two providers differ in wire format only, so each is wrapped here behind the same small interface.

export type ToolDef = { name: string; description: string; schema: Record<string, unknown> };
export type Call = { id: string; name: string; input: Record<string, unknown> };
export type RoundOut = { text: string; calls: Call[]; inTok: number; cachedTok: number; outTok: number };
export type Hooks = { onTool: (name: string) => void; onDelta: (text: string) => void };
export type Result = { id: string; content: string; isError?: boolean };
export interface Session {
  round(last: boolean, hooks: Hooks): Promise<RoundOut>;
  addResults(results: Result[]): void;
}
export type SessionInput = {
  system: string; tools: ToolDef[]; final: ToolDef; maxTokens: number;
  history: { role: "user" | "assistant"; content: string }[]; question: string; files: AskFile[]; textLimit: number;
};

/** Which providers have their key set in this environment (a screen shows the others as "add the key"). */
export const providerReady = (p: "anthropic" | "openai") => Boolean(p === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);

export function openSession(m: ModelDef, i: SessionInput): Session {
  return m.provider === "anthropic" ? anthropicSession(m, i) : openaiSession(m, i);
}

// ------------------------------------------------------------------------------------------------------------------------------- Anthropic
function anthropicSession(m: ModelDef, i: SessionInput): Session {
  const client = new Anthropic({ maxRetries: 2, timeout: 60_000 });
  const tool = (t: ToolDef): Anthropic.Tool => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Tool.InputSchema });
  const all = [...i.tools.map(tool), tool(i.final)];
  const onlyFinal = [tool(i.final)];

  const content: Anthropic.ContentBlockParam[] | string = (() => {
    if (i.files.length === 0) return i.question;
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const f of i.files) {
      if (f.kind === "pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: f.name.slice(0, 100) });
      else if (f.kind === "image") blocks.push({ type: "image", source: { type: "base64", media_type: f.mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: f.data } });
      else blocks.push({ type: "text", text: `Attached file "${f.name.slice(0, 100)}" (${f.label ?? "text, as data"}):\n${f.data.slice(0, i.textLimit)}` });
    }
    blocks.push({ type: "text", text: i.question });
    return blocks;
  })();
  const messages: Anthropic.MessageParam[] = [...i.history.map((h) => ({ role: h.role, content: h.content })), { role: "user", content }];

  return {
    async round(last, hooks) {
      const forced = last && m.forceFinal;
      const stream = client.messages.stream({
        model: m.id, max_tokens: i.maxTokens, system: i.system, messages,
        // the stronger 5.5 models refuse a forced tool: on the last round they are given only the answer tool instead
        tools: last && !m.forceFinal ? onlyFinal : all,
        ...(forced ? { tool_choice: { type: "tool" as const, name: i.final.name } } : {}),
        ...(m.effort ? { output_config: { effort: m.effort } } : {}),
      });
      let finalIdx = -1, buf = "", sent = 0;
      for await (const ev of stream) {
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
          if (ev.content_block.name === i.final.name) { finalIdx = ev.index; buf = ""; sent = 0; } else hooks.onTool(ev.content_block.name);
        } else if (ev.type === "content_block_delta" && ev.delta.type === "input_json_delta" && ev.index === finalIdx) {
          buf += ev.delta.partial_json;
          const t = answerSoFar(buf);
          if (t.length > sent) { hooks.onDelta(t.slice(sent)); sent = t.length; }
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          hooks.onDelta(ev.delta.text);
        }
      }
      const r = await stream.finalMessage();
      messages.push({ role: "assistant", content: r.content }); // thinking blocks included, unchanged: the model needs them back
      return {
        text: r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim(),
        calls: r.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> })),
        inTok: r.usage.input_tokens, cachedTok: 0, outTok: r.usage.output_tokens,
      };
    },
    addResults(results) {
      messages.push({ role: "user", content: results.map((x) => ({ type: "tool_result" as const, tool_use_id: x.id, content: x.content, ...(x.isError ? { is_error: true } : {}) })) });
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------------------- OpenAI (Responses API)
type Item = OpenAI.Responses.ResponseInputItem;

function openaiSession(m: ModelDef, i: SessionInput): Session {
  const client = new OpenAI({ maxRetries: 2, timeout: 60_000 });
  const fn = (t: ToolDef): OpenAI.Responses.FunctionTool => ({ type: "function", name: t.name, description: t.description, parameters: t.schema, strict: false });
  const all = [...i.tools.map(fn), fn(i.final)];

  const parts: OpenAI.Responses.ResponseInputContent[] = [];
  for (const f of i.files) {
    const url = `data:${f.mime};base64,${f.data}`;
    if (f.kind === "pdf") parts.push({ type: "input_file", filename: f.name.slice(0, 100), file_data: url });
    else if (f.kind === "image") parts.push({ type: "input_image", image_url: url, detail: "auto" });
    else parts.push({ type: "input_text", text: `Attached file "${f.name.slice(0, 100)}" (${f.label ?? "text, as data"}):\n${f.data.slice(0, i.textLimit)}` });
  }
  parts.push({ type: "input_text", text: i.question });
  const input: Item[] = [...i.history.map((h) => ({ role: h.role, content: h.content }) as Item), { role: "user", content: parts }];

  return {
    async round(last, hooks) {
      const base = {
        model: m.id, instructions: i.system, input, max_output_tokens: i.maxTokens, store: false, stream: true as const,
        tools: last ? [fn(i.final)] : all,
        tool_choice: last ? ({ type: "function", name: i.final.name } as const) : ("auto" as const),
      };
      // low reasoning effort keeps the hidden thinking (billed as output) small; the encrypted trace is passed back so a tool round can continue. Retried without
      // those two settings if this model does not accept them.
      const open = async () => {
        try { return await client.responses.create({ ...base, reasoning: { effort: "low" }, include: ["reasoning.encrypted_content"] }); }
        catch (e) {
          if (e instanceof OpenAI.APIError && e.status === 400 && /reasoning|include|effort/i.test(e.message)) return client.responses.create(base);
          throw e;
        }
      };
      const stream = await open();
      const finalIds = new Set<string>();
      let buf = "", sent = 0, done: OpenAI.Responses.Response | null = null;
      for await (const ev of stream) {
        if (ev.type === "response.output_item.added" && ev.item.type === "function_call") {
          if (ev.item.name === i.final.name) { finalIds.add(ev.item.id ?? ""); buf = ""; sent = 0; } else hooks.onTool(ev.item.name);
        } else if (ev.type === "response.function_call_arguments.delta" && finalIds.has(ev.item_id)) {
          buf += ev.delta;
          const t = answerSoFar(buf);
          if (t.length > sent) { hooks.onDelta(t.slice(sent)); sent = t.length; }
        } else if (ev.type === "response.output_text.delta") {
          hooks.onDelta(ev.delta);
        } else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
          done = ev.response;
        } else if (ev.type === "response.failed") {
          throw new Error(ev.response.error?.message ?? "The model could not answer");
        } else if (ev.type === "error") {
          throw new Error(ev.message);
        }
      }
      if (!done) throw new Error("The model's reply ended early");
      input.push(...(done.output as unknown as Item[]));
      const calls: Call[] = [];
      let text = "";
      for (const o of done.output) {
        if (o.type === "function_call") {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(o.arguments || "{}") as Record<string, unknown>; } catch { /* an unreadable call is run with no arguments and fails politely */ }
          calls.push({ id: o.call_id, name: o.name, input: args });
        } else if (o.type === "message") {
          for (const c of o.content) if (c.type === "output_text") text += (text ? "\n" : "") + c.text;
        }
      }
      return { text: text.trim(), calls, inTok: done.usage?.input_tokens ?? 0, cachedTok: done.usage?.input_tokens_details?.cached_tokens ?? 0, outTok: done.usage?.output_tokens ?? 0 };
    },
    addResults(results) {
      for (const x of results) input.push({ type: "function_call_output", call_id: x.id, output: x.content } as Item);
    },
  };
}
