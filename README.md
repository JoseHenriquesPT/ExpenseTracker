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

First-time backend setup: run `supabase/migrations/0001_init.sql` in the Supabase
SQL editor, add the allowed emails, and enable the Google auth provider. See the
inline notes in that SQL file.

To run the optimized build locally:

```bash
npm run build
npm run preview
```

## What's where

| Spreadsheet sheet            | App equivalent                                   |
|------------------------------|--------------------------------------------------|
| Common Expenses / Income / Investments | Ledger pages (`src/pages/LedgerPage.tsx`) |
| Bills (schedule)             | Bills page → Schedule (`src/pages/BillsPage.tsx`)|
| Bills Regist (paid)          | Bills page → Payment register                    |
| Montly / Annual Overview     | Dashboard (`src/pages/Dashboard.tsx`)            |
| Data Config                  | Settings → people + category editors             |
| Settings (date engine)       | Dashboard month/year selectors                   |

## Two people (P1 / P2)

The tracker distinguishes two people (rename them in **Settings → People**):

- **Income** is attributed to a person — this fixes their fair-share %.
- **Common Expenses** are shared, but each records *who paid* (out of pocket).
- **Bills** are tagged **P1**, **P2**, or **Common**. Common bills join the shared
  pool; P1/P2 bills are that person's own responsibility.

### Settlement (`computeSettlement` in `src/lib/finance.ts`)

At the end of a period the Dashboard shows a single settling transfer:

```
share%      = person_income / total_income          (50/50 if no income)
pool        = common expenses + Common-tagged bill payments
fair_share  = share% × pool
balance     = what they paid out of pocket − fair_share
```

Whoever overpaid is owed their positive balance; the other transfers exactly that
amount. With two people the balances mirror (sum to zero), so one transfer settles it.

## The math (ported from the Excel formulas)

`src/lib/finance.ts` holds the two real pieces of logic:

- **`nextDueDate(start, recurrency)`** — next occurrence ≥ today for Weekly /
  Monthly / Yearly bills (port of the `Bills!D` LET/IFS formula).
- **`buildOverview(...)`** — windowed `SUM ... GROUP BY category` for each stream,
  with investments = Invested − Withdraw, and Saved = Income − (Expenses + Bills +
  Investments). Port of the Overview `SUMIFS` grids.

## Backup

Settings → Export/Import JSON. Export dumps every table to a JSON file; Import
**replaces** all rows in the database with that file's contents.
