-- ===========================================================================
-- Expense Tracker — migration 0017
-- Security hardening: identity, membership and lifecycle fixes.
--
-- What this changes (see supabase/tests/security_hardening_test.sql):
--   1. is_member()/current_household_id() match by email ONLY for rows with no
--      userId. A recycled or stale email on a bound membership row grants
--      nothing. (H-1)
--   2. claim_pending_membership() — called by AuthGate on sign-in — binds the
--      caller's userId to their pending email-only row exactly once; the first
--      claim on an ownerless (legacy) household becomes its owner.
--   3. household_members("userId") is globally unique: one household per
--      account, enforced by the database rather than a racy check. (M-1)
--   4. join_household()/merge_into_household() lock the target household row
--      before the capacity check, closing the two-invites race. (M-1)
--   5. dismantle_household() is owner-only and requires a bound (userId)
--      membership: an email-only member can never destroy the household. (H-2)
--   6. household_invites codes are server-generated through create_invite();
--      clients can no longer INSERT rows (weak codes, spoofed expiry/usedAt).
--      (L-1)
--   7. "householdId" loses its `default 1` on every domain table — a row that
--      forgets its household is now an error, not a silent write into the
--      legacy household. Money columns reject negatives; dates must be ISO.
--      (M-4)
--   8. The dead is_allowed() stub is dropped; anon loses TRUNCATE/REFERENCES/
--      TRIGGER (and everything else) on public tables and cannot execute
--      is_member(). (L-6)
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run
-- (after 0016). Money stays double precision for now (numeric migration is a
-- separate, deliberate change).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Identity: an email matches only a pending (userId-less) membership row.
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
          m."userId" is null
          and m.email is not null
          and lower(m.email) = lower(auth.jwt() ->> 'email')
        )
      )
  );
$$;

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
     or (
       m."userId" is null
       and m.email is not null
       and lower(m.email) = lower(auth.jwt() ->> 'email')
     )
  order by (m."userId" = auth.uid()) desc, m.id
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 2. Claim a pending membership: bind the caller's userId to their email-only
--    row, once. The first claim on a household that has no owner (the legacy
--    0008 backfill shape) becomes its owner, so the household stays
--    manageable (dismantle/upgrade are owner-only).
-- ---------------------------------------------------------------------------
create or replace function public.claim_pending_membership()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  hid bigint;
  pending_id bigint;
  pending_hid bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;

  select m."householdId" into hid
  from public.household_members m
  where m."userId" = auth.uid()
  order by m.id
  limit 1;
  if hid is not null then
    return hid;
  end if;

  select m.id, m."householdId" into pending_id, pending_hid
  from public.household_members m
  where m."userId" is null
    and m.email is not null
    and lower(m.email) = lower(auth.jwt() ->> 'email')
  order by m.id
  limit 1;
  if pending_id is null then
    return null;
  end if;

  update public.household_members m
  set "userId" = auth.uid(),
      role = case
        when not exists (
          select 1 from public.household_members o
          where o."householdId" = pending_hid and o.role = 'owner'
        ) then 'owner'
        else m.role
      end
  where m.id = pending_id;

  return pending_hid;
end;
$$;

revoke all on function public.claim_pending_membership() from public;
grant execute on function public.claim_pending_membership() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. One household per account, enforced by the database.
-- ---------------------------------------------------------------------------
create unique index if not exists household_members_user_unique
  on public.household_members ("userId")
  where "userId" is not null;

-- ---------------------------------------------------------------------------
-- 4. join/merge: lock the target household row so two concurrent joins through
--    different invites can't both pass the capacity check.
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

  select h.kind into hkind
  from public.households h
  where h.id = inv."householdId"
  for update;
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
-- 5. dismantle_household(): only the owner, through a bound membership.
--    Everything else (the per-member copy loop) is unchanged from 0016.
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
  member_ids uuid[];
  member_emails text[];
  member_roles text[];
  i int;
  new_hid bigint;
  month_start text := to_char(date_trunc('month', now()), 'YYYY-MM-DD');
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if old_hid is null then
    raise exception 'This account has no household.';
  end if;
  if not exists (
    select 1
    from public.household_members mo
    where mo."householdId" = old_hid
      and mo."userId" = auth.uid()
      and mo.role = 'owner'
  ) then
    raise exception 'Only the household owner can dismantle it.';
  end if;

  select * into c from public.config where "householdId" = old_hid limit 1;

  -- Snapshot who gets a copy, then drop the old memberships first: the new
  -- rows below would collide with them on the one-household unique index.
  select array_agg("userId" order by id),
         array_agg(email order by id),
         array_agg(role order by id)
  into member_ids, member_emails, member_roles
  from public.household_members
  where "householdId" = old_hid and "userId" is not null;

  delete from public.household_members where "householdId" = old_hid;

  for i in 1 .. coalesce(array_length(member_ids, 1), 0) loop
    insert into public.households (kind) values ('single')
    returning id into new_hid;

    insert into public.household_members ("householdId", "userId", email, role)
    values (new_hid, member_ids[i], member_emails[i], 'owner');

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
         case when member_roles[i] = 'owner' then c."p1Name" else c."p2Name" end,
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
-- 6. Invites: server-generated codes only. The table loses its INSERT policy
--    and grant; create_invite() is the single way to make one.
-- ---------------------------------------------------------------------------
drop policy if exists household_invites_insert on public.household_invites;
revoke insert on public.household_invites from authenticated;

create or replace function public.create_invite()
returns public.household_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  hid bigint := public.current_household_id();
  inv public.household_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if hid is null then
    raise exception 'This account has no household.';
  end if;
  if not exists (
    select 1 from public.household_members m
    where m."householdId" = hid and m."userId" = auth.uid()
  ) then
    raise exception 'You are not a member of this household.';
  end if;

  insert into public.household_invites ("householdId", "createdBy")
  values (hid, auth.uid())
  returning * into inv;

  return inv;
end;
$$;

revoke all on function public.create_invite() from public;
grant execute on function public.create_invite() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. No silent default household; non-negative money; ISO dates.
--    (NOT VALID + VALIDATE: new rows are checked immediately, existing rows
--    were verified clean before this migration.)
-- ---------------------------------------------------------------------------
alter table public.expenses alter column "householdId" drop default;
alter table public.income alter column "householdId" drop default;
alter table public.personal_expenses alter column "householdId" drop default;
alter table public.investments alter column "householdId" drop default;
alter table public.bills alter column "householdId" drop default;
alter table public.settlements alter column "householdId" drop default;
alter table public.planned_expenses alter column "householdId" drop default;
alter table public.config alter column "householdId" drop default;

alter table public.expenses add constraint expenses_value_check
  check (value >= 0 and value < 1000000000) not valid;
alter table public.expenses add constraint expenses_date_check
  check (date ~ '^\d{4}-\d{2}-\d{2}$') not valid;
alter table public.income add constraint income_value_check
  check (value >= 0 and value < 1000000000) not valid;
alter table public.income add constraint income_date_check
  check (date ~ '^\d{4}-\d{2}-\d{2}$') not valid;
alter table public.personal_expenses add constraint personal_expenses_value_check
  check (value >= 0 and value < 1000000000) not valid;
alter table public.personal_expenses add constraint personal_expenses_date_check
  check (date ~ '^\d{4}-\d{2}-\d{2}$') not valid;
alter table public.investments add constraint investments_value_check
  check (value >= 0 and value < 1000000000) not valid;
alter table public.investments add constraint investments_date_check
  check (date ~ '^\d{4}-\d{2}-\d{2}$') not valid;
alter table public.bills add constraint bills_value_check
  check (value >= 0 and value < 1000000000) not valid;
alter table public.bills add constraint bills_date_check
  check (date ~ '^\d{4}-\d{2}-\d{2}$') not valid;
alter table public.settlements add constraint settlements_amount_check
  check (amount >= 0 and amount < 1000000000) not valid;
alter table public.settlements add constraint settlements_date_check
  check (date ~ '^\d{4}-\d{2}-\d{2}$'
         and "periodStart" ~ '^\d{4}-\d{2}-\d{2}$'
         and "periodEnd" ~ '^\d{4}-\d{2}-\d{2}$') not valid;
alter table public.planned_expenses add constraint planned_expenses_final_value_check
  check ("finalValue" >= 0 and "finalValue" < 1000000000) not valid;
alter table public.planned_expenses add constraint planned_expenses_purchased_date_check
  check ("purchasedDate" ~ '^\d{4}-\d{2}-\d{2}$') not valid;

alter table public.expenses validate constraint expenses_value_check;
alter table public.expenses validate constraint expenses_date_check;
alter table public.income validate constraint income_value_check;
alter table public.income validate constraint income_date_check;
alter table public.personal_expenses validate constraint personal_expenses_value_check;
alter table public.personal_expenses validate constraint personal_expenses_date_check;
alter table public.investments validate constraint investments_value_check;
alter table public.investments validate constraint investments_date_check;
alter table public.bills validate constraint bills_value_check;
alter table public.bills validate constraint bills_date_check;
alter table public.settlements validate constraint settlements_amount_check;
alter table public.settlements validate constraint settlements_date_check;
alter table public.planned_expenses validate constraint planned_expenses_final_value_check;
alter table public.planned_expenses validate constraint planned_expenses_purchased_date_check;

-- ---------------------------------------------------------------------------
-- 8. Privilege hygiene: drop the dead stub, strip anon's table privileges
--    entirely (it only ever had TRUNCATE/REFERENCES/TRIGGER via the default
--    ACLs — RLS already blocked the rest), and remove the same three from
--    authenticated, which the app never uses.
-- ---------------------------------------------------------------------------
drop function if exists public.is_allowed();

revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from authenticated';
    execute 'revoke maintain on all tables in schema public from anon';
  end if;
exception when others then
  raise warning 'could not revoke MAINTAIN: %', sqlerrm;
end $$;

-- Future tables created by the migration role shouldn't hand these out either.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;
do $$
begin
  alter default privileges for role supabase_admin in schema public
    revoke truncate, references, trigger on tables from anon;
  alter default privileges for role supabase_admin in schema public
    revoke truncate, references, trigger on tables from authenticated;
exception when others then
  raise warning 'could not adjust supabase_admin default privileges: %', sqlerrm;
end $$;

-- is_member() is only needed by policies and the signed-in app.
revoke all on function public.is_member(bigint) from public, anon;
grant execute on function public.is_member(bigint) to authenticated;
