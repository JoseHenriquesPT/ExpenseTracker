-- ===========================================================================
-- Expense Tracker — migration 0002
--   1. personal_expenses : Individual (non-shared) expenses, per person.
--   2. settlements        : recorded transfers that balance a period's pool.
--
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Same conventions as 0001: quoted camelCase columns matching src/db/types.ts,
-- ISO "YYYY-MM-DD" text dates, allowlist RLS, explicit grants + realtime.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- New domain tables (mirror src/db/types.ts)
-- ---------------------------------------------------------------------------
create table if not exists public.personal_expenses (
  id bigint generated always as identity primary key,
  date text not null,
  value double precision not null,
  category text not null,
  description text,
  person text not null default 'P1'
);

create table if not exists public.settlements (
  id bigint generated always as identity primary key,
  date text not null,
  "periodStart" text not null,
  "periodEnd" text not null,
  -- "from"/"to" are reserved words, so they must stay quoted everywhere.
  "from" text not null,
  "to" text not null,
  amount double precision not null
);

-- ---------------------------------------------------------------------------
-- Enable RLS and apply the same allowlist policy to the new tables.
-- (public.is_allowed() was created in 0001.)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['personal_expenses','settlements']
  loop
    execute format('alter table public.%I enable row level security;', t);

    execute format($p$
      create policy %I on public.%I
      for select using (public.is_allowed());
    $p$, t || '_select', t);

    execute format($p$
      create policy %I on public.%I
      for insert with check (public.is_allowed());
    $p$, t || '_insert', t);

    execute format($p$
      create policy %I on public.%I
      for update using (public.is_allowed()) with check (public.is_allowed());
    $p$, t || '_update', t);

    execute format($p$
      create policy %I on public.%I
      for delete using (public.is_allowed());
    $p$, t || '_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Table grants (Data-API hardening means new tables get no auto-grants).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  public.personal_expenses,
  public.settlements
to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: keep the live-update feel for the new tables too.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.personal_expenses,
  public.settlements;
