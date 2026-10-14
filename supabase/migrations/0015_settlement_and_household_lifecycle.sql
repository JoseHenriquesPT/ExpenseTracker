-- ===========================================================================
-- Expense Tracker — migration 0015
-- Settlement methods + household lifecycle (merge in / dismantle).
--
-- New surface:
--   * config."settlementMethod" ('proportional' | 'custom') and
--     config."customShareP1" (0–100) — the household's chosen way to divide
--     the shared pool; managed on Settings -> Settlement methods.
--   * merge_into_household(code) — a one-member household enters a partner's
--     invite code and joins their couple household: rows move over with the
--     joiner's P1 retagged P2 (the inviter stays P1), the old household and
--     its config are removed, the invite is marked used.
--   * dismantle_household() — any member can break the household up. Every
--     member gets a copy of the past months' data in their own new single
--     household; current-month rows are deleted. The original household,
--     its config, invites and memberships are removed.
--   * household_members joins the realtime publication so the other device
--     notices a partner joining (the Settings box disappears) or a dismantle
--     without a reload.
--   * import_backup() is replaced to carry the two new config columns.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run
-- (after 0014).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Settlement settings on config. Defaults keep every existing household on
--    today's income-proportional behaviour.
-- ---------------------------------------------------------------------------
alter table public.config
  add column if not exists "settlementMethod" text not null default 'proportional',
  add column if not exists "customShareP1" double precision not null default 50;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'config_settlement_method_check'
      and conrelid = 'public.config'::regclass
  ) then
    alter table public.config add constraint config_settlement_method_check
      check ("settlementMethod" in ('proportional', 'custom'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'config_custom_share_check'
      and conrelid = 'public.config'::regclass
  ) then
    alter table public.config add constraint config_custom_share_check
      check ("customShareP1" >= 0 and "customShareP1" <= 100);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Live membership: both devices need to see a partner join (so the
--    Settings household box disappears) and a dismantle. replica identity full
--    so filtered DELETE events still arrive (same reasoning as 0012).
-- ---------------------------------------------------------------------------
alter table public.household_members replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'household_members'
  ) then
    alter publication supabase_realtime add table public.household_members;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Merge the caller's (one-member) household into a couple household using
--    an invite code. Same validation as join_household(), plus: the caller
--    must be alone in their household, and every row moves over with the
--    joiner's "P1" retagged "P2" — the inviter stays P1. Rows tagged "P2" in
--    the old household are left as P2 (they become the joiner's own rows).
-- ---------------------------------------------------------------------------
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

  select h.kind into tkind from public.households h where h.id = tgt;
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

  insert into public.household_members ("householdId", "userId", email, role)
  values (tgt, auth.uid(), nullif(auth.jwt() ->> 'email', ''), 'member');

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
  delete from public.config where "householdId" = old_hid;
  delete from public.households where id = old_hid;

  update public.household_invites
  set "usedBy" = auth.uid(), "usedAt" = now()
  where id = inv.id;

  return tgt;
end;
$$;

revoke all on function public.merge_into_household(text) from public;
grant execute on function public.merge_into_household(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Dismantle: every member keeps a copy of the past months' data in a new
--    single household; current-month rows (date >= the 1st) are deleted with
--    the original. The member who is P1 keeps the P1 name, the partner keeps
--    the P2 name as their own P1 name.
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
  m record;
  new_hid bigint;
  month_start text := to_char(date_trunc('month', now()), 'YYYY-MM-DD');
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if old_hid is null then
    raise exception 'This account has no household.';
  end if;
  if not public.is_member(old_hid) then
    raise exception 'You are not a member of this household.';
  end if;

  select * into c from public.config where "householdId" = old_hid limit 1;

  for m in
    select "userId", email, role
    from public.household_members
    where "householdId" = old_hid and "userId" is not null
    order by id
  loop
    insert into public.households (kind) values ('single')
    returning id into new_hid;

    insert into public.household_members ("householdId", "userId", email, role)
    values (new_hid, m."userId", m.email, 'owner');

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
         "settlementMethod", "customShareP1")
      values
        (new_hid, c.key,
         case when m.role = 'owner' then c."p1Name" else c."p2Name" end,
         c."p2Name",
         c."incomeCategories", c."expenseCategories", c."billCategories",
         c."investmentCategories", c."plannedTags", c.actions,
         c."settlementMethod", c."customShareP1");
    end if;
  end loop;

  delete from public.households where id = old_hid;
end;
$$;

revoke all on function public.dismantle_household() from public;
grant execute on function public.dismantle_household() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. import_backup, now carrying the settlement settings (absent values
--    default, so pre-0015 backup files still import).
-- ---------------------------------------------------------------------------
create or replace function public.import_backup(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  hid bigint := public.current_household_id();
begin
  if hid is null then
    raise exception 'This account has no household — nothing to import into.';
  end if;

  delete from public.planned_expenses where "householdId" = hid;
  delete from public.settlements where "householdId" = hid;
  delete from public.investments where "householdId" = hid;
  delete from public.bills where "householdId" = hid;
  delete from public.personal_expenses where "householdId" = hid;
  delete from public.income where "householdId" = hid;
  delete from public.expenses where "householdId" = hid;
  delete from public.config where "householdId" = hid;

  insert into public.expenses ("householdId", date, value, category, description, "paidBy", saved)
  select hid, date, value, category, description, "paidBy", coalesce(saved, false)
  from jsonb_to_recordset(coalesce(payload->'expenses', '[]'::jsonb))
    as x(date text, value double precision, category text, description text,
         "paidBy" text, saved boolean);

  insert into public.income ("householdId", date, value, category, description, person)
  select hid, date, value, category, description, person
  from jsonb_to_recordset(coalesce(payload->'income', '[]'::jsonb))
    as x(date text, value double precision, category text, description text, person text);

  insert into public.personal_expenses ("householdId", date, value, category, description, person, saved)
  select hid, date, value, category, description, person, coalesce(saved, false)
  from jsonb_to_recordset(coalesce(payload->'personalExpenses', '[]'::jsonb))
    as x(date text, value double precision, category text, description text,
         person text, saved boolean);

  insert into public.investments
    ("householdId", date, value, category, description, action, scope, "pricePoint", units)
  select hid, date, value, category, description, action, scope, "pricePoint", units
  from jsonb_to_recordset(coalesce(payload->'investments', '[]'::jsonb))
    as x(
      date text, value double precision, category text, description text,
      action text, scope text, "pricePoint" double precision, units double precision
    );

  insert into public.bills ("householdId", date, value, category, description, scope, "paidBy")
  select hid, date, value, category, description, scope, "paidBy"
  from jsonb_to_recordset(coalesce(payload->'bills', '[]'::jsonb))
    as x(
      date text, value double precision, category text, description text,
      scope text, "paidBy" text
    );

  insert into public.planned_expenses
    ("householdId", name, links, notes, tags, purchased, "purchasedDate", "finalValue", scope, "paidBy")
  select hid, name, coalesce(links, '[]'::jsonb), coalesce(notes, ''), coalesce(tags, '{}'),
         coalesce(purchased, false), "purchasedDate", "finalValue", scope, "paidBy"
  from jsonb_to_recordset(coalesce(payload->'plannedExpenses', '[]'::jsonb))
    as x(
      name text, links jsonb, notes text, tags text[], purchased boolean,
      "purchasedDate" text, "finalValue" double precision, scope text, "paidBy" text
    );

  insert into public.settlements ("householdId", date, "periodStart", "periodEnd", "from", "to", amount)
  select hid, date, "periodStart", "periodEnd", "from", "to", amount
  from jsonb_to_recordset(coalesce(payload->'settlements', '[]'::jsonb))
    as x(
      date text, "periodStart" text, "periodEnd" text,
      "from" text, "to" text, amount double precision
    );

  insert into public.config
    ("householdId", key, "p1Name", "p2Name", "incomeCategories", "expenseCategories",
     "billCategories", "investmentCategories", "plannedTags", actions,
     "settlementMethod", "customShareP1")
  select hid, key, "p1Name", "p2Name", "incomeCategories", "expenseCategories",
         "billCategories", "investmentCategories", coalesce("plannedTags", '{}'), actions,
         coalesce("settlementMethod", 'proportional'), coalesce("customShareP1", 50)
  from jsonb_to_recordset(coalesce(payload->'config', '[]'::jsonb))
    as x(
      key text, "p1Name" text, "p2Name" text,
      "incomeCategories" text[], "expenseCategories" text[],
      "billCategories" text[], "investmentCategories" text[],
      "plannedTags" text[], actions text[],
      "settlementMethod" text, "customShareP1" double precision
    );
end;
$$;

revoke all on function public.import_backup(jsonb) from public;
grant execute on function public.import_backup(jsonb) to authenticated;
