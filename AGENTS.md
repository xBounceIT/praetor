# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Praetor is an AI-enhanced ERP application for time tracking, project management, CRM, and financial operations. React 19 + Vite frontend with Fastify + PostgreSQL (Drizzle ORM) backend.

## Development Commands

### Frontend (root directory)
```bash
bun run dev          # Start dev server (port 3000)
bun run build        # Production build
bun run lint         # Biome check
bun run lint:fix     # Auto-fix lint issues
bun run format       # Biome formatting
```

### Backend (server directory)
```bash
cd server
bun run dev          # Dev server with hot reload (port 3001)
bun run build        # TypeScript compilation
bun run start        # Run compiled server
```

## Architecture

### State Management
- No Redux/MobX. `App.tsx` is the central state hub: it owns shared state and passes it down via props.
- Components receive data through props, not global stores.

### API Layer
- Client-side API helpers live under `services/api/` (custom fetch wrapper with token management)
- RESTful endpoints under `/api/*`
- Sliding-window JWT auth: server rotates the token in the `x-auth-token` response header on each request. Idle and max-session limits are configured in `server/middleware/auth.ts`.

### Database
- PostgreSQL via Drizzle ORM (`server/db/schema/`). All repositories go through the Drizzle helpers exported from `server/db/drizzle.ts` (db instance, executor type, transaction wrapper).
- Snake_case in DB → camelCase in API responses

### Database migrations
- New schema changes go through Drizzle Kit (`bun run db:generate` or `bun run db:generate:custom` from `server/`, then `bun run db:migrate`).
- The legacy `server/db/add_*.ts` scripts and `server/db/schema.sql` are frozen historical artifacts — see `server/db/README.md` for the full workflow.

### Authentication
- JWT-based, with optional LDAP/AD fallback
- Roles: admin (full access), manager (CRM/reports), user (personal tracking)

### Internationalization
- i18next; translation files under `locales/`

## Key Patterns

### Route Organization
Backend routes live in `server/routes/` and are registered with URL prefixes in `server/app.ts` — see that file for the current map.

Handler pattern: `fastify.get('/', { onRequest: [authenticateToken, requireRole('manager')] }, handler)`

### Repositories (data access)
SQL belongs in `/server/repositories/<domain>Repo.ts`, not inline in route handlers.

- Each function takes an optional `DbExecutor` parameter (default `db`) so it works both standalone and inside `withDbTransaction(async (tx) => repo.fn(args, tx))`. Type imported from `../db/drizzle.ts`.
- Row types and any `mapXxxRow` helpers live in the repo file alongside the SQL they belong to.
- Routes import the repo as a namespace: `import * as <domain>Repo from '../repositories/<domain>Repo.ts'`.
- Repos return domain shapes (camelCase, parsed numbers, mapped enums); they do not touch `request`, `reply`, validation, or HTTP status codes.

### Component Naming
- Views: PascalCase `*View.tsx`
- Utilities: camelCase
- Route files: kebab-case

## Important Notes

- **Path aliases**: `@/` maps to project root (Vite + TypeScript config)
- **CDN-pinned deps**: see the importmap in `index.html`
- **Tests**: `bun run test` (Bun test runner; suites under `server/test/`). Other layers still rely on manual testing.
- **Ports**: Frontend 3000, Backend 3001, PostgreSQL 5432
- **Remote Testing**: App runs on remote Docker containers — do not run commands locally for testing
- **Docs**: Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.
