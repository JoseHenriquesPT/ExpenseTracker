# Security Policy

Expense Tracker stores household financial data, so security issues are taken
seriously. Thanks for reporting them responsibly.

## Supported versions

Only the latest code on `master` is supported — deploy from `master` and keep
up with it. Older commits are not patched.

## Reporting a vulnerability

Please do **not** open a public issue for a security vulnerability.

Use [GitHub's private vulnerability reporting](https://github.com/JoseHenriquesPT/ExpenseTracker/security/advisories/new)
(Security → Report a vulnerability). Include:

- what the issue is and what its impact would be,
- steps to reproduce or a proof of concept,
- anything that narrows it down — the table, migration, or RPC involved.

You should get an acknowledgement within a few days. Once a fix ships, the
advisory will credit you unless you prefer not to be named.

## What counts as a vulnerability here

Access control lives in Postgres row-level security (`supabase/migrations/`),
not in the frontend, so please test against the database directly and not just
through the UI. Anything that lets one household read or write another
household's rows is critical.

Two things that are **not** vulnerabilities on their own:

- The Supabase `anon` key appearing in the frontend bundle. It is designed to
  be public and can do nothing on its own — every request still has to pass
  RLS as a signed-in user. The `service_role` key, by contrast, must never
  ship in the client; report that immediately.
- Anyone being able to sign up and create their own household. Open signups
  are the intended model (see `supabase/migrations/0014_drop_allowlist.sql`),
  with each household fully isolated from the others.
