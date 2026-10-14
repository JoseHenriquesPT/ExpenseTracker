-- ===========================================================================
-- Expense Tracker — migration 0013
-- Household onboarding: invites + the RPCs a fresh account uses to create or
-- join a household.
--
-- New surface:
--   * household_invites — single-use codes (14-day default expiry), visible
--     and manageable only by members of the household, live via realtime.
--   * current_household() — the caller's household as id/name/kind/memberCount.
--   * create_household(kind) — "just me" (single) or "me and a partner"
--     (couple); the caller must not already belong to a household.
--   * join_household(code) — couple households only, max two members,
--     single-use and expiry-checked, row-locked against concurrent joins.
--   * set_household_kind(kind) — owner-only single -> couple upgrade, so a
--     single household can start inviting later.
--
-- The allowlist stays as the outer beta gate (every policy still checks
-- is_allowed()); it is removed in the migration that opens signups.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run
-- (after 0012).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Invites. The code is server-generated (12 hex chars); join_household()
--    stamps usedBy/usedAt to make it single-use.
-- ---------------------------------------------------------------------------
create table if not exists public.household_invites (
  id bigint generated always as identity primary key,
  "householdId" bigint not null references public.households(id) on delete cascade,
  code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  "createdBy" uuid default auth.uid(),
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null default now() + interval '14 days',
  "usedBy" uuid,
  "usedAt" timestamptz
);

alter table public.household_invites enable row level security;

drop policy if exists household_invites_select on public.household_invites;
create policy household_invites_select on public.household_invites
  for select using (public.is_member("householdId") and public.is_allowed());

drop policy if exists household_invites_insert on public.household_invites;
create policy household_invites_insert on public.household_invites
  for insert with check (public.is_member("householdId") and public.is_allowed());

drop policy if exists household_invites_delete on public.household_invites;
create policy household_invites_delete on public.household_invites
  for delete using (public.is_member("householdId") and public.is_allowed());

grant select, insert, delete on public.household_invites to authenticated;

-- Live updates for the inviter's Settings screen; replica identity full so
-- filtered DELETE events still arrive (same reasoning as 0012).
alter table public.household_invites replica identity full;
alter publication supabase_realtime add table public.household_invites;

-- ---------------------------------------------------------------------------
-- 2. The caller's household, with the fields the client needs to decide
--    between single and couple UI. security definer (same pattern as
--    current_household_id, which this builds on).
-- ---------------------------------------------------------------------------
create or replace function public.current_household()
returns table (id bigint, name text, kind text, "memberCount" bigint)
language sql
stable
security definer
set search_path = public
as $$
  select h.id, h.name, h.kind,
         (select count(*) from public.household_members m where m."householdId" = h.id)
  from public.households h
  where h.id = public.current_household_id();
$$;

revoke all on function public.current_household() from public;
grant execute on function public.current_household() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Create a household for the signed-in account. "single" is one person
--    (everything centres on them); "couple" starts the P1/P2 model.
-- ---------------------------------------------------------------------------
create or replace function public.create_household(p_kind text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  hid bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if p_kind not in ('single', 'couple') then
    raise exception 'Unknown household kind: %.', p_kind;
  end if;
  if public.current_household_id() is not null then
    raise exception 'This account already belongs to a household.';
  end if;

  insert into public.households (kind) values (p_kind)
  returning households.id into hid;

  insert into public.household_members ("householdId", "userId", email, role)
  values (hid, auth.uid(), nullif(auth.jwt() ->> 'email', ''), 'owner');

  return hid;
end;
$$;

revoke all on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Join a household via an invite code. Only couple households accept new
--    members (max two); the invite row is locked so two concurrent joins of
--    the same code can't both pass the capacity check.
-- ---------------------------------------------------------------------------
create or replace function public.join_household(p_code text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.household_invites%rowtype;
  hkind text;
  members bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if public.current_household_id() is not null then
    raise exception 'This account already belongs to a household.';
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

  select h.kind into hkind from public.households h where h.id = inv."householdId";
  if hkind <> 'couple' then
    raise exception 'That household is for one person — ask them to upgrade it first.';
  end if;

  select count(*) into members
  from public.household_members m where m."householdId" = inv."householdId";
  if members >= 2 then
    raise exception 'That household is already full.';
  end if;

  insert into public.household_members ("householdId", "userId", email, role)
  values (inv."householdId", auth.uid(), nullif(auth.jwt() ->> 'email', ''), 'member');

  update public.household_invites
  set "usedBy" = auth.uid(), "usedAt" = now()
  where id = inv.id;

  return inv."householdId";
end;
$$;

revoke all on function public.join_household(text) from public;
grant execute on function public.join_household(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Owner-only kind change. Only single -> couple is allowed today: it is
--    the "we want to invite a partner later" upgrade.
-- ---------------------------------------------------------------------------
create or replace function public.set_household_kind(p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hid bigint := public.current_household_id();
begin
  if hid is null then
    raise exception 'This account has no household.';
  end if;
  if not exists (
    select 1 from public.household_members m
    where m."householdId" = hid and m."userId" = auth.uid() and m.role = 'owner'
  ) then
    raise exception 'Only the household owner can change this.';
  end if;
  if p_kind <> 'couple' then
    raise exception 'Only upgrading a single household to a couple one is supported.';
  end if;
  if (select h.kind from public.households h where h.id = hid) <> 'single' then
    raise exception 'This household is already a couple household.';
  end if;

  update public.households set kind = 'couple' where id = hid;
end;
$$;

revoke all on function public.set_household_kind(text) from public;
grant execute on function public.set_household_kind(text) to authenticated;
