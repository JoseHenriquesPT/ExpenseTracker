-- ===========================================================================
-- Expense Tracker — migration 0014
-- Open signups: drop the email allowlist gate.
--
-- Every policy becomes membership-only (is_member) and allowed_emails is
-- removed; is_allowed() remains only as a deprecated stub for clients deployed
-- before this change. Any signed-in account can now onboard itself a household
-- (0013) and use the app in isolation — this is the migration that opens the
-- doors.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run
-- (after 0013).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Domain tables: the 0008 policies, minus the is_allowed() gate.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'config','expenses','income','investments','bills',
    'personal_expenses','settlements','planned_expenses'
  ]
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format('drop policy if exists %I on public.%I;', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I;', t || '_update', t);
    execute format('drop policy if exists %I on public.%I;', t || '_delete', t);

    execute format($p$
      create policy %I on public.%I
      for select using (public.is_member("householdId"));
    $p$, t || '_select', t);

    execute format($p$
      create policy %I on public.%I
      for insert with check (public.is_member("householdId"));
    $p$, t || '_insert', t);

    execute format($p$
      create policy %I on public.%I
      for update using (public.is_member("householdId"))
      with check (public.is_member("householdId"));
    $p$, t || '_update', t);

    execute format($p$
      create policy %I on public.%I
      for delete using (public.is_member("householdId"));
    $p$, t || '_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Household tables.
-- ---------------------------------------------------------------------------
drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select using (public.is_member(id));

drop policy if exists household_members_select on public.household_members;
create policy household_members_select on public.household_members
  for select using (public.is_member("householdId"));

-- ---------------------------------------------------------------------------
-- 3. Invites.
-- ---------------------------------------------------------------------------
drop policy if exists household_invites_select on public.household_invites;
create policy household_invites_select on public.household_invites
  for select using (public.is_member("householdId"));

drop policy if exists household_invites_insert on public.household_invites;
create policy household_invites_insert on public.household_invites
  for insert with check (public.is_member("householdId"));

drop policy if exists household_invites_delete on public.household_invites;
create policy household_invites_delete on public.household_invites
  for delete using (public.is_member("householdId"));

-- ---------------------------------------------------------------------------
-- 4. Remove the gate. `allowed_emails` goes for good; `is_allowed()` stays for
--    one release as a deprecated stub, because clients deployed before this
--    change still ask "am I allowed?" on startup. The stub guards nothing —
--    policies no longer reference it. A later cleanup migration drops it once
--    the open-signup client is deployed everywhere.
-- ---------------------------------------------------------------------------
create or replace function public.is_allowed()
returns boolean
language sql
stable
as $$ select auth.uid() is not null; $$;

drop table if exists public.allowed_emails;
