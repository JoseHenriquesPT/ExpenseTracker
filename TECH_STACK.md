# Tech Stack

This document explains every technology in the Expense Tracker, **why** it's here,
and **where** it lives in the code. For setup and feature docs, see the
[README](README.md).

The app is a small, private, two-person expense tracker — a rebuild of
`Template.xlsx`. The whole stack is chosen to keep it: installable on a phone,
reachable from any device, private to two people, and cheap/simple to host.

---

## At a glance

| Layer | Choice | Why |
|-------|--------|-----|
| Language | **TypeScript** | Type-safe domain model shared by UI, DB layer, and the SQL schema |
| UI | **React 18** | Component model; `useSyncExternalStore` powers the live-query layer |
| Routing | **React Router 6** (hash router) | Client-side routing that survives static hosting & file access |
| Build/dev | **Vite 5** | Fast dev server + optimized Rollup production build |
| PWA | **vite-plugin-pwa** (Workbox) | Installable to home screen, offline asset cache, self-updating |
| Charts | **Recharts** | Declarative React charts for the Dashboard overview |
| Backend | **Supabase** (Postgres) | Hosted DB reachable from phone + desktop, no server to run |
| Auth | **Supabase Auth** (Google + email magic link) | Sign-in without managing passwords |
| Security | **Postgres Row-Level Security** + household membership | Real enforcement at the database, not the client |
| Realtime | **Supabase Realtime** | The rest of the household sees edits live |
| Icons | Committed PNG set | Generated once; no build step needed |
| Hosting | **Vercel** | Static-site hosting + CI deploys |

---

## Frontend

### TypeScript
Strict mode is on ([tsconfig.json](tsconfig.json)). The domain model in
[src/db/types.ts](src/db/types.ts) (`ExpenseEntry`, `IncomeEntry`,
`PersonalExpenseEntry`, `Investment`, `Bill`, `SettlementRecord`, `Config`) is the
single source of truth: the same shapes
flow through the React pages, the data-access layer, and even drive the column
names in the SQL schema (`supabase/migrations/0001_init.sql` uses quoted
camelCase to match the interfaces exactly, so no field remapping is needed).

### React 18
The UI is plain React with function components and hooks. Notable usage:
- [src/main.tsx](src/main.tsx) mounts the app inside `<AuthGate>` and the router.
- [src/db/live.ts](src/db/live.ts) uses **`useSyncExternalStore`** to build a tiny
  reactive layer (see *Realtime* below).

### React Router 6 — hash router
[src/main.tsx](src/main.tsx) uses **`createHashRouter`**. The hash (`/#/expenses`)
means routing is fully client-side and works even when the app is opened from a
static host or the filesystem, with no server rewrite rules required. Routes nest
under [src/App.tsx](src/App.tsx) (the sidebar shell + `<Outlet/>`).

### Vite 5
Dev server and bundler ([vite.config.ts](vite.config.ts)). Scripts in
[package.json](package.json):
- `npm run dev` — dev server on port 5173 (auto-opens).
- `npm run build` — type-checks (`tsc -b`) then builds with Vite/Rollup.
- `npm run preview` — serves the production build locally.

The React plugin (`@vitejs/plugin-react`) provides JSX transform + fast refresh.

### PWA — vite-plugin-pwa
Configured in [vite.config.ts](vite.config.ts). It generates a web app manifest
and a Workbox service worker so the app:
- Installs to a phone home screen and runs fullscreen (`display: standalone`).
- Precaches JS/CSS/HTML/SVG/PNG/woff2 assets for offline loads.
- Self-updates on the next load after a deploy (`registerType: "autoUpdate"`).

The matching meta tags (theme color, Apple touch icon, status bar) live in
[index.html](index.html).

### Recharts
Declarative charting library used on the Dashboard
([src/pages/Dashboard.tsx](src/pages/Dashboard.tsx)) to visualize the
category-level overview built by `buildOverview` in
[src/lib/finance.ts](src/lib/finance.ts).

---

## Backend — Supabase

The app has **no custom server**. All data lives in Supabase's hosted Postgres,
and the browser talks to it directly through `@supabase/supabase-js`.

### Client
[src/db/supabase.ts](src/db/supabase.ts) creates the singleton client from
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see [.env.example](.env.example)).
The **anon key is meant to ship in the browser** — on its own it can do nothing,
because every request must still pass RLS as a valid signed-in user. The
`service_role` key is never used client-side.

### Data-access layer
[src/db/db.ts](src/db/db.ts) wraps Supabase queries in a small `SupaTable` class
(`toArray`, `orderBy().reverse()`, `get`, `add`, `put`, `delete`, `clear`,
`bulkAdd`). It also seeds the singleton `config` row (`ensureConfig`).

> **History:** earlier versions were local-first using **Dexie/IndexedDB**; those
> packages have been removed and the data path goes through Supabase. See the
> [README](README.md) for the migration note.

### Schema & migrations
The `supabase/migrations/*.sql` files define the domain tables plus the
household tenancy model and the security model, and are run in order by hand in
the Supabase SQL editor (see [README](README.md) → "First-time backend setup").
Dates are stored as ISO
`YYYY-MM-DD` **text** so they sort lexicographically — which `finance.ts` relies
on for its window queries. `0005` adds `import_backup()`, which restores a
backup in one transaction (`0009` scopes it to the caller's household).

### Auth — Google OAuth or email magic link
[src/auth/AuthGate.tsx](src/auth/AuthGate.tsx) wraps the whole app. It signs
users in with `supabase.auth.signInWithOAuth({ provider: "google" })` or an
email magic link, and renders the app only for a signed-in account. On sign-in
it also calls `claim_pending_membership()` to bind the account's `userId` to its
household membership row. Sign-out lives in the sidebar ([src/App.tsx](src/App.tsx)).

### Security — Row-Level Security + household membership
This is the real gate, enforced **in the database**, not the client:
- Every account belongs to at most one household (`households` +
  `household_members`), and every row of every domain table carries a
  `householdId`.
- An `is_member(household_id)` SQL function (`security definer`) answers "does
  the signed-in user belong to this household?". All select/insert/update/delete
  policies on the domain tables call it, so even a fully bypassed UI cannot reach
  another household's rows.
- Membership is **bound to `userId`**, not to an email address: an email matches
  only a pending, ownerless membership row, so a recycled or stale address grants
  nothing (`0017`).
- One household per account is enforced by a unique constraint on
  `household_members("userId")`, not by an application-level check. Invite codes
  are minted server-side by `create_invite()`, and `dismantle_household()` is
  owner-only.
- The old email allowlist and its `is_allowed()` gate are gone (`0014`): any
  signed-in account can onboard a household of its own, isolated from all
  others. [supabase/tests/](supabase/tests/) proves that isolation with pgTAP.

### Realtime — live household sync
[src/db/live.ts](src/db/live.ts) provides the app's `useLiveQuery` hook. A
version counter bumps on (a) any Postgres change broadcast over a **Supabase
Realtime** channel — so the rest of the household's edits show up live — and (b)
every
local mutation (`touch()` in `db.ts`), so your own edits reflect immediately.
`useSyncExternalStore` re-runs queries on each bump. The channel is opened only
after sign-in, because RLS-protected `postgres_changes` bind the user's token at
subscribe time. The realtime publication is enabled for all tables in the
migration SQL.

---

## Domain logic

[src/lib/finance.ts](src/lib/finance.ts) holds the only real business logic,
ported from the original Excel formulas:
- **`buildOverview`** — windowed sum-by-category for each stream (income, common
  expenses, individual expenses, bills, net investments) plus total saved.
- **`computeSettlement`** — income-proportional fair-share split that resolves
  who owes whom in a single transfer, net of any recorded settlements.
- **`summarizeInvestments`** — average-cost holdings and realized P/L, kept
  separate per (scope, name) so people's positions never pool.

[src/lib/format.ts](src/lib/format.ts) handles display formatting.
[src/lib/backup.ts](src/lib/backup.ts) does JSON export/import;
[src/lib/backupSchema.ts](src/lib/backupSchema.ts) validates a backup file
before anything is written, and import runs through the transactional
`import_backup()` Postgres function.

---

## Tooling & hosting

- **PWA icons** (`pwa-192`, `pwa-512`, maskable, apple-touch) are committed
  under `public/`; they were generated once and aren't rebuilt by the app.
- **Vitest** runs the pure-logic tests (`npm test`): finance math and backup
  validation.
- **Vercel** hosts the static build and runs deploys (`.vercel/project.json`).
  Because routing is hash-based, no server-side rewrites are needed; the
  production output is a plain static bundle from `npm run build`.
- **Environment variables** are Vite-style `VITE_*` vars, kept in `.env.local`
  (git-ignored) and mirrored as Vercel project env vars for deploys.

---

## How a request flows

```
User action in a page (e.g. LedgerPage)
  → db.ts SupaTable method (add/put/delete/...)
    → @supabase/supabase-js HTTP call (carries the signed-in user's session JWT)
      → Postgres RLS checks is_member() against household_members
        → row written; Realtime broadcasts the change
          → live.ts touch() bumps version → useLiveQuery refetches
            → React re-renders the updated numbers/charts
```
