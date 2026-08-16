-- =============================================================================
-- LEDGER — Data API grants
-- Run this in the SQL Editor, after schema.sql and functions.sql.
--
-- Supabase changed its defaults on May 30, 2026: new projects no longer
-- auto-expose tables/functions to the Data API (the REST layer supabase-js
-- talks to). Row Level Security still controls *which rows* a role can see,
-- but a role also needs an explicit GRANT just to reach the table or
-- function at all. Since this app requires sign-in before touching any
-- data, only the `authenticated` role needs access — `anon` gets nothing.
--
-- Safe to run even if your project predates the change / already has these
-- grants — GRANT is idempotent.
-- =============================================================================

grant select, insert, update, delete on table public.categories to authenticated;
grant select, insert, update, delete on table public.transactions to authenticated;

-- The identity columns (categories.id, transactions.id) are backed by
-- sequences; inserts need permission to read/advance them too.
grant usage, select on all sequences in schema public to authenticated;

grant execute on function public.get_summary(text) to authenticated;
grant execute on function public.get_trends(int, bigint[]) to authenticated;
