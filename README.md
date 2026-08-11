# CompanyOS AI — Foundation Phase

The operating system for how your company runs. This repository contains the
production foundation of CompanyOS AI: authentication, organization and
company onboarding, role-based access control, dashboard shell, and the
supporting Prisma/PostgreSQL schema. **AI agents are intentionally out of
scope for this phase.**

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS + shadcn/ui (Radix primitives)
- PostgreSQL + Prisma ORM
- Supabase Auth (`@supabase/ssr`)
- React Query, Zod, Docker

## Getting started

```bash
cp .env.example .env.local     # fill in Supabase + database values
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed                # seeds the RBAC permission catalog
npm run dev
```

The app runs at `http://localhost:3000`.

### Running with Docker

```bash
cp .env.example .env           # docker-compose reads .env, not .env.local
docker compose up --build
```

This starts a PostgreSQL container and the app container together. Run
migrations against it once with `docker compose exec app npx prisma migrate deploy`.

### Supabase setup

1. Create a project at supabase.com.
2. Copy the project URL and anon key into `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Under Authentication → URL Configuration, set the redirect URL to
   `<your-app-url>/api/auth/callback`.
4. Point `DATABASE_URL` / `DIRECT_URL` at your own PostgreSQL instance (or
   Supabase's Postgres connection string) — Prisma owns the application
   schema independently of Supabase's `auth` schema.

## Project structure

See `PROGRESS_REPORT.md` for the full breakdown of what's implemented,
the database schema, and the recommended next phase.

## Scripts

| Command                  | Description                              |
| ------------------------ | ----------------------------------------- |
| `npm run dev`             | Start the dev server                      |
| `npm run build`           | Production build                          |
| `npm run lint`            | ESLint                                    |
| `npm run format`          | Prettier — write                          |
| `npm run type-check`      | `tsc --noEmit`                            |
| `npm run prisma:migrate`  | Create/apply a dev migration              |
| `npm run prisma:studio`   | Open Prisma Studio                        |
| `npm run db:seed`         | Seed the permission catalog               |
