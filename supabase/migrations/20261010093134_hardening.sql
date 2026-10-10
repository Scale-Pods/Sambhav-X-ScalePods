-- hardening: fixes found by the Supabase security / performance advisors after the first apply

-- 1. mail summary: counts-only for all internal staff, without a SECURITY DEFINER view
create or replace function app.mail_summary()
returns table (mailbox_id uuid, address text, entity_id uuid, awaiting_reply bigint, follow_up bigint, threads bigint)
language sql stable security definer set search_path = public as $$
  select m.id, m.address, m.entity_id,
         count(t.id) filter (where t.status in ('new', 'needs_reply')),
         count(t.id) filter (where t.status = 'follow_up'),
         count(t.id)
    from public.mailboxes m
    left join public.mail_threads t on t.mailbox_id = m.id
   where app.is_internal()
   group by m.id
$$;

create or replace view public.v_mail_summary with (security_invoker = true) as
select * from app.mail_summary();

-- 2. fixed search_path on every function we own
alter function app.norm_text(text)                 set search_path = '';
alter function app.set_updated_at()                set search_path = '';
alter function app.forbid_mutation()               set search_path = '';
alter function app.lots_guard_core()               set search_path = '';
alter function app.documents_flag_duplicate()      set search_path = public;
alter function app.lots_set_match_key()            set search_path = public;
alter function app.movements_check_balance()       set search_path = public;
alter function app.lots_require_identity_docs()    set search_path = public;
alter function public.fn_lot_valuation(date)       set search_path = public;

-- 3. Supabase's built-in RLS helper should not be callable through the API
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 4. index every single-column foreign key that has no covering index
do $$
declare
  r record;
begin
  for r in
    select cl.relname as tbl, a.attname as col
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and array_length(c.conkey, 1) = 1
       and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
  loop
    execute format('create index if not exists %I on public.%I (%I)', left(r.tbl || '_' || r.col || '_fk', 63), r.tbl, r.col);
  end loop;
end $$;
