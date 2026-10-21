-- ===========================================================================
-- Recurring income/bill series tests (migration 0018).
--
-- Covers the household gate on recurring_entries, the shape check, the
-- one-row-per-occurrence unique index and the "stop the series but keep past
-- rows" behaviour of the income/bills foreign keys.
--
-- Run with:  npx supabase test db
-- ===========================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- ---------------------------------------------------------------------------
-- Fixtures: Alice in H1, Carol in H2.
-- ---------------------------------------------------------------------------
insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'recurring-alice@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('77777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'recurring-carol@test.local', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

insert into public.households (id, name, kind) overriding system value
values (2, 'Recurring Beta', 'single');

insert into public.household_members ("householdId", "userId", role) values
  (1, '66666666-6666-6666-6666-666666666666', 'owner'),
  (2, '77777777-7777-7777-7777-777777777777', 'owner');

insert into public.recurring_entries
  (id, "householdId", kind, "startDate", value, category, person)
overriding system value
values
  (100, 1, 'income', '2026-01-31', 100, 'Salary', 'P1');

insert into public.recurring_entries
  (id, "householdId", kind, "startDate", value, category, scope, "paidBy")
overriding system value
values
  (200, 2, 'bill', '2026-01-15', 30, 'Phone', 'Common', 'P1');

insert into public.income ("householdId", date, value, category, person, "recurringId")
values (1, '2026-01-31', 100, 'Salary', 'P1', 100);

-- ---------------------------------------------------------------------------
-- Alice (H1) sees only her series, can create in H1 and nowhere else.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"66666666-6666-6666-6666-666666666666","email":"recurring-alice@test.local"}';

select is((select count(*) from public.recurring_entries), 1::bigint,
  'alice sees only her household series');
select is((select count(*) from public.recurring_entries where id = 200), 0::bigint,
  'alice cannot read household 2 series');
select is((select "recurringId" from public.income where "householdId" = 1), 100::bigint,
  'the income row keeps its series link');

select throws_ok(
  'insert into public.recurring_entries ("householdId", kind, "startDate", value, category, person)
   values (2, ''income'', ''2026-01-01'', 1, ''Salary'', ''P1'')',
  '42501', null,
  'alice cannot create a series in household 2');

select lives_ok(
  'insert into public.recurring_entries ("householdId", kind, "startDate", value, category, person)
   values (1, ''income'', ''2026-02-01'', 50, ''Freelance'', ''P2'')',
  'alice can create a series in her household');

select throws_ok(
  'insert into public.income ("householdId", date, value, category, person, "recurringId")
   values (1, ''2026-01-31'', 999, ''Salary'', ''P1'', 100)',
  '23505', null,
  'the same series cannot write the same month twice');

select throws_ok(
  'insert into public.recurring_entries ("householdId", kind, "startDate", value, category, person, scope)
   values (1, ''income'', ''2026-03-01'', 10, ''Salary'', ''P1'', ''Common'')',
  '23514', null,
  'an income series cannot carry a bill scope');

delete from public.recurring_entries where id = 100;
select is(
  (select "recurringId" from public.income where "householdId" = 1 and date = '2026-01-31'),
  null::bigint,
  'deleting a series keeps past rows and clears their link');

-- ---------------------------------------------------------------------------
-- Carol (H2) sees only the H2 bill series.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"77777777-7777-7777-7777-777777777777","email":"recurring-carol@test.local"}';

select is((select count(*) from public.recurring_entries), 1::bigint,
  'carol sees only her household series');
select is((select kind from public.recurring_entries), 'bill',
  'carol sees the bill series');

reset role;
select * from finish();
rollback;
