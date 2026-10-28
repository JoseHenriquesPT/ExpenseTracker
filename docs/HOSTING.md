# Hosting guide

This guide walks through running your own Expense Tracker instance. You need a
Supabase project for the database and auth, plus any static host for the built
frontend.

The frontend is a static single-page app. It talks directly to Supabase, so
there is no application server to deploy.

## 1. Prerequisites

- Node.js 20+ and npm
- A Supabase project
- A static host (Vercel, Netlify, Cloudflare Pages, GitHub Pages, etc.)
- Google OAuth credentials if you want Google sign-in
- An SMTP provider if you want production email magic links

## 2. Create the Supabase project

1. Create a project at <https://supabase.com/dashboard>.
2. Open **Project Settings → API** and note:
   - **Project URL**
   - **anon public** key
3. Never use or expose the `service_role` key in the frontend. The anon key is
   safe to ship in the browser because every request still passes row-level
   security as a signed-in user.

## 3. Apply the database migrations

Migrations are plain SQL files in `supabase/migrations/` and must be applied in
numeric order (`0001` first).

### Option A: Supabase CLI (recommended)

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

The CLI applies all pending migrations in order.

### Option B: SQL editor

Open **SQL Editor** in the Supabase dashboard and run each file in numeric order.
Do not skip files: later migrations depend on earlier schema.

### Option C: Single migration script

The repository includes `scripts/apply-migration.ps1` for applying one file to a
hosted database through Docker. Create `supabase/.env.prod.local` with:

```text
PROD_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres
```

Then apply files one at a time:

```powershell
powershell -File scripts/apply-migration.ps1 supabase/migrations/0017_security_hardening.sql
```

The file is gitignored. The script runs the migration in a single transaction
and refuses anything outside `supabase/migrations/NNNN_*.sql` unless
`-AllowAnyPath` is passed.

After the migrations, verify the schema and policies in the Supabase dashboard.
The pgTAP tests in `supabase/tests/` can be run against a local Supabase stack:

```bash
npx supabase start
npx supabase test db
```

## 4. Configure authentication

### Google OAuth

1. Create OAuth credentials in the Google Cloud console.
2. Add the Supabase callback URL as an authorized redirect URI. It has the form
   `https://<project-ref>.supabase.co/auth/v1/callback`.
3. In Supabase, open **Authentication → Providers → Google**, enable it and add
   the client ID and client secret.

### Email magic links

Email sign-in works out of the box for development. For production, configure a
custom SMTP provider under **Authentication → Emails → SMTP Settings** so links
are delivered reliably and are not subject to the default rate limits.

### Redirect URLs

Under **Authentication → URL Configuration**, set:

- **Site URL** to your production site, for example
  `https://your-domain.example`
- **Redirect URLs** to include:
  - `http://localhost:5173`
  - your production URL
  - any preview or staging URL you use

The app uses a hash router, so no server-side rewrite rules are required for
client-side routes.

## 5. Configure the frontend

Copy the example environment file:

```bash
cp .env.example .env.local
```

Set:

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-public-key>
VITE_CURRENCY=EUR
```

`VITE_CURRENCY` is optional and sets the starting display currency. It accepts
an ISO 4217 code such as `USD`, `GBP` or `BRL` and defaults to `EUR`. People can
switch between EUR and PLN in Settings; that choice is remembered on their
device.

These values are baked into the build, so set them in the build environment of
your host as well as locally.

## 6. Build and deploy

```bash
npm ci
npm run build
```

The production output is in `dist/`. Upload that directory to any static host.

### Vercel

- Create a project and point it at your repository or upload `dist/`.
- Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and optionally
  `VITE_CURRENCY` as environment variables for the build.
- `vercel.json` adds security headers (CSP, frame denial, referrer policy and
  permissions policy). Other hosts need equivalent headers configured at the
  edge or in the host settings.
- For a private instance, set **Deployment Protection** to **All Deployments**
  and keep the Git integration disconnected after setup. The
  "All Deployments Except Custom Domains" option leaves custom aliases such as
  `<project>-<words>-<n>.vercel.app` publicly reachable, and a connected Git
  integration makes Vercel post preview URLs and project/team IDs in comments
  on public pull requests. Remove unused aliases.

### Other static hosts

- Serve `dist/` with HTTPS.
- Add the same security headers if the host supports them.
- No server rewrite is needed because routing is hash-based.

## 7. Post-deploy checks

1. Open the site and sign in with Google or an email magic link.
2. Complete onboarding and create a household.
3. Add an expense, income entry and bill; confirm the dashboard updates.
4. Sign in as a second account and confirm it cannot see the first household's
   data.
5. Confirm realtime updates arrive when a second member edits data.
6. Export a backup and re-import it in a test household.

## 8. Operations

- **Migrations:** apply new files in numeric order before deploying frontend
  code that depends on them.
- **Backups:** use the in-app JSON export regularly; keep copies outside the
  host.
- **Secrets:** keep `.env.local`, `supabase/.env.prod.local`, `.vercel/` and any
  service-role keys out of version control.
- **Private instance:** if you only want your own household, disable new
  sign-ups in **Authentication → Providers** after creating your account.
- **Abuse controls:** review Supabase Auth rate limits and your host's usage
  limits before opening sign-ups to the public.
- **Dependency updates:** run `npm test` and `npm run build` before upgrading.
