-- ===========================================================================
-- Expense Tracker — migration 0009
-- Household-scoped JSON restore.
--
-- 0007's import_backup deleted every row it could see and re-inserted without a
-- household, relying on the column default. Once a second household exists that
-- would either fail (RLS rejects the default household) or — worse — dump one
-- household's import into another's data. This version:
--   * refuses cleanly when the caller belongs to no household;
--   * deletes only the caller's household's rows;
--   * stamps every inserted row with the caller's household.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run
-- (after 0008).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The caller's household. security definer so it can read household_members
-- regardless of RLS; the first membership wins if there are ever several.
-- ---------------------------------------------------------------------------
create or replace function public.current_household_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select m."householdId"
  from public.household_members m
  where m."userId" = auth.uid()
     or (m.email is not null and lower(m.email) = lower(auth.jwt() ->> 'email'))
  order by m.id
  limit 1;
$$;

revoke all on function public.current_household_id() from public;
grant execute on function public.current_household_id() to authenticated;

-- ---------------------------------------------------------------------------
-- import_backup, scoped to the caller's household. security invoker: RLS still
-- applies to the caller, and the explicit householdId predicates make the
-- intent independent of policy details.
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
    ("householdId", name, links, notes, purchased, "purchasedDate", "finalValue", scope, "paidBy")
  select hid, name, coalesce(links, '[]'::jsonb), coalesce(notes, ''), coalesce(purchased, false),
         "purchasedDate", "finalValue", scope, "paidBy"
  from jsonb_to_recordset(coalesce(payload->'plannedExpenses', '[]'::jsonb))
    as x(
      name text, links jsonb, notes text, purchased boolean,
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
     "billCategories", "investmentCategories", actions)
  select hid, key, "p1Name", "p2Name", "incomeCategories", "expenseCategories",
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
