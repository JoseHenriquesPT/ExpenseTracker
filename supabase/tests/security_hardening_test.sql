-- ===========================================================================
-- Security hardening tests — migration 0017 safety gate.
--
-- Proves the identity and lifecycle fixes:
--   * is_member()/current_household_id() match by email ONLY for rows with no
--     userId — a recycled or stale email on a bound row grants nothing (H-1).
--   * claim_pending_membership() binds the caller's userId to their pending
--     email-only row exactly once, promoting to owner only when the household
--     has no owner (the legacy household-#1 shape).
--   * household_members("userId") is globally unique (no multi-membership).
--   * dismantle_household() is owner-only and requires a bound (userId) row —
--     email-only members cannot destroy the household (H-2).
--   * household_invites codes are server-generated: no direct INSERT (L-1).
--   * money is non-negative, dates are ISO, "householdId" has no default 1.
--   * is_allowed() is gone; anon holds no TRUNCATE/REFERENCES/TRIGGER and
--     cannot execute is_member().
--
-- Run with:  npx supabase test db   (against the local stack only)
-- ===========================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

create temp table ids (name text primary key, id bigint);
grant select on ids to authenticated;

insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('aaaa1111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alice@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('bbbb2222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'frank@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('cccc3333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'grace@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('dddd4444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dave@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('eeee5555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mallory@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('ffff6666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'hank@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner): alice's couple household A with pending
-- email-only members (frank, hank) and a STALE email on alice's bound row
-- (retired@test.local — mallory will hold that address). Grace's household L
-- is the legacy shape: email-only member, no owner at all.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaa1111-1111-1111-1111-111111111111","email":"alice@test.local"}';

select lives_ok(
  $q$ select public.create_household('couple') $q$,
  'fixture: alice creates household A');

reset role;

insert into ids select 'A', "householdId" from public.household_members
  where "userId" = 'aaaa1111-1111-1111-1111-111111111111';

-- Stale email on the bound row: alice changed address long ago.
update public.household_members
set email = 'retired@test.local'
where "userId" = 'aaaa1111-1111-1111-1111-111111111111';

insert into public.household_members ("householdId", "userId", email, role) values
  ((select id from ids where name = 'A'), null, 'frank@test.local', 'member'),
  ((select id from ids where name = 'A'), null, 'hank@test.local', 'member');

insert into public.households (kind) values ('single');
insert into ids select 'L', currval('public.households_id_seq');
insert into public.household_members ("householdId", "userId", email, role) values
  ((select id from ids where name = 'L'), null, 'grace@test.local', 'member');

-- ---------------------------------------------------------------------------
-- 1. Identity: email matches only unbound rows.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bbbb2222-2222-2222-2222-222222222222","email":"frank@test.local"}';

select is(public.is_member((select id from ids where name = 'A')), true,
  'a pending (email-only) member is a member');

select is(
  public.claim_pending_membership(),
  (select id from ids where name = 'A')::bigint,
  'claim binds the pending row and returns its household');

select ok(
  (select "userId" = 'bbbb2222-2222-2222-2222-222222222222'::uuid
   from public.household_members where email = 'frank@test.local'),
  'the pending row now has the caller''s userId');

select is(public.is_member((select id from ids where name = 'A')), true,
  'the claimed member is still a member');

select is(
  (select role from public.household_members where email = 'frank@test.local'),
  'member', 'claim keeps the member role when the household has an owner');

select is(
  (select count(*) from public.household_members
   where "userId" = 'bbbb2222-2222-2222-2222-222222222222'),
  1::bigint, 'claiming twice never creates a second membership');

select is(
  public.claim_pending_membership(),
  (select id from ids where name = 'A')::bigint,
  'a second claim returns the same household');

reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"eeee5555-5555-5555-5555-555555555555","email":"retired@test.local"}';

select is(public.is_member((select id from ids where name = 'A')), false,
  'a stale email on a bound row grants nothing (H-1)');

select is(public.current_household_id(), null::bigint,
  'the stale-email account resolves no household');

select is(public.claim_pending_membership(), null::bigint,
  'the stale-email account claims nothing');

reset role;

-- ---------------------------------------------------------------------------
-- 2. Legacy promotion: a pending member claims a household with no owner and
--    becomes its owner (the household-#1 backfill shape).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"cccc3333-3333-3333-3333-333333333333","email":"grace@test.local"}';

select is(public.is_member((select id from ids where name = 'L')), true,
  'the legacy pending member is a member');

select is(
  public.claim_pending_membership(),
  (select id from ids where name = 'L')::bigint,
  'the legacy pending member claims their household');

select is(
  (select role from public.household_members where email = 'grace@test.local'),
  'owner', 'the first claim on an ownerless household becomes the owner');

reset role;

-- ---------------------------------------------------------------------------
-- 3. Membership uniqueness: one household per userId.
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$ insert into public.household_members ("householdId", "userId", email, role)
      values ((select id from ids where name = 'L'),
              'bbbb2222-2222-2222-2222-222222222222', null, 'member') $q$,
  '23505', null, 'a second membership for the same userId is rejected');

-- ---------------------------------------------------------------------------
-- 4. Invites: codes are server-generated; no direct INSERT.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaa1111-1111-1111-1111-111111111111","email":"alice@test.local"}';

select throws_ok(
  $q$ insert into public.household_invites ("householdId", code)
      select id, 'WEAKCODE' from public.current_household() $q$,
  '42501', null, 'invite codes cannot be chosen by hand');

select lives_ok(
  $q$ select public.create_invite() $q$,
  'a member can create an invite through the RPC');

select ok(
  (select (public.create_invite()).code ~ '^[0-9a-f]{12}$'),
  'the generated code is 12 random hex characters');

reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"dddd4444-4444-4444-4444-444444444444","email":"dave@test.local"}';

select throws_ok(
  $q$ select public.create_invite() $q$,
  'P0001', null, 'an account with no household cannot create an invite');

reset role;

-- ---------------------------------------------------------------------------
-- 5. Constraints: non-negative money, ISO dates, no silent default household.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaa1111-1111-1111-1111-111111111111","email":"alice@test.local"}';

select throws_ok(
  $q$ insert into public.expenses ("householdId", date, value, category)
      values ((select id from ids where name = 'A'), '2026-01-01', -1, 'Comida') $q$,
  '23514', null, 'a negative expense value is rejected');

select throws_ok(
  $q$ insert into public.expenses ("householdId", date, value, category)
      values ((select id from ids where name = 'A'), 'banana', 1, 'Comida') $q$,
  '23514', null, 'a non-ISO expense date is rejected');

select throws_ok(
  $q$ insert into public.expenses (date, value, category)
      values ('2026-01-01', 1, 'Comida') $q$,
  '42501', null, 'an expense without a householdId is rejected (no default)');

select lives_ok(
  $q$ insert into public.expenses ("householdId", date, value, category)
      values ((select id from ids where name = 'A'), '2026-01-01', 0, 'Comida') $q$,
  'a zero-value expense is accepted');

reset role;

-- ---------------------------------------------------------------------------
-- 6. Grants: the dead stub is gone; anon holds no extra privileges.
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$ select public.is_allowed() $q$,
  '42883', null, 'the deprecated is_allowed() stub is dropped');

set local role anon;
select throws_ok(
  $q$ select public.is_member(1) $q$,
  '42501', null, 'anon cannot execute is_member()');
reset role;

select is(
  (select has_table_privilege('anon', 'public.expenses', 'TRUNCATE')), false,
  'anon cannot truncate public tables');
select is(
  (select has_table_privilege('authenticated', 'public.expenses', 'TRUNCATE')), false,
  'authenticated cannot truncate public tables');

-- ---------------------------------------------------------------------------
-- 7. Dismantle: owner-only, and only through a bound (userId) membership.
--    Failed attempts leave everything in place; alice tears A down last.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"ffff6666-6666-6666-6666-666666666666","email":"hank@test.local"}';

select throws_ok(
  $q$ select public.dismantle_household() $q$,
  'P0001', null, 'an email-only member cannot dismantle the household');

reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bbbb2222-2222-2222-2222-222222222222","email":"frank@test.local"}';

select throws_ok(
  $q$ select public.dismantle_household() $q$,
  'P0001', null, 'a member who is not the owner cannot dismantle the household');

reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"dddd4444-4444-4444-4444-444444444444","email":"dave@test.local"}';

select throws_ok(
  $q$ select public.dismantle_household() $q$,
  'P0001', null, 'an account without a household cannot dismantle');

reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaa1111-1111-1111-1111-111111111111","email":"alice@test.local"}';

select lives_ok(
  $q$ select public.dismantle_household() $q$,
  'the household owner can dismantle the household');

reset role;

select is(
  (select count(*) from public.households where id = (select id from ids where name = 'A')),
  0::bigint, 'the dismantled household is gone');

select * from finish();
rollback;
