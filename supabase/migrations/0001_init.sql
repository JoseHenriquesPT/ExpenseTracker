-- ===========================================================================
-- Expense Tracker — initial Supabase schema + Row-Level Security
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Column names match the TypeScript interfaces in src/db/types.ts exactly
-- (quoted camelCase), so the app needs no field remapping. Dates stay ISO
-- "YYYY-MM-DD" text — finance.ts relies on lexical date ordering.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Access allowlist: only these emails may read/write anything.
-- Managed here (not baked into policies) so you add people with one INSERT.
-- ---------------------------------------------------------------------------
create table if not exists public.allowed_emails (
  email text primary key
);
alter table public.allowed_emails enable row level security;
-- No policies on this table => unreachable via the anon/public API.
-- You manage it only from the SQL editor (service role), never the browser.

-- True when the signed-in user's email is on the allowlist.
-- security definer lets it read allowed_emails despite that table's RLS.
create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_emails
    where email = (auth.jwt() ->> 'email')
  );
$$;

-- Let the app ask "am I allowed?" so it can show a clean "not authorized"
-- screen instead of silently-empty data.
grant execute on function public.is_allowed() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Domain tables (mirror src/db/types.ts)
-- ---------------------------------------------------------------------------
create table if not exists public.config (
  id bigint generated always as identity primary key,
  key text unique not null default 'config',
  "p1Name" text not null default 'Person 1',
  "p2Name" text not null default 'Person 2',
  "incomeCategories" text[] not null default '{}',
  "expenseCategories" text[] not null default '{}',
  "billCategories" text[] not null default '{}',
  "investmentCategories" text[] not null default '{}',
  actions text[] not null default '{}',
  recurrencies text[] not null default '{}',
  statuses text[] not null default '{}'
);

create table if not exists public.expenses (
  id bigint generated always as identity primary key,
  date text not null,
  value double precision not null,
  category text not null,
  description text,
  "paidBy" text not null default 'P1'
);

create table if not exists public.income (
  id bigint generated always as identity primary key,
  date text not null,
  value double precision not null,
  category text not null,
  description text,
  person text not null default 'P1'
);

create table if not exists public.investments (
  id bigint generated always as identity primary key,
  date text not null,
  value double precision not null,
  category text not null,
  description text,
  action text not null
);

create table if not exists public.bills (
  id bigint generated always as identity primary key,
  "startDate" text not null,
  recurrency text not null,
  value double precision not null,
  category text not null,
  status text not null,
  scope text not null default 'Common',
  description text
);

create table if not exists public.bill_payments (
  id bigint generated always as identity primary key,
  date text not null,
  value double precision not null,
  category text not null,
  scope text not null default 'Common',
  "paidBy" text not null default 'P1'
);

-- ---------------------------------------------------------------------------
-- Enable RLS and apply the same allowlist policy to every domain table.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'config','expenses','income','investments','bills','bill_payments'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);

    execute format($p$
      create policy %I on public.%I
      for select using (public.is_allowed());
    $p$, t || '_select', t);

    execute format($p$
      create policy %I on public.%I
      for insert with check (public.is_allowed());
    $p$, t || '_insert', t);

    execute format($p$
      create policy %I on public.%I
      for update using (public.is_allowed()) with check (public.is_allowed());
    $p$, t || '_update', t);

    execute format($p$
      create policy %I on public.%I
      for delete using (public.is_allowed());
    $p$, t || '_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Table grants. Required because this project has Data-API hardening enabled
-- (default privileges for anon/authenticated were revoked), so new tables get
-- no auto-grants. RLS above still gates *which rows* each user sees; these
-- grants just let the authenticated role reach the tables at all. Note:
-- allowed_emails is deliberately NOT granted, so it stays unreachable.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  public.config,
  public.expenses,
  public.income,
  public.investments,
  public.bills,
  public.bill_payments
to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: let the app receive live updates (keeps the useLiveQuery feel).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.config,
  public.expenses,
  public.income,
  public.investments,
  public.bills,
  public.bill_payments;

-- ===========================================================================
-- FINALLY: add the two people who may use the app. EDIT THESE before running,
-- or run this line separately afterwards. Without it, nobody can read anything.
-- ===========================================================================
-- insert into public.allowed_emails (email) values
--   ('you@gmail.com'),
--   ('partner@gmail.com');
