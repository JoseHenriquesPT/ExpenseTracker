-- ===========================================================================
-- Household lifecycle tests — migration 0015 safety gate.
--
-- Proves the two new RPCs behave:
--   * merge_into_household(code) — a one-member household merges into a
--     partner's couple household: membership moves, rows move with the joiner
--     retagged P1 -> P2, the old household/config vanish, the invite is used.
--   * dismantle_household() — every member gets their own copy of the
--     household (past months only; current-month rows are deleted), and the
--     original household is gone.
--
-- Run with:  npx supabase test db   (against the local stack only)
--
-- Fixtures: users exist only for auth; every household is created through the
-- real RPCs. Rows are written by the users themselves through RLS, except
-- where noted.
-- ===========================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(45);

create temp table ids (name text primary key, id bigint);
-- The assertions run as `authenticated`; let them read the fixture table.
grant select on ids to authenticated;

insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('aaaa1111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alice@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('bbbb2222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bob@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('cccc3333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'carol@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('dddd4444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dave@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('eeee5555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'eve@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('ffff6666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'frank@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('99999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'grace@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

-- ---------------------------------------------------------------------------
-- ALICE — couple household, invite 'MERGECODE', config with her name.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaa1111-1111-1111-1111-111111111111","email":"alice@test.local"}';

select lives_ok(
  $q$ select public.create_household('couple') $q$,
  'alice creates a couple household');
select lives_ok(
  $q$ insert into public.household_invites ("householdId", code)
      select id, 'MERGECODE' from public.current_household() $q$,
  'alice creates an invite for the merge');
select lives_ok(
  $q$ insert into public.config ("householdId", "p1Name", "p2Name")
      select id, 'Alice', 'Bob' from public.current_household() $q$,
  'alice writes her household config');

reset role;
insert into ids select 'alice', "householdId" from public.household_members
  where "userId" = 'aaaa1111-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------------------
-- BOB — his own couple household with a past expense, a current-month income
-- and his own config; then he merges into Alice with the code.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bbbb2222-2222-2222-2222-222222222222","email":"bob@test.local"}';

select lives_ok(
  $q$ select public.create_household('couple') $q$,
  'bob creates a couple household of his own');
select lives_ok(
  $q$ insert into public.expenses ("householdId", date, value, category, "paidBy")
      select id, to_char(now() - interval '2 months', 'YYYY-MM') || '-10', 10, 'Comida', 'P1'
      from public.current_household() $q$,
  'bob writes a past-month expense tagged P1');
select lives_ok(
  $q$ insert into public.income ("householdId", date, value, category, person)
      select id, to_char(now(), 'YYYY-MM') || '-15', 100, 'Emprego', 'P1'
      from public.current_household() $q$,
  'bob writes a current-month income tagged P1');
select lives_ok(
  $q$ insert into public.config ("householdId", "p1Name", "p2Name")
      select id, 'Bob', 'Person 2' from public.current_household() $q$,
  'bob writes his own config');

reset role;
insert into ids select 'bob_old', "householdId" from public.household_members
  where "userId" = 'bbbb2222-2222-2222-2222-222222222222';

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bbbb2222-2222-2222-2222-222222222222","email":"bob@test.local"}';

select lives_ok(
  $q$ select public.merge_into_household('MERGECODE') $q$,
  'bob merges into alice''s household with the code');
select is((select "memberCount" from public.current_household()), 2::bigint,
  'alice''s household now has two members');
select is(
  (select id from public.current_household()),
  (select id from ids where name = 'alice'),
  'bob is in alice''s household');
select is(
  (select count(*) from public.households where id = (select id from ids where name = 'bob_old')),
  0::bigint, 'bob''s old household is gone');
select is(
  (select count(*) from public.expenses where "householdId" = (select id from ids where name = 'alice')
     and value = 10 and "paidBy" = 'P2'),
  1::bigint, 'bob''s past expense moved and was retagged P2');
select is(
  (select count(*) from public.expenses where "householdId" = (select id from ids where name = 'bob_old')),
  0::bigint, 'no rows were left in the old household');
select is(
  (select person from public.income where "householdId" = (select id from ids where name = 'alice')),
  'P2', 'bob''s income moved and was retagged P2');
select is(
  (select count(*) from public.config where "householdId" = (select id from ids where name = 'bob_old')),
  0::bigint, 'bob''s old config is gone (the household keeps alice''s)');
select is(
  (select "usedBy" from public.household_invites where code = 'MERGECODE'),
  'bbbb2222-2222-2222-2222-222222222222'::uuid,
  'the merge code is recorded as used by bob');
select is(
  (select role from public.household_members
   where "userId" = 'bbbb2222-2222-2222-2222-222222222222'),
  'member', 'bob merged in as a member (not owner)');

reset role;

-- ---------------------------------------------------------------------------
-- Refusals — dave's household hosts the "target" codes.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"dddd4444-4444-4444-4444-444444444444","email":"dave@test.local"}';

select lives_ok(
  $q$ select public.create_household('couple') $q$,
  'dave creates a couple household');
select lives_ok(
  $q$ insert into public.household_invites ("householdId", code)
      select id, c.code from public.current_household(), (values ('DAVEMERGE'), ('DAVEFULL')) as c(code) $q$,
  'dave creates two invites');

reset role;

-- bob is in a two-member household: he cannot merge anywhere.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bbbb2222-2222-2222-2222-222222222222","email":"bob@test.local"}';

select throws_ok(
  $q$ select public.merge_into_household('DAVEMERGE') $q$,
  'P0001', null, 'a member of a two-person household cannot merge');

reset role;

-- carol has no household: merge refuses cleanly.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"cccc3333-3333-3333-3333-333333333333","email":"carol@test.local"}';

select throws_ok(
  $q$ select public.merge_into_household('DAVEMERGE') $q$,
  'P0001', null, 'an account without a household cannot merge');

reset role;

-- frank: unknown codes and single-kind targets are refused.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"ffff6666-6666-6666-6666-666666666666","email":"frank@test.local"}';

select lives_ok(
  $q$ select public.create_household('couple') $q$,
  'frank creates a couple household');
select throws_ok(
  $q$ select public.merge_into_household('NOSUCHCODE') $q$,
  'P0001', null, 'an unknown code is refused');

reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"99999999-9999-9999-9999-999999999999","email":"grace@test.local"}';

select lives_ok(
  $q$ select public.create_household('single') $q$,
  'grace creates a single household');

reset role;
insert into public.household_invites ("householdId", code)
select "householdId", 'GRACESINGLE' from public.household_members
  where "userId" = '99999999-9999-9999-9999-999999999999';

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"ffff6666-6666-6666-6666-666666666666","email":"frank@test.local"}';

select throws_ok(
  $q$ select public.merge_into_household('GRACESINGLE') $q$,
  'P0001', null, 'a single household cannot accept a merge');

reset role;

-- eve joins dave with DAVEFULL, making the household full; frank's merge is
-- refused on capacity.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"eeee5555-5555-5555-5555-555555555555","email":"eve@test.local"}';

select lives_ok(
  $q$ select public.join_household('DAVEFULL') $q$,
  'eve fills dave''s household through the normal join');

reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"ffff6666-6666-6666-6666-666666666666","email":"frank@test.local"}';

select throws_ok(
  $q$ select public.merge_into_household('DAVEMERGE') $q$,
  'P0001', null, 'a full household is refused');

reset role;

-- ---------------------------------------------------------------------------
-- DISMANTLE — alice's household holds both people plus rows; bob dismantles.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaa1111-1111-1111-1111-111111111111","email":"alice@test.local"}';

select lives_ok(
  $q$ insert into public.bills ("householdId", date, value, category, scope, "paidBy")
      select id, to_char(now() - interval '2 months', 'YYYY-MM') || '-05', 50, 'Serviços', 'Common', 'P1'
      from public.current_household() $q$,
  'alice writes a past-month bill');
select lives_ok(
  $q$ insert into public.expenses ("householdId", date, value, category, "paidBy")
      select id, to_char(now(), 'YYYY-MM') || '-20', 30, 'Compras', 'P1'
      from public.current_household() $q$,
  'alice writes a current-month expense');
select lives_ok(
  $q$ insert into public.planned_expenses ("householdId", name)
      select id, 'New couch' from public.current_household() $q$,
  'alice writes a planned expense');

reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bbbb2222-2222-2222-2222-222222222222","email":"bob@test.local"}';

select lives_ok(
  $q$ select public.dismantle_household() $q$,
  'any member can dismantle the household');

reset role;

select is(
  (select count(*) from public.households where id = (select id from ids where name = 'alice')),
  0::bigint, 'the original household is gone');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaa1111-1111-1111-1111-111111111111","email":"alice@test.local"}';

select is((select "memberCount" from public.current_household()), 1::bigint,
  'alice now has her own single-member household');
select isnt(
  (select id from public.current_household()),
  (select id from ids where name = 'alice'),
  'alice''s household is a new one');

reset role;
insert into ids select 'alice_new', "householdId" from public.household_members
  where "userId" = 'aaaa1111-1111-1111-1111-111111111111';

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bbbb2222-2222-2222-2222-222222222222","email":"bob@test.local"}';

select is((select "memberCount" from public.current_household()), 1::bigint,
  'bob now has his own single-member household');

reset role;
insert into ids select 'bob_new', "householdId" from public.household_members
  where "userId" = 'bbbb2222-2222-2222-2222-222222222222';

select is(
  (select count(*) from public.bills
   where "householdId" = (select id from ids where name = 'alice_new') and value = 50),
  1::bigint, 'alice''s copy keeps the past-month bill');
select is(
  (select count(*) from public.expenses
   where "householdId" = (select id from ids where name = 'alice_new') and value = 30),
  0::bigint, 'alice''s copy has no current-month expense');
select is(
  (select count(*) from public.expenses
   where "householdId" = (select id from ids where name = 'bob_new') and value = 10 and "paidBy" = 'P2'),
  1::bigint, 'bob''s copy keeps his past-month expense');
select is(
  (select count(*) from public.income
   where "householdId" = (select id from ids where name = 'bob_new') and value = 100),
  0::bigint, 'bob''s copy has no current-month income');
select is(
  (select count(*) from public.config
   where "householdId" in ((select id from ids where name = 'alice_new'),
                           (select id from ids where name = 'bob_new'))),
  2::bigint, 'both copies got a config row');
select is(
  (select "p1Name" from public.config where "householdId" = (select id from ids where name = 'alice_new')),
  'Alice', 'alice''s copy keeps her as P1');
select is(
  (select "p1Name" from public.config where "householdId" = (select id from ids where name = 'bob_new')),
  'Bob', 'bob''s copy names him as P1');
select is(
  (select count(*) from public.household_invites where "householdId" = (select id from ids where name = 'alice')),
  0::bigint, 'the old household''s invites are gone');
select is(
  (select count(*) from public.planned_expenses
   where "householdId" in ((select id from ids where name = 'alice_new'),
                           (select id from ids where name = 'bob_new'))),
  2::bigint, 'the planned expense was copied to both');

-- carol still has no household: dismantle refuses cleanly.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"cccc3333-3333-3333-3333-333333333333","email":"carol@test.local"}';

select throws_ok(
  $q$ select public.dismantle_household() $q$,
  'P0001', null, 'an account without a household cannot dismantle');

reset role;

select * from finish();
rollback;
