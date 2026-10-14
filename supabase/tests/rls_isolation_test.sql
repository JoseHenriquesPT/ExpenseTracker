-- ===========================================================================
-- RLS isolation tests — the safety gate for the multi-tenant migration (0008).
--
-- Proves that a signed-in user can only ever read or write rows belonging to a
-- household they are a member of, across every domain table.
--
-- Run with:  npx supabase test db
-- (against the local stack; never touches production)
--
-- Fixtures: the migration already created household #1 (the existing dataset's
-- home), so H1 = 1. We add household #2. Five users, four memberships:
--   alice (H1, by userId), bob (H1), carol (H2, by userId),
--   frank (H1, by email only — the partner-who-hasn't-signed-in case),
--   dave (no household).
-- ===========================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as the database owner, bypassing RLS)
-- ---------------------------------------------------------------------------
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

insert into public.households (id, name, kind) overriding system value values
  (2, 'Beta', 'single');

insert into public.household_members ("householdId", "userId", email, role) values
  (1, '11111111-1111-1111-1111-111111111111', null, 'owner'),
  (1, '22222222-2222-2222-2222-222222222222', null, 'member'),
  (2, '33333333-3333-3333-3333-333333333333', null, 'owner'),
  (1, null, 'frank@test.local', 'member');

-- H1 rows (2 expenses; 1 of every other table). H2 rows (1 expense; 1 config).
insert into public.expenses ("householdId", date, value, category) values
  (1, '2026-01-01', 10, 'Comida'),
  (1, '2026-01-02', 20, 'Comida'),
  (2, '2026-01-03', 30, 'Comida');
insert into public.income ("householdId", date, value, category, person) values
  (1, '2026-01-01', 100, 'Emprego', 'P1');
insert into public.personal_expenses ("householdId", date, value, category, person) values
  (1, '2026-01-01', 5, 'Compras', 'P1');
insert into public.investments ("householdId", date, value, category, action, scope) values
  (1, '2026-01-01', 50, 'Trading 212', 'Invested', 'Common');
insert into public.bills ("householdId", date, value, category, scope, "paidBy") values
  (1, '2026-01-01', 15, 'Streaming', 'Common', 'P1');
insert into public.planned_expenses ("householdId", name) values
  (1, 'Switch');
insert into public.settlements ("householdId", date, "periodStart", "periodEnd", "from", "to", amount) values
  (1, '2026-02-01', '2026-01-01', '2026-01-31', 'P2', 'P1', 10);
insert into public.config ("householdId", key) values
  (1, 'config'),
  (2, 'config');

-- ---------------------------------------------------------------------------
-- ALICE — member of H1
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@test.local"}';

select is(public.is_member(1), true, 'alice is a member of household 1');
select is(public.is_member(2), false, 'alice is NOT a member of household 2');
select is((select count(*) from public.expenses), 2::bigint, 'alice sees only her 2 expenses');
select is((select count(*) from public.income), 1::bigint, 'alice sees only her 1 income row');
select is((select count(*) from public.personal_expenses), 1::bigint, 'alice sees only her 1 personal expense');
select is((select count(*) from public.investments), 1::bigint, 'alice sees only her 1 investment');
select is((select count(*) from public.bills), 1::bigint, 'alice sees only her 1 bill');
select is((select count(*) from public.planned_expenses), 1::bigint, 'alice sees only her 1 planned expense');
select is((select count(*) from public.settlements), 1::bigint, 'alice sees only her 1 settlement');
select is((select count(*) from public.config), 1::bigint, 'alice sees only her 1 config row');
select is((select count(*) from public.households), 1::bigint, 'alice sees only her own household row');

select throws_ok(
  'insert into public.expenses ("householdId", date, value, category) values (2, ''2026-03-01'', 1, ''X'')',
  '42501', null, 'alice cannot insert into household 2');

select results_eq(
  $q$ with u as (update public.expenses set value = 999 where "householdId" = 2 returning 1)
      select count(*)::bigint from u $q$,
  $q$ select 0::bigint $q$,
  'alice cannot update household 2 rows');

select results_eq(
  $q$ with d as (delete from public.expenses where "householdId" = 2 returning 1)
      select count(*)::bigint from d $q$,
  $q$ select 0::bigint $q$,
  'alice cannot delete household 2 rows');

select throws_ok(
  'insert into public.expenses (date, value, category) values (''2026-02-01'', 1, ''Test'')',
  '42501', null,
  'alice cannot insert without householdId (no default household since 0017)');
select is((select count(*) from public.expenses), 2::bigint, 'alice still sees her 2 expenses');
select results_eq(
  $q$ with u as (
        update public.expenses set description = 'updated'
        where id = (select min(id) from public.expenses) returning 1)
      select count(*)::bigint from u $q$,
  $q$ select 1::bigint $q$,
  'alice can update her own row');

reset role;

-- ---------------------------------------------------------------------------
-- CAROL — member of H2 only
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"33333333-3333-3333-3333-333333333333","email":"carol@test.local"}';

select is(public.is_member(2), true, 'carol is a member of household 2');
select is(public.is_member(1), false, 'carol is NOT a member of household 1');
select is((select count(*) from public.expenses), 1::bigint, 'carol sees only her 1 expense');
select is((select count(*) from public.income), 0::bigint, 'carol sees no household-1 income');
select is((select count(*) from public.personal_expenses), 0::bigint, 'carol sees no household-1 personal expenses');
select is((select count(*) from public.investments), 0::bigint, 'carol sees no household-1 investments');
select is((select count(*) from public.bills), 0::bigint, 'carol sees no household-1 bills');
select is((select count(*) from public.planned_expenses), 0::bigint, 'carol sees no household-1 planned expenses');
select is((select count(*) from public.settlements), 0::bigint, 'carol sees no household-1 settlements');
select is((select count(*) from public.config), 1::bigint, 'carol sees only her own config row');
select is((select count(*) from public.households), 1::bigint, 'carol sees only her own household row');

select throws_ok(
  'insert into public.expenses ("householdId", date, value, category) values (1, ''2026-03-01'', 1, ''X'')',
  '42501', null, 'carol cannot insert into household 1');

select results_eq(
  $q$ with u as (update public.expenses set value = 999 where "householdId" = 1 returning 1)
      select count(*)::bigint from u $q$,
  $q$ select 0::bigint $q$,
  'carol cannot update household 1 rows');

select results_eq(
  $q$ with d as (delete from public.expenses where "householdId" = 1 returning 1)
      select count(*)::bigint from d $q$,
  $q$ select 0::bigint $q$,
  'carol cannot delete household 1 rows');

reset role;

-- ---------------------------------------------------------------------------
-- DAVE — allowed email, but member of no household
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","email":"dave@test.local"}';

select is((select count(*) from public.expenses), 0::bigint, 'dave (no household) sees no expenses');
select is((select count(*) from public.households), 0::bigint, 'dave (no household) sees no households');
select throws_ok(
  'insert into public.expenses ("householdId", date, value, category) values (1, ''2026-03-01'', 1, ''X'')',
  '42501', null, 'dave cannot insert into household 1');

reset role;

-- ---------------------------------------------------------------------------
-- FRANK — member of H1 by email only (has not signed up yet)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"55555555-5555-5555-5555-555555555555","email":"frank@test.local"}';

select is(public.is_member(1), true, 'frank is a member of household 1 by email');
select is((select count(*) from public.income), 1::bigint, 'frank sees household 1 income');

reset role;

select * from finish();
rollback;
