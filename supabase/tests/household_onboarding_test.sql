-- ===========================================================================
-- Household onboarding tests — migration 0013 safety gate.
--
-- Proves the onboarding RPCs behave: create_household, join_household (single
-- use, expiry, capacity, single-kind refusal) and the owner-only upgrade, plus
-- that invites stay private to their household.
--
-- Run with:  npx supabase test db   (against the local stack only)
--
-- Fixtures: household #1 exists from migration 0008 (empty). Alice and bob
-- onboard themselves through the RPCs (not fixtures), so the test covers the
-- real signup path. Carol joins Bob; Dave joins Alice.
-- ===========================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alice@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bob@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'carol@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dave@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'frank@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

-- ---------------------------------------------------------------------------
-- ALICE — creates a single household through the RPC, manages an invite.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@test.local"}';

select is((select count(*) from public.current_household()), 0::bigint,
  'alice starts with no household');
select lives_ok(
  $q$ select public.create_household('single') $q$,
  'alice can create a single household');
select is((select kind from public.current_household()), 'single',
  'alice''s household is single');
select is((select "memberCount" from public.current_household()), 1::bigint,
  'alice''s household has one member');
select throws_ok(
  $q$ select public.create_household('couple') $q$,
  'P0001', null, 'alice cannot create a second household');
select lives_ok(
  $q$ select public.create_invite() $q$,
  'alice can create an invite for her household');
select lives_ok(
  $q$ delete from public.household_invites
      where "householdId" = (select id from public.current_household()) $q$,
  'alice can revoke her household''s invite');

reset role;

-- Known invite codes on alice's household, written as the database owner so the
-- join tests can address them directly.
insert into public.household_invites ("householdId", code, "expiresAt")
select (select "householdId" from public.household_members
        where "userId" = '11111111-1111-1111-1111-111111111111'),
       c.code, c.expires
from (values
  ('ALICESINGLE', now() + interval '7 days'),
  ('ALICEPAIR',   now() + interval '7 days'),
  ('ALICEFULL',   now() + interval '7 days'),
  ('ALICEEXPIRED', now() - interval '1 day')
) as c(code, expires);

-- ---------------------------------------------------------------------------
-- DAVE — cannot join a single household.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","email":"dave@test.local"}';

select is((select count(*) from public.current_household()), 0::bigint,
  'dave starts with no household');
select throws_ok(
  $q$ select public.join_household('ALICESINGLE') $q$,
  'P0001', null, 'dave cannot join a single household');

reset role;

-- ---------------------------------------------------------------------------
-- ALICE — upgrades to a couple household, so it can be joined.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@test.local"}';

select lives_ok(
  $q$ select public.set_household_kind('couple') $q$,
  'alice can upgrade her single household to a couple one');
select is((select kind from public.current_household()), 'couple',
  'alice''s household is now a couple one');

reset role;

-- ---------------------------------------------------------------------------
-- DAVE — joins Alice with the code; the invite becomes single-use.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","email":"dave@test.local"}';

select lives_ok(
  $q$ select public.join_household('ALICEPAIR') $q$,
  'dave joins alice''s household');
select is((select "memberCount" from public.current_household()), 2::bigint,
  'alice''s household now has two members');
select throws_ok(
  $q$ select public.join_household('ALICEFULL') $q$,
  'P0001', null, 'dave cannot join twice');

reset role;

-- ---------------------------------------------------------------------------
-- FRANK — allowed but houseless: every rejection path.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"55555555-5555-5555-5555-555555555555","email":"frank@test.local"}';

select throws_ok(
  $q$ select public.join_household('ALICEPAIR') $q$,
  'P0001', null, 'a used invite is rejected');
select throws_ok(
  $q$ select public.join_household('ALICEEXPIRED') $q$,
  'P0001', null, 'an expired invite is rejected');
select throws_ok(
  $q$ select public.join_household('NOSUCHCODE') $q$,
  'P0001', null, 'an unknown code is rejected');
select throws_ok(
  $q$ select public.join_household('ALICEFULL') $q$,
  'P0001', null, 'a full household is rejected');
select throws_ok(
  $q$ select public.create_household('trio') $q$,
  'P0001', null, 'an unknown household kind is rejected');

reset role;

-- ---------------------------------------------------------------------------
-- BOB — creates a couple household and an invite for Carol.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","email":"bob@test.local"}';

select lives_ok(
  $q$ select public.create_household('couple') $q$,
  'bob can create a couple household');
select throws_ok(
  $q$ insert into public.household_invites ("householdId", code)
      select id, 'BOBCODE' from public.current_household() $q$,
  '42501', null, 'members cannot choose invite codes by hand');
select lives_ok(
  $q$ select public.create_invite() $q$,
  'bob can create an invite through the RPC');

reset role;
-- Give bob's generated invite a known code so the join tests can address it.
update public.household_invites set code = 'BOBCODE'
where "householdId" = (select "householdId" from public.household_members
                       where "userId" = '22222222-2222-2222-2222-222222222222')
  and "usedAt" is null;

-- ---------------------------------------------------------------------------
-- CAROL — joins Bob; invites stay private, membership caps stand.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"33333333-3333-3333-3333-333333333333","email":"carol@test.local"}';

select is((select count(*) from public.household_invites), 0::bigint,
  'a houseless account sees no invites');
select lives_ok(
  $q$ select public.join_household('bobcode') $q$,
  'carol joins with a case-insensitive code');
select is((select kind from public.current_household()), 'couple',
  'carol is in bob''s couple household');
select is((select "memberCount" from public.current_household()), 2::bigint,
  'bob''s household has two members');
select is((select count(*) from public.household_invites), 1::bigint,
  'carol sees only her household''s invite');
select throws_ok(
  $q$ select public.create_household('single') $q$,
  'P0001', null, 'carol cannot create a second household');
select throws_ok(
  $q$ select public.set_household_kind('couple') $q$,
  'P0001', null, 'carol (member, not owner) cannot change the kind');

reset role;

-- ---------------------------------------------------------------------------
-- BOB — an owner cannot upgrade an already-couple household.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","email":"bob@test.local"}';

select throws_ok(
  $q$ select public.set_household_kind('couple') $q$,
  'P0001', null, 'bob cannot upgrade an already-couple household');

reset role;

-- ---------------------------------------------------------------------------
-- Final state, read as the database owner.
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from public.household_invites
   where "householdId" = (select "householdId" from public.household_members
                          where "userId" = '11111111-1111-1111-1111-111111111111')),
  4::bigint, 'alice''s household has her four invites');
select is(
  (select "usedBy" from public.household_invites where code = 'ALICEPAIR'),
  '44444444-4444-4444-4444-444444444444'::uuid,
  'dave is recorded as the user of the used invite');
select is(
  (select role from public.household_members
   where "userId" = '44444444-4444-4444-4444-444444444444'),
  'member', 'dave joined as a member (not owner)');
select is(
  (select role from public.household_members
   where "userId" = '11111111-1111-1111-1111-111111111111'),
  'owner', 'alice stayed the owner');

select * from finish();
rollback;
