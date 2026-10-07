-- ===========================================================================
-- Expense Tracker — migration 0010
-- Planned expense notes: a free-text field to draft thoughts about an item.
-- The card hides it while empty; it is kept once saved.
--
-- Adds `notes` to public.planned_expenses and teaches import_backup to carry
-- it. Function timing: when the households migrations (0008/0009) are in
-- place, their household-scoped import_backup (already notes-aware) is left
-- untouched; otherwise the single-tenant function is replaced here.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- ===========================================================================

alter table public.planned_expenses
  add column if not exists notes text not null default '';

do $migration$
begin
  if to_regclass('public.households') is null then
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
          (name, links, notes, purchased, "purchasedDate", "finalValue", scope, "paidBy")
        select name, coalesce(links, '[]'::jsonb), coalesce(notes, ''),
               coalesce(purchased, false), "purchasedDate", "finalValue", scope, "paidBy"
        from jsonb_to_recordset(coalesce(payload->'plannedExpenses', '[]'::jsonb))
          as x(
            name text, links jsonb, notes text, purchased boolean,
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
      $body$;
    $fn$;

    execute 'revoke all on function public.import_backup(jsonb) from public';
    execute 'grant execute on function public.import_backup(jsonb) to authenticated';
  end if;
end
$migration$;
