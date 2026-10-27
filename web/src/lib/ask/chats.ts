import "server-only";
import { q } from "../db";

// Each person's own chats (migration 36). Reads only; writes are the database functions. Row rules show a person nothing but their own.

export type ChatRow = { id: string; title: string; pinned: boolean; model: "fast" | "balanced"; scope: string; updated_at: string };
export type MessageRow = {
  id: string; role: "user" | "assistant"; content: string; feedback: number | null; created_at: string;
  meta: { sources?: string[]; follow_ups?: string[]; confidence?: string; used?: { name: string; rows: number | null }[]; usd?: number; model?: string } | null;
};

export const listChats = () =>
  q<ChatRow>(`select id, title, pinned, model, scope, updated_at from public.ask_chats order by pinned desc, updated_at desc limit 200`);

export async function getChat(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [chat] = await q<ChatRow>(`select id, title, pinned, model, scope, updated_at from public.ask_chats where id = $1::uuid`, [id]);
  if (!chat) return null;
  const messages = await q<MessageRow>(`select id, role, content, feedback, created_at, meta from public.ask_messages where chat_id = $1::uuid order by created_at`, [id]);
  const [cost] = await q<{ usd: number }>(`select coalesce(sum((meta->>'usd')::numeric), 0)::float8 usd from public.ask_messages where chat_id = $1::uuid and role = 'assistant'`, [id]);
  return { chat, messages, usd: cost?.usd ?? 0 };
}

/** The last few messages of a chat as plain text, for the model's memory of the conversation. */
export const recentMessages = (id: string, limit = 8) =>
  q<{ role: "user" | "assistant"; content: string }>(
    `select role, content from (select role, content, created_at from public.ask_messages where chat_id = $1::uuid order by created_at desc limit ${limit}) x order by created_at`, [id]);

export async function spendToday() {
  const [r] = await q<{ spent: number; cap: number | null }>(`select spent::float8 spent, cap::float8 cap from public.ask_spend_today()`);
  return r ?? null;
}
