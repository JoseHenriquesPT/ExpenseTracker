-- ===========================================================================
-- Expense Tracker — migration 0008
-- Multi-tenant foundation: households + members + per-household rows.
--
-- Backward compatible by design:
--   * Existing rows are assigned to household #1.
--   * New rows default to household #1, so old clients (which don't send
--     "householdId") keep working during and after the rollout.
--   * The email allowlist stays as an outer gate for now (every policy checks
--     is_allowed() AND is_member()).
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run
-- (after 0001–0007).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Households and their members. Membership can be by signed-in user id
--    (once known) or by email (so an allowlisted person who hasn't signed in
--    yet still gets access the moment they do).
-- ---------------------------------------------------------------------------
create table if not exists public.households (
  id bigint generated always as identity primary key,
  name text not null default 'My household',
  -- single = one person, everything centres on them; couple = the P1/P2 model.
  kind text not null default 'couple' check (kind in ('single', 'couple')),
  "createdAt" timestamptz not null default now()
);

create table if not exists public.household_members (
  id bigint generated always as identity primary key,
  "householdId" bigint not null references public.households(id) on delete cascade,
  "userId" uuid references auth.users(id) on delete cascade,
  email text,
  role text not null default 'member',
  constraint household_members_identity check ("userId" is not null or email is not null),
  unique ("householdId", "userId"),
  unique ("householdId", email)
);

-- ---------------------------------------------------------------------------
-- 2. Membership check used by every RLS policy. security definer lets it read
--    household_members despite that table's RLS (same pattern as is_allowed).
-- ---------------------------------------------------------------------------
create or replace function public.is_member(p_household_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members m
    where m."householdId" = p_household_id
      and (
        m."userId" = auth.uid()
        or (
          m.email is not null
          and lower(m.email) = lower(auth.jwt() ->> 'email')
        )
      )
  );
$$;

grant execute on function public.is_member(bigint) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The existing single dataset becomes household #1, and every allowlisted
--    email becomes a member (by email, so people not yet signed in are covered).
-- ---------------------------------------------------------------------------
insert into public.households (id, name, kind)
overriding system value
values (1, 'Household', 'couple')
on conflict (id) do nothing;

-- Keep the identity sequence ahead of any explicitly inserted id.
select setval(
  pg_get_serial_sequence('public.households', 'id'),
  greatest(coalesce((select max(id) from public.households), 1), 1)
);

insert into public.household_members ("householdId", email)
select 1, a.email
from public.allowed_emails a
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Every domain table gets a "householdId". NOT NULL DEFAULT 1 means existing
--    rows are claimed by household #1 and old clients keep inserting cleanly.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'config','expenses','income','investments','bills',
    'personal_expenses','settlements','planned_expenses'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists "householdId" bigint not null '
      'default 1 references public.households(id) on delete cascade;',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. `config` was a global singleton (key UNIQUE). It is now one config row
--    per household.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'config_key_key' and conrelid = 'public.config'::regclass
  ) then
    alter table public.config drop constraint config_key_key;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'config_household_key' and conrelid = 'public.config'::regclass
  ) then
    alter table public.config
      add constraint config_household_key unique ("householdId", key);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. RLS for the two new tables. Clients get read-only access; membership is
--    managed from the SQL editor for now (Phase 2 adds the invite RPC).
-- ---------------------------------------------------------------------------
alter table public.households enable row level security;
alter table public.household_members enable row level security;

drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select using (public.is_member(id) and public.is_allowed());

drop policy if exists household_members_select on public.household_members;
create policy household_members_select on public.household_members
  for select using (public.is_member("householdId") and public.is_allowed());

grant select on public.households, public.household_members to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Replace every domain-table policy: the old "allowlisted email" gate is now
--    "allowlisted email AND member of the row's household".
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
      for select using (public.is_member("householdId") and public.is_allowed());
    $p$, t || '_select', t);

    execute format($p$
      create policy %I on public.%I
      for insert with check (public.is_member("householdId") and public.is_allowed());
    $p$, t || '_insert', t);

    execute format($p$
      create policy %I on public.%I
      for update using (public.is_member("householdId") and public.is_allowed())
      with check (public.is_member("householdId") and public.is_allowed());
    $p$, t || '_update', t);

    execute format($p$
      create policy %I on public.%I
      for delete using (public.is_member("householdId") and public.is_allowed());
    $p$, t || '_delete', t);
  end loop;
end $$;
