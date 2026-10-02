-- ===========================================================================
-- Expense Tracker — migration 0005
-- Transactional backup import.
--
-- Replaces the old client-side "clear every table, then re-add" import. The
-- whole clear + restore runs inside this single function, and therefore in a
-- single transaction: if any row fails to insert, nothing is deleted.
--
-- security invoker: RLS applies to the caller, so only an allowed signed-in
-- user can run it. Explicit grants keep anon out.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- ===========================================================================

create or replace function public.import_backup(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
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
