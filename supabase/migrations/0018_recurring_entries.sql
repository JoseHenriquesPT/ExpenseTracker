-- ===========================================================================
-- Expense Tracker — migration 0018
-- Recurring monthly income and bills.
--
-- A recurring item is a series row here plus one ordinary `income` or `bills`
-- row per month. The app materializes the months (real rows), so every existing
-- dashboard, ledger, history and backup path keeps working unchanged:
--   * `recurring_entries` holds the template (amount, category, person/scope)
--     and `generatedThrough`, the last month already written.
--   * `income."recurringId"` / `bills."recurringId"` link generated rows back to
--     their series. Rows stay when the series is deleted (set null), so past
--     months are never lost.
--   * The partial unique indexes stop two devices/browsers from inserting the
--     same occurrence twice during a top-up.
--
-- Deleting one occurrence removes only that month; the generator never
-- recreates a month at or before `generatedThrough`. Stopping a series deletes
-- the series and every future occurrence.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run
-- (after 0017).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Series definitions.
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_entries (
  id bigint generated always as identity primary key,
  "householdId" bigint not null references public.households(id) on delete cascade,
  kind text not null check (kind in ('income', 'bill')),
  "startDate" text not null,
  value double precision not null,
  category text not null,
  description text,
  person text,
  scope text,
  "paidBy" text,
  "generatedThrough" text,
  "createdAt" timestamptz not null default now(),
  constraint recurring_entries_value_check check (value >= 0 and value < 1000000000),
  constraint recurring_entries_start_date_check
    check ("startDate" ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint recurring_entries_generated_through_check
    check ("generatedThrough" is null or "generatedThrough" ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint recurring_entries_shape_check check (
    (kind = 'income' and person is not null and person in ('P1', 'P2')
      and scope is null and "paidBy" is null)
    or
    (kind = 'bill' and person is null and scope is not null
      and scope in ('P1', 'P2', 'Common')
      and "paidBy" is not null and "paidBy" in ('P1', 'P2'))
  )
);

alter table public.income
  add column if not exists "recurringId" bigint
    references public.recurring_entries(id) on delete set null;

alter table public.bills
  add column if not exists "recurringId" bigint
    references public.recurring_entries(id) on delete set null;

-- One row per series per date. A top-up racing another device hits this index
-- instead of writing the month twice; the app upserts with ignore-duplicates.
-- (Null series ids are distinct in Postgres, so one-off rows never clash.)
create unique index if not exists income_recurring_occurrence_unique
  on public.income ("recurringId", date);

create unique index if not exists bills_recurring_occurrence_unique
  on public.bills ("recurringId", date);

-- ---------------------------------------------------------------------------
-- 2. RLS, grants and realtime — same household-membership gate as every table.
-- ---------------------------------------------------------------------------
alter table public.recurring_entries enable row level security;

drop policy if exists recurring_entries_select on public.recurring_entries;
create policy recurring_entries_select on public.recurring_entries
  for select using (public.is_member("householdId"));

drop policy if exists recurring_entries_insert on public.recurring_entries;
create policy recurring_entries_insert on public.recurring_entries
  for insert with check (public.is_member("householdId"));

drop policy if exists recurring_entries_update on public.recurring_entries;
create policy recurring_entries_update on public.recurring_entries
  for update using (public.is_member("householdId"))
  with check (public.is_member("householdId"));

drop policy if exists recurring_entries_delete on public.recurring_entries;
create policy recurring_entries_delete on public.recurring_entries
  for delete using (public.is_member("householdId"));

grant select, insert, update, delete on public.recurring_entries to authenticated;

alter table public.recurring_entries replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'recurring_entries'
  ) then
    alter publication supabase_realtime add table public.recurring_entries;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. merge_into_household() (latest in 0017) moves the series with the rows so
--    a joiner's recurring income/bills keep generating in their new household.
-- ---------------------------------------------------------------------------
create or replace function public.merge_into_household(p_code text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.household_invites%rowtype;
  old_hid bigint := public.current_household_id();
  tgt bigint;
  tkind text;
  members bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if old_hid is null then
    raise exception 'This account has no household yet.';
  end if;

  select i.* into inv
  from public.household_invites i
  where lower(i.code) = lower(trim(p_code))
  for update;

  if inv.id is null then
    raise exception 'That invite code is not valid.';
  end if;
  if inv."usedAt" is not null then
    raise exception 'That invite has already been used.';
  end if;
  if inv."expiresAt" < now() then
    raise exception 'That invite has expired.';
  end if;

  tgt := inv."householdId";
  if tgt = old_hid then
    raise exception 'Both accounts are already in the same household.';
  end if;

  select h.kind into tkind
  from public.households h
  where h.id = tgt
  for update;
  if tkind <> 'couple' then
    raise exception 'That household is for one person — ask them to upgrade it first.';
  end if;

  select count(*) into members
  from public.household_members m where m."householdId" = tgt;
  if members >= 2 then
    raise exception 'That household is already full.';
  end if;

  select count(*) into members
  from public.household_members m where m."householdId" = old_hid;
  if members > 1 then
    raise exception 'Your household has another member — dismantle it before joining another.';
  end if;

  update public.expenses
  set "householdId" = tgt,
      "paidBy" = case when "paidBy" = 'P1' then 'P2' else "paidBy" end
  where "householdId" = old_hid;

  update public.income
  set "householdId" = tgt,
      person = case when person = 'P1' then 'P2' else person end
  where "householdId" = old_hid;

  update public.personal_expenses
  set "householdId" = tgt,
      person = case when person = 'P1' then 'P2' else person end
  where "householdId" = old_hid;

  update public.investments
  set "householdId" = tgt,
      scope = case when scope = 'P1' then 'P2' else scope end
  where "householdId" = old_hid;

  update public.bills
  set "householdId" = tgt,
      scope = case when scope = 'P1' then 'P2' else scope end,
      "paidBy" = case when "paidBy" = 'P1' then 'P2' else "paidBy" end
  where "householdId" = old_hid;

  update public.recurring_entries
  set "householdId" = tgt,
      person = case when person = 'P1' then 'P2' else person end,
      scope = case when scope = 'P1' then 'P2' else scope end,
      "paidBy" = case when "paidBy" = 'P1' then 'P2' else "paidBy" end
  where "householdId" = old_hid;

  update public.settlements
  set "householdId" = tgt,
      "from" = case when "from" = 'P1' then 'P2' else "from" end,
      "to" = case when "to" = 'P1' then 'P2' else "to" end
  where "householdId" = old_hid;

  update public.planned_expenses
  set "householdId" = tgt,
      scope = case when scope = 'P1' then 'P2' else scope end,
      "paidBy" = case when "paidBy" = 'P1' then 'P2' else "paidBy" end
  where "householdId" = old_hid;

  -- The target keeps its config; the joiner's old one has nowhere to live.
  -- The old household goes first: its cascade removes the joiner's previous
  -- membership row, so the insert below can't collide with the one-household
  -- unique index on "userId" (migration 0017).
  delete from public.config where "householdId" = old_hid;
  delete from public.households where id = old_hid;

  insert into public.household_members ("householdId", "userId", email, role)
  values (tgt, auth.uid(), nullif(auth.jwt() ->> 'email', ''), 'member');

  update public.household_invites
  set "usedBy" = auth.uid(), "usedAt" = now()
  where id = inv.id;

  return tgt;
end;
$$;

revoke all on function public.merge_into_household(text) from public;
grant execute on function public.merge_into_household(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. import_backup() (latest in 0016) also clears recurring series, so a
--    restore replaces recurring state instead of letting old series keep
--    generating into the imported data. Restored rows are one-off rows.
-- ---------------------------------------------------------------------------
create or replace function public.import_backup(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  hid bigint := public.current_household_id();
begin
  if hid is null then
    raise exception 'This account has no household — nothing to import into.';
  end if;

  delete from public.recurring_entries where "householdId" = hid;
  delete from public.planned_expenses where "householdId" = hid;
  delete from public.settlements where "householdId" = hid;
  delete from public.investments where "householdId" = hid;
  delete from public.bills where "householdId" = hid;
  delete from public.personal_expenses where "householdId" = hid;
  delete from public.income where "householdId" = hid;
  delete from public.expenses where "householdId" = hid;
  delete from public.config where "householdId" = hid;

  insert into public.expenses ("householdId", date, value, category, description, "paidBy", saved)
  select hid, date, value, category, description, "paidBy", coalesce(saved, false)
  from jsonb_to_recordset(coalesce(payload->'expenses', '[]'::jsonb))
    as x(date text, value double precision, category text, description text,
         "paidBy" text, saved boolean);

  insert into public.income ("householdId", date, value, category, description, person)
  select hid, date, value, category, description, person
  from jsonb_to_recordset(coalesce(payload->'income', '[]'::jsonb))
    as x(date text, value double precision, category text, description text, person text);

  insert into public.personal_expenses ("householdId", date, value, category, description, person, saved)
  select hid, date, value, category, description, person, coalesce(saved, false)
  from jsonb_to_recordset(coalesce(payload->'personalExpenses', '[]'::jsonb))
    as x(date text, value double precision, category text, description text,
         person text, saved boolean);

  insert into public.investments
    ("householdId", date, value, category, description, action, scope, "pricePoint", units)
  select hid, date, value, category, description, action, scope, "pricePoint", units
  from jsonb_to_recordset(coalesce(payload->'investments', '[]'::jsonb))
    as x(
      date text, value double precision, category text, description text,
      action text, scope text, "pricePoint" double precision, units double precision
    );

  insert into public.bills ("householdId", date, value, category, description, scope, "paidBy")
  select hid, date, value, category, description, scope, "paidBy"
  from jsonb_to_recordset(coalesce(payload->'bills', '[]'::jsonb))
    as x(
      date text, value double precision, category text, description text,
      scope text, "paidBy" text
    );

  insert into public.planned_expenses
    ("householdId", name, links, notes, tags, purchased, "purchasedDate", "finalValue", scope, "paidBy")
  select hid, name, coalesce(links, '[]'::jsonb), coalesce(notes, ''), coalesce(tags, '{}'),
         coalesce(purchased, false), "purchasedDate", "finalValue", scope, "paidBy"
  from jsonb_to_recordset(coalesce(payload->'plannedExpenses', '[]'::jsonb))
    as x(
      name text, links jsonb, notes text, tags text[], purchased boolean,
      "purchasedDate" text, "finalValue" double precision, scope text, "paidBy" text
    );

  insert into public.settlements ("householdId", date, "periodStart", "periodEnd", "from", "to", amount)
  select hid, date, "periodStart", "periodEnd", "from", "to", amount
  from jsonb_to_recordset(coalesce(payload->'settlements', '[]'::jsonb))
    as x(
      date text, "periodStart" text, "periodEnd" text,
      "from" text, "to" text, amount double precision
    );

  insert into public.config
    ("householdId", key, "p1Name", "p2Name", "incomeCategories", "expenseCategories",
     "billCategories", "investmentCategories", "plannedTags", actions,
     "settlementMethod", "customShareP1", "hidePaidBy")
  select hid, key, "p1Name", "p2Name", "incomeCategories", "expenseCategories",
         "billCategories", "investmentCategories", coalesce("plannedTags", '{}'), actions,
         coalesce("settlementMethod", 'proportional'), coalesce("customShareP1", 50), coalesce("hidePaidBy", false)
  from jsonb_to_recordset(coalesce(payload->'config', '[]'::jsonb))
    as x(
      key text, "p1Name" text, "p2Name" text,
      "incomeCategories" text[], "expenseCategories" text[],
      "billCategories" text[], "investmentCategories" text[],
      "plannedTags" text[], actions text[],
      "settlementMethod" text, "customShareP1" double precision, "hidePaidBy" boolean
    );
end;
$$;

revoke all on function public.import_backup(jsonb) from public;
grant execute on function public.import_backup(jsonb) to authenticated;
