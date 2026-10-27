-- 37: for the administrator, the answers people marked as not good (with the question before them), so the lookups behind them can be improved.
create or replace function public.ask_feedback_log()
returns table (asked_at timestamptz, person text, question text, answer text, model text, tools jsonb)
language sql stable security definer set search_path = public as $$
  select m.created_at, s.full_name, (select u.content from public.ask_messages u where u.chat_id = m.chat_id and u.role = 'user' and u.created_at < m.created_at order by u.created_at desc limit 1),
         m.content, m.meta->>'model', coalesce(m.meta->'used', '[]'::jsonb)
    from public.ask_messages m join public.ask_chats c on c.id = m.chat_id join public.staff s on s.id = c.staff_id
   where app.is_admin() and m.feedback = -1 order by m.created_at desc limit 100
$$;
revoke execute on function public.ask_feedback_log() from public, anon;
grant execute on function public.ask_feedback_log() to authenticated;
