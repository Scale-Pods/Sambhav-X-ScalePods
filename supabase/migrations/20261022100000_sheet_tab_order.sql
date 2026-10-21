-- 16: remember each mirrored sheet's tab order and which tabs are hidden, so the sheet view shows them as the sheet does.
alter table public.sheet_sources add column tabs jsonb;  -- [{"title": "...", "hidden": false}, ...] in the sheet's own order
