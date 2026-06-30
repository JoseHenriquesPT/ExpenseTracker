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
| Auth | **Supabase Auth + Google OAuth** | Sign-in without managing passwords |
| Security | **Postgres Row-Level Security** + email allowlist | Real enforcement at the database, not the client |
| Realtime | **Supabase Realtime** | The other person's edits appear live |
| Icons | **sharp** (dev only) | Generates the PWA icon set at build time |
| Hosting | **Vercel** | Static-site hosting + CI deploys |

---

## Frontend

### TypeScript
Strict mode is on ([tsconfig.json](tsconfig.json)). The domain model in
[src/db/types.ts](src/db/types.ts) (`ExpenseEntry`, `IncomeEntry`, `Investment`,
`Bill`, `BillPayment`, `Config`) is the single source of truth: the same shapes
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
because every request must still pass RLS + a valid Google session. The
`service_role` key is never used client-side.

### Data-access layer
[src/db/db.ts](src/db/db.ts) wraps Supabase queries in a small `SupaTable` class
that re-implements the slice of the old Dexie API the pages relied on (`toArray`,
`orderBy().reverse()`, `get`, `add`, `put`, `delete`, `clear`, `bulkAdd`). This
is why the migration from local IndexedDB to hosted Postgres barely touched the
page components. It also seeds the singleton `config` row (`ensureConfig`).

> **History:** earlier versions were local-first using **Dexie/IndexedDB**. Those
> packages (`dexie`, `dexie-react-hooks`) are still in `package.json` but the data
> path now goes through Supabase. See the [README](README.md) for the migration note.

### Schema & migrations
`supabase/migrations/0001_init.sql` defines all six tables plus the security
model. It's run once by hand in the Supabase SQL editor (see [README](README.md)
→ "First-time backend setup"). Dates are stored as ISO `YYYY-MM-DD` **text** so
they sort lexicographically — which `finance.ts` relies on for its window queries.

### Auth — Google OAuth
[src/auth/AuthGate.tsx](src/auth/AuthGate.tsx) wraps the whole app. It uses
`supabase.auth.signInWithOAuth({ provider: "google" })` and renders the app only
for a signed-in account. Sign-out lives in the sidebar ([src/App.tsx](src/App.tsx)).

### Security — Row-Level Security + allowlist
This is the real gate, enforced **in the database**, not the client:
- An `allowed_emails` table holds the permitted accounts. It has RLS enabled and
  **no policies**, so it's unreachable from the browser API — managed only from
  the SQL editor.
- An `is_allowed()` SQL function (`security definer`) checks the signed-in user's
  email against that table.
- Every domain table has select/insert/update/delete policies that all call
  `is_allowed()`. AuthGate also calls the `is_allowed` RPC just to show a clean
  "not authorized" screen — but even if the UI were bypassed, RLS still blocks
  unauthorized rows.

### Realtime — live two-person sync
[src/db/live.ts](src/db/live.ts) replaces `dexie-react-hooks`' `useLiveQuery`
with a ~60-line module. A version counter bumps on (a) any Postgres change
broadcast over a **Supabase Realtime** channel — so the *other* person's edits
show up live — and (b) every local mutation (`touch()` in `db.ts`), so your own
edits reflect immediately. `useSyncExternalStore` re-runs queries on each bump.
The realtime publication is enabled for all tables in the migration SQL.

---

## Domain logic

[src/lib/finance.ts](src/lib/finance.ts) holds the only real business logic,
ported from the original Excel formulas:
- **`nextDueDate`** — next Weekly/Monthly/Yearly bill occurrence ≥ today.
- **`buildOverview`** — windowed sum-by-category for each stream (income,
  expenses, bills, net investments) plus total saved.
- **`computeSettlement`** — income-proportional fair-share split that resolves
  who owes whom in a single transfer.

[src/lib/format.ts](src/lib/format.ts) handles display formatting and
[src/lib/backup.ts](src/lib/backup.ts) does JSON export/import (dump every table /
clear-then-restore).

---

## Tooling & hosting

- **sharp** (dev dependency) generates the PWA icon set (`pwa-192`, `pwa-512`,
  maskable, apple-touch) from a source image into `public/`.
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
    → @supabase/supabase-js HTTP call (carries the Google session JWT)
      → Postgres RLS checks is_allowed() against allowed_emails
        → row written; Realtime broadcasts the change
          → live.ts touch() bumps version → useLiveQuery refetches
            → React re-renders the updated numbers/charts
```
