# Roadmap

**Status:** private two-person tracker — Google sign-in + email allowlist, single shared dataset.
**Goal:** any household can sign up and use the app, with each household's data fully isolated.

## Phase 1 — Multi-tenant foundation (stay private while building)

Tests first: the acceptance gate is an isolation test suite proving two households can
never read or write each other's rows. Run it against a real Supabase project with two
distinct signed-in users before opening signups.

- [x] `0008_households.sql`: add `households` (with `kind`: single | couple) and
      `household_members`; add `householdId` to every domain table; replace the global
      `config.key` unique with `unique(householdId, key)`.
- [x] Backfill existing data into household #1 — the current two users keep everything.
- [x] `is_member(householdId)` security-definer function; rewrite all RLS policies
      (`0001`, `0002`, `0003`, `0006`) from `is_allowed()` to membership. Keep the
      allowlist as the outer beta gate for now.
- [x] Client scoping: household-aware `SupaTable` (reads filtered, writes injected),
      per-household `ensureConfig()`, realtime filter by `householdId`
      (client unit tests in `src/db/db.test.ts` / `household.test.ts`).
- [x] Scope `import_backup()` to the caller's household (`0009`) — previously it
      deleted every tenant's rows.
- [ ] Exit criteria: isolation tests pass; the current pair sees zero behavioural change.

Verified locally (never production): `npx supabase db reset && npx supabase test db`
— 79 pgTAP tests covering cross-household read/write denial, scoped imports and
household onboarding (create/join/invites/capacity).

## Phase 2 — Open signups, single-individual mode

- [x] Onboarding: "Create a household" / "Join with invite code", replacing the No-access
      screen — first choice is "just me" (single) or "me and a partner" (couple).
- [x] Single-individual mode: everything centres on one person — no P1/P2 split, no shared
      pool, no settlement; Dashboard, ledgers, bills and config all show a single person.
- [x] `household_invites` table + `join_household(code)` RPC; member management in Settings
      (including upgrading a single household to a couple one later).
- [ ] Email magic-link sign-in alongside Google — Google-only isn't everyone.
- [ ] Remove the allowlist gate.
- [ ] Exit criteria: a stranger can sign up alone or as a pair, and each household sees
      only its own data.

## Phase 3 — Polish & operations

- [ ] Generic default categories and currency/locale (defaults are currently Portuguese).
- [ ] Delete account/household (GDPR) + privacy and terms pages.
- [ ] Supabase tier limits and basic abuse caps.
- [ ] Update README / TECH_STACK docs for the multi-tenant model.
