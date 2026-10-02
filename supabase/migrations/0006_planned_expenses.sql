-- ===========================================================================
-- Expense Tracker — migration 0006
-- Planned Expenses: a wishlist of things to buy. Each box holds a name and a
-- list of links (text + URL). Marking one purchased writes the final price into
-- the shared or an individual expense ledger and stamps the purchase details
-- here, so the box stays as a record of what it was and what it became.
--
-- Also replaces import_backup so JSON restores carry planned expenses too.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Same conventions as prior migrations: quoted camelCase columns matching
-- src/db/types.ts, ISO "YYYY-MM-DD" text dates, allowlist RLS, grants, realtime.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- New domain table (mirrors PlannedExpense in src/db/types.ts)
-- ---------------------------------------------------------------------------
create table if not exists public.planned_expenses (
  id bigint generated always as identity primary key,
  name text not null default '',
  links jsonb not null default '[]'::jsonb,
  purchased boolean not null default false,
  "purchasedDate" text,
  "finalValue" double precision,
  scope text,
  "paidBy" text
);

-- ---------------------------------------------------------------------------
-- Enable RLS and apply the same allowlist policy as every other table.
-- (public.is_allowed() was created in 0001.)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['planned_expenses']
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

-- Table grants (Data-API hardening means new tables get no auto-grants).
grant select, insert, update, delete on public.planned_expenses to authenticated;

-- Realtime: keep the live-update feel for the new table too.
alter publication supabase_realtime add table public.planned_expenses;

-- ---------------------------------------------------------------------------
-- Re-create import_backup (from 0005) so a restore also replaces planned
-- expenses. Missing/null purchase fields are tolerated: link-less drafts and
-- hand-made files restore cleanly.
-- ---------------------------------------------------------------------------
create or replace function public.import_backup(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.planned_expenses;
  delete from public.settlements;
  delete from public.investments;
  delete from public.bills;
  delete from public.personal_expenses;
  delete from public.income;
  delete from public.expenses;
  delete from public.config;

  insert into public.expenses (date, value, category, description, "paidBy")
  select date, value, category, description, "paidBy"
  from jsonb_to_recordset(coalesce(payload->'expenses', '[]'::jsonb))
    as x(date text, value double precision, category text, description text, "paidBy" text);

  insert into public.income (date, value, category, description, person)
  select date, value, category, description, person
  from jsonb_to_recordset(coalesce(payload->'income', '[]'::jsonb))
    as x(date text, value double precision, category text, description text, person text);

  insert into public.personal_expenses (date, value, category, description, person)
  select date, value, category, description, person
  from jsonb_to_recordset(coalesce(payload->'personalExpenses', '[]'::jsonb))
    as x(date text, value double precision, category text, description text, person text);

  insert into public.investments
    (date, value, category, description, action, scope, "pricePoint", units)
  select date, value, category, description, action, scope, "pricePoint", units
  from jsonb_to_recordset(coalesce(payload->'investments', '[]'::jsonb))
    as x(
      date text, value double precision, category text, description text,
      action text, scope text, "pricePoint" double precision, units double precision
    );

  insert into public.bills (date, value, category, description, scope, "paidBy")
  select date, value, category, description, scope, "paidBy"
  from jsonb_to_recordset(coalesce(payload->'bills', '[]'::jsonb))
    as x(
      date text, value double precision, category text, description text,
      scope text, "paidBy" text
    );

  insert into public.planned_expenses
    (name, links, purchased, "purchasedDate", "finalValue", scope, "paidBy")
  select name, coalesce(links, '[]'::jsonb), coalesce(purchased, false),
         "purchasedDate", "finalValue", scope, "paidBy"
  from jsonb_to_recordset(coalesce(payload->'plannedExpenses', '[]'::jsonb))
    as x(
      name text, links jsonb, purchased boolean,
      "purchasedDate" text, "finalValue" double precision, scope text, "paidBy" text
    );

  insert into public.settlements (date, "periodStart", "periodEnd", "from", "to", amount)
  select date, "periodStart", "periodEnd", "from", "to", amount
  from jsonb_to_recordset(coalesce(payload->'settlements', '[]'::jsonb))
    as x(
      date text, "periodStart" text, "periodEnd" text,
      "from" text, "to" text, amount double precision
    );

  insert into public.config
    (key, "p1Name", "p2Name", "incomeCategories", "expenseCategories",
     "billCategories", "investmentCategories", actions)
  select key, "p1Name", "p2Name", "incomeCategories", "expenseCategories",
         "billCategories", "investmentCategories", actions
  from jsonb_to_recordset(coalesce(payload->'config', '[]'::jsonb))
    as x(
      key text, "p1Name" text, "p2Name" text,
      "incomeCategories" text[], "expenseCategories" text[],
      "billCategories" text[], "investmentCategories" text[], actions text[]
    );
end;
$$;

revoke all on function public.import_backup(jsonb) from public;
grant execute on function public.import_backup(jsonb) to authenticated;
