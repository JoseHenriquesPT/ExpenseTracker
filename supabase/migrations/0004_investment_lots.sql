-- ===========================================================================
-- Expense Tracker — migration 0004
-- Upgrade `investments` from a simple money row into a tracked trade:
--   * scope       : route the row to the Both (Common) or a person's tab,
--                   mirroring how bills.scope works.
--   * pricePoint  : price per unit at the time of the trade (nullable).
--   * units       : quantity acquired (Invested) or removed (Withdraw).
-- value ≈ pricePoint × units; the app derives whichever field is left blank.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Same conventions as prior migrations: quoted camelCase columns matching
-- src/db/types.ts. Existing rows get scope 'Common' and NULL price/units, so
-- they keep showing on the Both tab exactly as before.
-- ===========================================================================

alter table public.investments
  add column if not exists scope text not null default 'Common',
  add column if not exists "pricePoint" double precision,
  add column if not exists units double precision;

-- RLS, grants and realtime for `investments` were already set up in 0001; new
-- columns inherit the table's existing policies, so nothing else is required.
