-- Finding a plate, heat, invoice or PO number anywhere in the copied sheets (to link an Ask answer to the exact row) read all 42,000 rows each time
-- (up to 15 seconds). A trigram index on the row text makes "contains this text" a quick lookup.
create index if not exists sheet_rows_cells_trgm on public.sheet_rows using gin ((cells::text) extensions.gin_trgm_ops) where deleted_at is null;
