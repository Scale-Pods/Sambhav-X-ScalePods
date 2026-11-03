import "server-only";
import { q } from "../db";

// Each person's own chats (migration 36). Reads only; writes are the database functions. Row rules show a person nothing but their own.

export type ChatRow = { id: string; title: string; pinned: boolean; model: string; scope: string; origin: "brain" | "ai_mode"; project_id: string | null; updated_at: string };
export type ProjectRow = { id: string; name: string; instructions: string; updated_at: string; chats: number };
export type MessageRow = {
  id: string; role: "user" | "assistant"; content: string; feedback: number | null; created_at: string;
  meta: { files?: string[]; sources?: string[]; refs?: { id: string; n: number; label: string; url: string; kind: "sheet" | "app"; note?: string }[]; follow_ups?: string[]; confidence?: string; used?: { name: string; rows: number | null }[]; usd?: number; model?: string } | null;
};

export const listChats = (origin?: string, search?: string) => {
  const like = search ? `%${search.replace(/[\\%_]/g, (c) => "\\" + c)}%` : null;
  return q<ChatRow>(
    `select c.id, c.title, c.pinned, c.model, c.scope, c.origin, c.project_id, c.updated_at from public.ask_chats c
      where ($1::text is null or c.origin = $1)
        and ($2::text is null or c.title ilike $2 or exists (select 1 from public.ask_messages m where m.chat_id = c.id and m.content ilike $2))
      order by c.pinned desc, c.updated_at desc limit ${origin || like ? 30 : 200}`, [origin ?? null, like]);
};

export async function getChat(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [chat] = await q<ChatRow>(`select id, title, pinned, model, scope, origin, project_id, updated_at from public.ask_chats where id = $1::uuid`, [id]);
  if (!chat) return null;
  const messages = await q<MessageRow>(`select id, role, content, feedback, created_at, meta from public.ask_messages where chat_id = $1::uuid order by created_at`, [id]);
  const [cost] = await q<{ usd: number }>(`select coalesce(sum((meta->>'usd')::numeric), 0)::float8 usd from public.ask_messages where chat_id = $1::uuid and role = 'assistant'`, [id]);
  return { chat, messages, usd: cost?.usd ?? 0 };
}

/** The person's own projects, newest change first, with how many chats each holds. */
export const listProjects = () =>
  q<ProjectRow>(`select p.id, p.name, p.instructions, p.updated_at, (select count(*)::int from public.ask_chats c where c.project_id = p.id and c.deleted_at is null) chats
                   from public.ask_projects p order by p.updated_at desc limit 100`);

/** The project a chat belongs to (its name and the person's own instructions), or null. */
export async function projectOfChat(chatId: string) {
  const [r] = await q<{ name: string; instructions: string }>(
    `select p.name, p.instructions from public.ask_projects p join public.ask_chats c on c.project_id = p.id where c.id = $1::uuid`, [chatId]);
  return r ?? null;
}

/** The last few messages of a chat as plain text, for the model's memory of the conversation. */
export const recentMessages = (id: string, limit = 8) =>
  q<{ role: "user" | "assistant"; content: string }>(
    `select role, content from (select role, content, created_at from public.ask_messages where chat_id = $1::uuid order by created_at desc limit ${limit}) x order by created_at`, [id]);

export async function spendToday() {
  const [r] = await q<{ spent: number; cap: number | null }>(`select spent::float8 spent, cap::float8 cap from public.ask_spend_today()`);
  return r ?? null;
}
