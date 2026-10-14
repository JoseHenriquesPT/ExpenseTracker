-- ===========================================================================
-- Expense Tracker — migration 0016
-- No-settlement mode + "Remove Paid By from expenses".
--
-- New surface:
--   * config."settlementMethod" now allows 'none' (Settings -> Settlement
--     methods -> "No settlement"): the Dashboard hides its settlement block.
--   * config."hidePaidBy" (boolean, default false) — with no settlement to
--     compute, the household can drop the "Paid by" picker from expense
--     entry; managed by the checkbox under "No settlement".
--   * dismantle_household() and import_backup() are replaced to carry the
--     new config column (absent values default, so pre-0016 backups still
--     import).
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run
-- (after 0015).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The paid-by flag. Defaults keep every existing household showing Paid By.
-- ---------------------------------------------------------------------------
alter table public.config
  add column if not exists "hidePaidBy" boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Widen the settlement-method check to allow 'none'. Replacing the
--    constraint keeps it named, so later migrations keep finding it.
-- ---------------------------------------------------------------------------
alter table public.config drop constraint if exists config_settlement_method_check;
alter table public.config add constraint config_settlement_method_check
  check ("settlementMethod" in ('proportional', 'custom', 'none'));

-- ---------------------------------------------------------------------------
-- 3. dismantle_household() — copy the new column with the rest of the config.
-- 4. import_backup() — round-trip the new column (absent -> false).
-- ---------------------------------------------------------------------------
create or replace function public.dismantle_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_hid bigint := public.current_household_id();
  c public.config%rowtype;
  m record;
  new_hid bigint;
  month_start text := to_char(date_trunc('month', now()), 'YYYY-MM-DD');
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if old_hid is null then
    raise exception 'This account has no household.';
  end if;
  if not public.is_member(old_hid) then
    raise exception 'You are not a member of this household.';
  end if;

  select * into c from public.config where "householdId" = old_hid limit 1;

  for m in
    select "userId", email, role
    from public.household_members
    where "householdId" = old_hid and "userId" is not null
    order by id
  loop
    insert into public.households (kind) values ('single')
    returning id into new_hid;

    insert into public.household_members ("householdId", "userId", email, role)
    values (new_hid, m."userId", m.email, 'owner');

    insert into public.expenses ("householdId", date, value, category, description, "paidBy", saved)
    select new_hid, date, value, category, description, "paidBy", saved
    from public.expenses
    where "householdId" = old_hid and date < month_start;

    insert into public.income ("householdId", date, value, category, description, person)
    select new_hid, date, value, category, description, person
    from public.income
    where "householdId" = old_hid and date < month_start;

    insert into public.personal_expenses ("householdId", date, value, category, description, person, saved)
    select new_hid, date, value, category, description, person, saved
    from public.personal_expenses
    where "householdId" = old_hid and date < month_start;

    insert into public.investments ("householdId", date, value, category, description, action, scope, "pricePoint", units)
    select new_hid, date, value, category, description, action, scope, "pricePoint", units
    from public.investments
    where "householdId" = old_hid and date < month_start;

    insert into public.bills ("householdId", date, value, category, description, scope, "paidBy")
    select new_hid, date, value, category, description, scope, "paidBy"
    from public.bills
    where "householdId" = old_hid and date < month_start;

    insert into public.settlements ("householdId", date, "periodStart", "periodEnd", "from", "to", amount)
    select new_hid, date, "periodStart", "periodEnd", "from", "to", amount
    from public.settlements
    where "householdId" = old_hid and date < month_start;

    insert into public.planned_expenses
      ("householdId", name, links, notes, tags, purchased, "purchasedDate", "finalValue", scope, "paidBy")
    select new_hid, name, links, notes, tags, purchased, "purchasedDate", "finalValue", scope, "paidBy"
    from public.planned_expenses
    where "householdId" = old_hid;

    if c.id is not null then
      insert into public.config
        ("householdId", key, "p1Name", "p2Name", "incomeCategories", "expenseCategories",
         "billCategories", "investmentCategories", "plannedTags", actions,
         "settlementMethod", "customShareP1", "hidePaidBy")
      values
        (new_hid, c.key,
         case when m.role = 'owner' then c."p1Name" else c."p2Name" end,
         c."p2Name",
         c."incomeCategories", c."expenseCategories", c."billCategories",
         c."investmentCategories", c."plannedTags", c.actions,
         c."settlementMethod", c."customShareP1", c."hidePaidBy");
    end if;
  end loop;

  delete from public.households where id = old_hid;
end;
$$;

revoke all on function public.dismantle_household() from public;
grant execute on function public.dismantle_household() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. import_backup, now carrying the settlement settings (absent values
--    default, so pre-0015 backup files still import).
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
