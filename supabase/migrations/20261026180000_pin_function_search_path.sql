-- 30: the seven helper functions that did not pin which schema they run in (break-it review finding 15, flagged by the security scanner).
alter function app.dispatch_date(text) set search_path = pg_catalog, public;
alter function app.fy_label(date) set search_path = pg_catalog, public;
alter function app.mail_ts(text) set search_path = pg_catalog, public;
alter function app.sheet_date(text) set search_path = pg_catalog, public;
alter function app.sheet_date_dmy(text) set search_path = pg_catalog, public;
alter function app.sheet_num(text) set search_path = pg_catalog, public;
alter function app.sheet_ts(text) set search_path = pg_catalog, public;
