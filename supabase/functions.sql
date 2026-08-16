-- =============================================================================
-- LEDGER — Supabase RPC functions
-- Run this after schema.sql, in the same SQL Editor.
--
-- These replace app.py's /api/summary and /api/trends routes. They're
-- declared without SECURITY DEFINER, so they run as the calling (signed-in)
-- user and respect the same Row Level Security policies as any other query —
-- no risk of one function accidentally seeing another user's rows.
-- =============================================================================

create or replace function get_summary(p_month text default null)
returns json
language plpgsql
security invoker
as $$
declare
  v_month  text;
  v_months text[];
  v_income numeric;
  v_expense numeric;
  v_by_category json;
  v_trend json;
begin
  select array_agg(distinct substr(occurred_at, 1, 7) order by substr(occurred_at, 1, 7) desc)
    into v_months
    from transactions;

  v_month := coalesce(p_month, v_months[1], to_char(now(), 'YYYY-MM'));

  select coalesce(sum(amount), 0) into v_income
    from transactions
    where type = 'income' and substr(occurred_at, 1, 7) = v_month;

  select coalesce(sum(amount), 0) into v_expense
    from transactions
    where type = 'expense' and substr(occurred_at, 1, 7) = v_month;

  select coalesce(json_agg(row_to_json(t)), '[]'::json) into v_by_category
  from (
    select c.id as category_id, c.name as category_name, c.color as category_color,
           coalesce(sum(tr.amount), 0) as total, count(tr.id) as count
    from transactions tr
    join categories c on tr.category_id = c.id
    where tr.type = 'expense' and substr(tr.occurred_at, 1, 7) = v_month
    group by c.id, c.name, c.color
    order by total desc
  ) t;

  select coalesce(json_agg(row_to_json(tr)), '[]'::json) into v_trend
  from (
    select substr(occurred_at, 1, 7) as ym,
           coalesce(sum(case when type = 'expense' then amount else 0 end), 0) as expense,
           coalesce(sum(case when type = 'income'  then amount else 0 end), 0) as income
    from transactions
    group by ym
    order by ym asc
  ) tr;

  return json_build_object(
    'month', v_month,
    'available_months', coalesce(to_json(v_months), '[]'::json),
    'total_income', v_income,
    'total_expense', v_expense,
    'net', v_income - v_expense,
    'by_category', v_by_category,
    'trend', v_trend
  );
end;
$$;

create or replace function get_trends(p_months int default 6, p_category_ids bigint[] default null)
returns json
language plpgsql
security invoker
as $$
declare
  v_months_n int := least(coalesce(p_months, 6), 24);
  v_months text[];
  v_by_category json;
  v_overall json;
  v_all_categories json;
begin
  select array_agg(to_char(date_trunc('month', now()) - (n || ' months')::interval, 'YYYY-MM') order by n desc)
    into v_months
    from generate_series(0, v_months_n - 1) as n;

  select coalesce(json_agg(row_to_json(r)), '[]'::json) into v_by_category
  from (
    select substr(tr.occurred_at, 1, 7) as ym, c.id as category_id, c.name as category_name,
           c.color as category_color, coalesce(sum(tr.amount), 0) as total
    from transactions tr
    join categories c on tr.category_id = c.id
    where tr.type = 'expense'
      and substr(tr.occurred_at, 1, 7) = any (v_months)
      and (p_category_ids is null or tr.category_id = any (p_category_ids))
    group by ym, c.id, c.name, c.color
    order by ym asc, total desc
  ) r;

  select coalesce(json_agg(row_to_json(o)), '[]'::json) into v_overall
  from (
    select substr(occurred_at, 1, 7) as ym,
           coalesce(sum(case when type = 'expense' then amount else 0 end), 0) as expense,
           coalesce(sum(case when type = 'income'  then amount else 0 end), 0) as income
    from transactions
    where substr(occurred_at, 1, 7) = any (v_months)
    group by ym
    order by ym asc
  ) o;

  select coalesce(json_agg(row_to_json(ac)), '[]'::json) into v_all_categories
  from (select id, name, color from categories order by name) ac;

  return json_build_object(
    'months', to_json(v_months),
    'by_category', v_by_category,
    'overall', v_overall,
    'all_categories', v_all_categories
  );
end;
$$;
