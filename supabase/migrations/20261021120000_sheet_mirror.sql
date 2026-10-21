-- 15: live mirror of the client's Google Sheets (read-only, one way: sheets -> database).
-- Raw rows exactly as typed, each tagged with its sheet, tab and row number. This is not the ledger: the modules read
-- from it to migrate, and edits to rows that were already loaded are listed in sheet_row_changes for review, never applied silently.

create table public.sheet_sources (
  key              text primary key,
  name             text not null,
  spreadsheet_id   text not null unique,
  active           boolean not null default true,
  skip_tabs        text[] not null default '{}',   -- tabs that must never be copied (they hold keys / passwords)
  last_modified_at timestamptz,                    -- the sheet's own "modified" time when we last read it
  last_synced_at   timestamptz,
  last_error       text
);

create table public.sheet_rows (
  source_key    text not null references public.sheet_sources (key),
  tab           text not null,
  row_no        integer not null,                   -- 1-based row in the sheet
  cells         jsonb not null,                     -- the displayed text of each cell, left to right
  links         jsonb,                              -- column index (0-based) -> web address, for cells that hold a link
  row_hash      text not null,
  first_seen_at timestamptz not null default now(),
  changed_at    timestamptz not null default now(),
  deleted_at    timestamptz,                        -- set when the row became empty or the sheet got shorter
  primary key (source_key, tab, row_no)
);
create index sheet_rows_changed on public.sheet_rows (source_key, tab, changed_at desc);

create table public.sheet_row_changes (
  id          bigint generated always as identity primary key,
  source_key  text not null references public.sheet_sources (key),
  tab         text not null,
  row_no      integer not null,
  kind        text not null check (kind in ('new', 'edit', 'removed')),
  old_cells   jsonb,
  new_cells   jsonb,
  seen_at     timestamptz not null default now()
);
create index sheet_row_changes_seen on public.sheet_row_changes (source_key, seen_at desc);

create table public.sheet_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  source_key    text not null references public.sheet_sources (key),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running' check (status in ('running', 'ok', 'skipped', 'failed')),
  tabs          integer,
  rows_seen     integer,
  rows_new      integer,
  rows_changed  integer,
  rows_removed  integer,
  error         text
);
create index sheet_sync_runs_source on public.sheet_sync_runs (source_key, started_at desc);

alter table public.sheet_sources enable row level security;
alter table public.sheet_rows enable row level security;
alter table public.sheet_row_changes enable row level security;
alter table public.sheet_sync_runs enable row level security;
grant select on public.sheet_sources, public.sheet_rows, public.sheet_row_changes, public.sheet_sync_runs to authenticated;
-- raw sheets hold expenses, payments and customer details: administrators only
create policy admin_read on public.sheet_sources for select to authenticated using ((select app.is_admin()));
create policy admin_read on public.sheet_rows for select to authenticated using ((select app.is_admin()));
create policy admin_read on public.sheet_row_changes for select to authenticated using ((select app.is_admin()));
create policy admin_read on public.sheet_sync_runs for select to authenticated using ((select app.is_admin()));
