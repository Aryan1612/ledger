-- =============================================================================
-- LEDGER — Supabase schema
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Mirrors the SQLite schema from the desktop app, plus a user_id column and
-- Row Level Security so each row is only ever visible to the account that
-- created it. Since this is a single-user app, that's really just a guardrail
-- against the anon key being public in the browser (normal for Supabase).
-- =============================================================================

create table if not exists categories (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  color       text not null default '#6366f1',
  created_at  text not null default now()::text,
  unique (user_id, name)
);

create table if not exists transactions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type          text not null check (type in ('expense', 'income')),
  amount        numeric not null check (amount > 0),
  category_id   bigint references categories (id) on delete set null,
  note          text,
  occurred_at   text not null,
  created_at    text not null default now()::text
);

create index if not exists transactions_occurred_at_idx on transactions (occurred_at);
create index if not exists transactions_user_id_idx on transactions (user_id);
create index if not exists categories_user_id_idx on categories (user_id);

alter table categories enable row level security;
alter table transactions enable row level security;

-- Each policy covers select/insert/update/delete: a row is only visible to,
-- and only writable by, the user it belongs to.
create policy "categories_owner_only" on categories
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "transactions_owner_only" on transactions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
