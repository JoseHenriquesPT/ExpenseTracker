# Security Policy

Expense Tracker stores household financial data, so security issues are taken
seriously. Thanks for reporting them responsibly.

## Supported versions

Only the latest code on `master` is supported — deploy from `master` and keep
up with it. Older commits are not patched.

## Reporting a vulnerability

Please do **not** open a public issue for a security vulnerability.

Use **Security → Report a vulnerability** on this repository so the report stays
private. Include:

- what the issue is and what its impact would be,
- steps to reproduce or a proof of concept,
- anything that narrows it down — the table, migration, or RPC involved.

Do not include live instance URLs, credentials or real household data in a
public issue. Maintainers will acknowledge reports as soon as possible. Once a
fix ships, the advisory will credit you unless you prefer not to be named.

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
- Anyone being able to sign up and create their own household when sign-ups are
  enabled. Each household is fully isolated from the others. Self-hosters who
  want a private instance can disable sign-ups in Supabase Auth.
