-- =============================================================================
-- LEDGER — service_role safety net (for the WhatsApp webhook function)
-- Run this once in the SQL Editor, any time after schema.sql.
--
-- Supabase's `service_role` key already bypasses Row Level Security and
-- normally has full table access by default — this is just an explicit,
-- idempotent belt-and-suspenders grant in case your project's defaults
-- differ. Safe to run even if it's already covered.
-- =============================================================================

grant select, insert, update, delete on table public.categories to service_role;
grant select, insert, update, delete on table public.transactions to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.get_summary(text) to service_role;
grant execute on function public.get_trends(int, bigint[]) to service_role;
