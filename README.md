# Expense Tracker

A self-hostable household expense tracker built with React, TypeScript, Vite and
Supabase Postgres. Each household's data is isolated with Postgres row-level
security, and the app installs as a PWA on phones and desktops.

The project is MIT licensed and intended to be forked, self-hosted and extended.
No hosted instance or shared backend is provided.

## Features

- Single-person or two-person households
- Common expenses, individual expenses, income, bills, savings and investments
- Income-proportional or custom settlement split
- Monthly and annual overview with category charts
- Planned expenses with notes, links and tags
- English, Portuguese (Portugal) and Polish UI
- Google OAuth and email magic-link sign-in
- JSON export/import with transactional restore
- Installable PWA with offline asset caching

## Local development

Requirements: Node.js 20+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. See
[the hosting guide](docs/HOSTING.md) for creating the Supabase project, applying
migrations and configuring auth providers.

```bash
npm test          # unit tests
npm run build     # type-check and production build
npm run preview   # serve the production build locally
```

## Self-hosting

The complete walkthrough is in **[docs/HOSTING.md](docs/HOSTING.md)**. It covers:

- creating and configuring a Supabase project
- applying migrations in numeric order
- Google OAuth and email magic-link/SMTP setup
- environment variables and build settings
- deploying the static build to Vercel or another static host
- post-deploy verification and operational notes

Keep the Supabase `service_role` key out of the browser and out of this
repository. The `anon` key is public by design; row-level security is the real
access control.

## Project structure

| Path | Purpose |
|------|---------|
| `src/pages/` | Application screens |
| `src/db/` | Supabase client, data layer and household scoping |
| `src/lib/` | Finance logic, formatting and backup validation |
| `src/i18n/` | UI translations |
| `supabase/migrations/` | Database schema, RLS policies and RPCs |
| `supabase/tests/` | pgTAP isolation and lifecycle tests |
| `docs/` | Hosting and architecture documentation |

For the full stack and architecture notes, see [TECH_STACK.md](TECH_STACK.md).
For planned work, see [ROADMAP.md](ROADMAP.md).

## Security

Access control is enforced in Postgres, not in the frontend. Please read
[SECURITY.md](SECURITY.md) before reporting a vulnerability.

## License

MIT. See [LICENSE](LICENSE).
