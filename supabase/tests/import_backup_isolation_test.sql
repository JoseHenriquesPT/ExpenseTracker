-- ===========================================================================
-- import_backup isolation tests — migration 0009 safety gate.
--
-- A JSON restore must replace ONLY the caller's household. Before 0009 the
-- function hard-deleted everything it could see and re-inserted rows without a
-- household, which would dump one household's import into another's data.
--
-- Run with:  npx supabase test db   (against the local stack only)
-- ===========================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- ---------------------------------------------------------------------------
-- Fixtures: alice owns household 1, carol owns household 2, dave has none.
-- ---------------------------------------------------------------------------
insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alice@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'carol@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dave@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

insert into public.allowed_emails (email) values
  ('alice@test.local'), ('carol@test.local'), ('dave@test.local');

insert into public.households (id, name, kind) overriding system value values
  (2, 'Beta', 'single');

insert into public.household_members ("householdId", "userId", role) values
  (1, '11111111-1111-1111-1111-111111111111', 'owner'),
  (2, '33333333-3333-3333-3333-333333333333', 'owner');

insert into public.expenses ("householdId", date, value, category) values
  (1, '2026-01-01', 10, 'Comida'),
  (1, '2026-01-02', 20, 'Comida'),
  (2, '2026-01-03', 30, 'Comida');
insert into public.config ("householdId", key, "p1Name") values
  (1, 'config', 'Alice'),
  (2, 'config', 'Carol');

-- ---------------------------------------------------------------------------
-- DAVE — allowed, but member of no household: import must refuse.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","email":"dave@test.local"}';

select throws_ok(
  $q$ select public.import_backup('{"expenses":[{"date":"2026-05-01","value":7,"category":"X","paidBy":"P1"}]}'::jsonb) $q$,
  'P0001', null, 'dave (no household) cannot import');

reset role;

-- ---------------------------------------------------------------------------
-- ALICE — import replaces household 1 only.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@test.local"}';

select lives_ok(
  $q$ select public.import_backup('{
        "expenses":[{"date":"2026-05-01","value":7,"category":"X","paidBy":"P1"}],
        "config":[{"key":"config","p1Name":"AliceP1","p2Name":"AliceP2",
                   "incomeCategories":[],"expenseCategories":[],
                   "billCategories":[],"investmentCategories":[],"actions":[]}]
      }'::jsonb) $q$,
  'alice can import her backup');

reset role;

select is((select count(*) from public.expenses where "householdId" = 1), 1::bigint,
  'alice''s import replaced household 1 expenses');
select is((select count(*) from public.expenses where "householdId" = 2), 1::bigint,
  'household 2 expenses are untouched by alice''s import');
select is((select count(*) from public.config where "householdId" = 2), 1::bigint,
  'household 2 config is untouched by alice''s import');
select is((select "p1Name" from public.config where "householdId" = 1), 'AliceP1',
  'alice''s imported config landed in household 1');

-- ---------------------------------------------------------------------------
-- CAROL — her import must land in household 2, not household 1.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"33333333-3333-3333-3333-333333333333","email":"carol@test.local"}';

select lives_ok(
  $q$ select public.import_backup('{
        "expenses":[{"date":"2026-06-01","value":8,"category":"Y","paidBy":"P2"}]
      }'::jsonb) $q$,
  'carol can import her backup');

reset role;

select is((select count(*) from public.expenses where "householdId" = 2), 1::bigint,
  'carol''s import replaced household 2 expenses');
select is((select count(*) from public.expenses where "householdId" = 1), 1::bigint,
  'household 1 still holds alice''s import after carol''s import');
select is((select count(*) from public.expenses), 2::bigint,
  'no stray rows landed in any other household');

select * from finish();
rollback;
