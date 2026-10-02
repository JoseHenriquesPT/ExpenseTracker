# Expense Tracker

A personal, two-person rebuild of `Template.xlsx`. Data is stored in **Supabase
Postgres**, gated by **Google sign-in** and a server-side email allowlist, so the
same data is reachable from phone and desktop while staying private to the two of
you. (Earlier versions were local-first/IndexedDB — that has been replaced.)

Built with React + TypeScript + Vite (installable PWA) on a Supabase Postgres
backend. For the full rundown of every technology, why it's here, and where it
lives in the code, see **[TECH_STACK.md](TECH_STACK.md)**.

## Run it

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + anon key
npm run dev                  # http://localhost:5173
```

First-time backend setup: run the files in `supabase/migrations/` in order
(`0001` → `0007`) in the Supabase SQL editor, add the allowed emails, and enable
the Google auth provider. See the inline notes in `0001_init.sql`.

To run the tests and the optimized build locally:

```bash
npm test
npm run build
npm run preview
```

## What's where

| Spreadsheet sheet            | App equivalent                                   |
|------------------------------|--------------------------------------------------|
| Home hub                     | Every section as a card (`src/pages/HomePage.tsx`) |
| Common / Individual Expenses / Income | Expenses & Savings + Income ledgers (`src/pages/LedgerPage.tsx`) |
| Bills (paid)                 | Bills page (`src/pages/BillsPage.tsx`)           |
| Full entry record            | History page (`src/pages/HistoryPage.tsx`)       |
| Montly / Annual Overview     | Dashboard (`src/pages/Dashboard.tsx`)            |
| Data Config                  | Settings → people + category editors             |
| Settings (date engine)       | Dashboard month/year selectors                   |

`/investments` is archived (not linked from Home) — old rows stay reachable and
in backups, but new money moved into investments is registered as **Saved into
investments** under Expenses & Savings.

## Two people (P1 / P2)

The tracker distinguishes two people (rename them in **Settings → People**):

- **Income** is attributed to a person — this fixes their fair-share %.
- **Common Expenses** are shared, but each records *who paid* (out of pocket).
- **Bills** are tagged **P1**, **P2**, or **Common**, and each records *who paid*.
  Registering a bill counts it as paid. Common bills join the shared pool; P1/P2
  bills are that person's own responsibility.
- **Individual Expenses** are personal spending attributed to a person — never
  shared, so they don't enter the settlement.
- **Saved into investments** is an expense flagged as savings: it shows under the
  Savings category, counts as invested in the Dashboard income pies, and is
  deliberately **not** part of the settlement pool.

### Settlement (`computeSettlement` in `src/lib/finance.ts`)

At the end of a period the Dashboard shows a single settling transfer:

```
share%      = person_income / total_income          (50/50 if no income)
pool        = common expenses + Common-tagged bills   (savings excluded)
fair_share  = share% × pool
balance     = what they paid out of pocket − fair_share
```

Whoever overpaid is owed their positive balance; the other transfers exactly that
amount. With two people the balances mirror (sum to zero), so one transfer settles it.
The Dashboard's **Settle** button records that transfer for the period (stored in
`settlements`), which clears the balance until you undo it.

## The math (ported from the Excel formulas)

`src/lib/finance.ts` holds the real logic:

- **`buildOverview(...)`** — windowed `SUM ... GROUP BY category` for each stream,
  with saved-into-investments rows split out as Savings, and Saved = Income −
  (Common Expenses + Individual Expenses + Bills + Savings). Port of the Overview
  `SUMIFS` grids.
- **`computeSettlement(...)`** — the income-proportional fair-share split above,
  net of any recorded `settlements` for the period.
- **`buildIncomeSplits(...)`** — the two Dashboard pies: each person's income
  split into their fair share of all spending, what they invested (saved into
  investments) and what's left as savings.

## Backup

Settings → Export/Import JSON. Export dumps every table to a JSON file. Import
validates the file first, asks for confirmation, then **replaces** all rows in a
single database transaction (migration `0005`), so a bad or interrupted import
can't leave half the data behind.
