-- ===========================================================================
-- Expense Tracker — migration 0011
-- Planned expense tags: named "areas" a planned item can belong to, used to
-- filter the Planned Expenses wishlist. The names are free text copied from
-- Config.plannedTags (managed in Settings), so the config column is the master
-- list and each planned row keeps its own tags.
--
-- Adds `tags` to public.planned_expenses and `"plannedTags"` to public.config,
-- and teaches import_backup to carry both. Two function variants exist by now:
-- the household-scoped one from 0009 (when 0008+ are applied) and the
-- single-tenant one from 0010. Neither knows about tags yet, so this migration
-- replaces whichever one is in place.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- ===========================================================================

alter table public.planned_expenses
  add column if not exists tags text[] not null default '{}';

alter table public.config
  add column if not exists "plannedTags" text[] not null default '{}';

do $migration$
begin
  if to_regclass('public.households') is not null then

    -- -----------------------------------------------------------------------
    -- Household-scoped variant (0009 + tags). security invoker: RLS still
    -- applies to the caller; explicit householdId predicates make the intent
    -- independent of policy details.
    -- -----------------------------------------------------------------------
    execute $fn$
      create or replace function public.import_backup(payload jsonb)
      returns void
      language plpgsql
      security invoker
      set search_path = public
      as $body$
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
           "billCategories", "investmentCategories", "plannedTags", actions)
        select hid, key, "p1Name", "p2Name", "incomeCategories", "expenseCategories",
               "billCategories", "investmentCategories", coalesce("plannedTags", '{}'), actions
        from jsonb_to_recordset(coalesce(payload->'config', '[]'::jsonb))
          as x(
            key text, "p1Name" text, "p2Name" text,
            "incomeCategories" text[], "expenseCategories" text[],
            "billCategories" text[], "investmentCategories" text[],
            "plannedTags" text[], actions text[]
          );
      end;
      $body$;
    $fn$;

  else

    -- -----------------------------------------------------------------------
    -- Single-tenant variant (0010 + tags).
    -- -----------------------------------------------------------------------
    execute $fn$
      create or replace function public.import_backup(payload jsonb)
      returns void
      language plpgsql
      security invoker
      set search_path = public
      as $body$
      begin
        delete from public.planned_expenses;
        delete from public.settlements;
        delete from public.investments;
        delete from public.bills;
        delete from public.personal_expenses;
        delete from public.income;
        delete from public.expenses;
        delete from public.config;

        insert into public.expenses (date, value, category, description, "paidBy", saved)
        select date, value, category, description, "paidBy", coalesce(saved, false)
        from jsonb_to_recordset(coalesce(payload->'expenses', '[]'::jsonb))
          as x(date text, value double precision, category text, description text,
               "paidBy" text, saved boolean);

        insert into public.income (date, value, category, description, person)
        select date, value, category, description, person
        from jsonb_to_recordset(coalesce(payload->'income', '[]'::jsonb))
          as x(date text, value double precision, category text, description text, person text);

        insert into public.personal_expenses (date, value, category, description, person, saved)
        select date, value, category, description, person, coalesce(saved, false)
        from jsonb_to_recordset(coalesce(payload->'personalExpenses', '[]'::jsonb))
          as x(date text, value double precision, category text, description text,
               person text, saved boolean);

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
          (name, links, notes, tags, purchased, "purchasedDate", "finalValue", scope, "paidBy")
        select name, coalesce(links, '[]'::jsonb), coalesce(notes, ''), coalesce(tags, '{}'),
               coalesce(purchased, false), "purchasedDate", "finalValue", scope, "paidBy"
        from jsonb_to_recordset(coalesce(payload->'plannedExpenses', '[]'::jsonb))
          as x(
            name text, links jsonb, notes text, tags text[], purchased boolean,
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
           "billCategories", "investmentCategories", "plannedTags", actions)
        select key, "p1Name", "p2Name", "incomeCategories", "expenseCategories",
               "billCategories", "investmentCategories", coalesce("plannedTags", '{}'), actions
        from jsonb_to_recordset(coalesce(payload->'config', '[]'::jsonb))
          as x(
            key text, "p1Name" text, "p2Name" text,
            "incomeCategories" text[], "expenseCategories" text[],
            "billCategories" text[], "investmentCategories" text[],
            "plannedTags" text[], actions text[]
          );
      end;
      $body$;
    $fn$;

  end if;
end
$migration$;

revoke all on function public.import_backup(jsonb) from public;
grant execute on function public.import_backup(jsonb) to authenticated;
