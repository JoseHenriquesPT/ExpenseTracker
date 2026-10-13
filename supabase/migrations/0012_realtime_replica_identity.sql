-- ===========================================================================
-- Expense Tracker — migration 0012
-- Realtime: replica identity full on the tables the app subscribes to.
--
-- The client now subscribes with filter=householdId=eq.<id>, so one household's
-- socket never wakes on another household's changes. Supabase only delivers
-- *filtered* DELETE events when the table's replica identity is full: with the
-- default, a DELETE's old record carries just the primary key, so the
-- householdId filter can't match and the partner's deletes would stop updating
-- live. This keeps the current pair's behaviour unchanged.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run
-- (after 0011).
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'config','expenses','income','investments','bills',
    'personal_expenses','settlements','planned_expenses'
  ]
  loop
    execute format('alter table public.%I replica identity full;', t);
  end loop;
end $$;
