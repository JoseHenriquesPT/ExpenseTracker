-- ===========================================================================
-- Expense Tracker — migration 0003
-- Collapse the Bills payment register into the schedule: a "bill" is now a
-- single PAID record (registering one means it was paid). The dashboards
-- already counted `bill_payments`, so the new single `bills` table is rebuilt
-- FROM `bill_payments` to preserve those numbers; the old schedule rows (just
-- recurring definitions, never counted) are discarded.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- NOTE: this discards the old recurring-schedule rows and the recurrency/status
-- metadata. Export a JSON backup first if you want a copy.
-- ===========================================================================

-- 1. Drop the old schedule-shaped bills table (its rows were definitions, not
--    paid records, and were never summed by the dashboards). CASCADE clears its
--    RLS policies too; we recreate them below.
drop table if exists public.bills cascade;

-- 2. Recreate `bills` as a paid record: a dated money row + scope + who paid.
create table public.bills (
  id bigint generated always as identity primary key,
  date text not null,
  value double precision not null,
  category text not null,
  description text,
  scope text not null default 'Common',
  "paidBy" text not null default 'P1'
);

-- 3. Backfill from the payment register (the real paid history).
insert into public.bills (date, value, category, scope, "paidBy")
select date, value, category, scope, "paidBy"
from public.bill_payments;

-- 4. Drop the now-merged payment register (also removes it from realtime).
drop table if exists public.bill_payments cascade;

-- 5. Re-apply RLS + allowlist policies + grants + realtime for the new table.
alter table public.bills enable row level security;

create policy bills_select on public.bills
  for select using (public.is_allowed());
create policy bills_insert on public.bills
  for insert with check (public.is_allowed());
create policy bills_update on public.bills
  for update using (public.is_allowed()) with check (public.is_allowed());
create policy bills_delete on public.bills
  for delete using (public.is_allowed());

grant select, insert, update, delete on public.bills to authenticated;

alter publication supabase_realtime add table public.bills;

-- 6. Drop the now-unused recurring-schedule option lists from config.
alter table public.config
  drop column if exists recurrencies,
  drop column if exists statuses;
