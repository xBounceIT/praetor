# AGENTS.md

This file provides guidance to coding agents working in this repository. Treat the repository itself (`package.json`, `server/package.json`, source, and configuration) as the source of truth; update this file when a change makes any guidance below stale.

## Project Overview

Praetor is an AI-enhanced ERP application for time tracking, project management, CRM, and financial operations. React 19 + Vite frontend with Fastify + PostgreSQL (Drizzle ORM) backend.

## Development Commands

### Frontend (root directory)
```bash
bun run dev          # Start dev server (port 3000)
bun run build        # Build user docs and the production frontend, then smoke-test login boot
bun run preview      # Preview the production frontend build
bun run typecheck    # Type-check backend and frontend
bun run test         # Run backend and frontend unit tests
bun run lint         # i18n key check + typecheck + Biome check
bun run lint:fix     # Auto-fix lint issues
bun run format       # Biome formatting
bun run docs         # Generate TypeDoc, OpenAPI, and user docs
```

### Backend (server directory)
```bash
cd server
bun run dev          # Dev server with hot reload (port 3001)
bun run build        # Type-check backend (tsconfig has noEmit)
bun run start        # Run the TypeScript entrypoint with Bun
bun run db:check     # Check Drizzle schema/migration consistency
bun run db:ready     # Verify applied migrations and schema readiness
```

## Architecture

### State Management
- No Redux/MobX or application-wide store. `App.tsx` remains the main module/navigation state hub and uses reducers plus prop passing.
- Authentication state lives in `hooks/useAuth.ts`; the small current-user context under `contexts/` avoids deep prop threading. Prefer local state, existing hooks/reducers, and props over introducing a new global store.

### API Layer
- The shared client fetch wrapper and token management live in `services/api.ts`; domain helpers live under `services/api/`.
- RESTful endpoints live under `/api/*`.
- Sliding-window JWT auth: server rotates the token in the `x-auth-token` response header on each request. Idle and max-session limits are configured in `server/middleware/auth.ts`.

### Database and Production Upgrades

- PostgreSQL uses Drizzle ORM. `server/db/schema/*.ts` is the live schema source; repositories use `server/db/drizzle.ts` and return camelCase domain data from snake_case rows.
- Generate every schema/data change through Drizzle Kit (`bun run db:generate` or `bun run db:generate:custom` in `server/`). Commit the schema, forward migration, deterministic backfill, and tests together. Backend startup applies migrations and refuses to serve on failure.
- Never edit a merged migration because applied SQL is hash-tracked. The legacy `server/db/add_*.ts` scripts and `server/db/schema.sql` are frozen; see `server/db/README.md`.
- Production upgrades start with real data from the previous release. Review database and persisted data, API/webhook contracts, permissions/reference data, files, jobs, integrations, and configuration. Fresh-install-only behavior is incomplete.
- Use expand/migrate/contract for incompatible changes: add the replacement, keep old and new versions compatible, backfill, switch usage, then remove the old shape in a later release. Backfill invalid/null/duplicate rows before tightening constraints; never silently discard data.
- Migrations and backfills must be retry-safe and production-scale: avoid long locks, unbounded rewrites, and one-shot in-memory work; use set-based SQL or resumable batches as appropriate.
- Preserve compatibility for routes, fields, permission IDs, persisted snapshots, config, and encrypted values. Required config needs a safe default or documented pre-deploy step; key/format changes need dual-read or rotation support.
- Seed/reference-data changes, including roles and permissions, require an idempotent production migration. Fresh-install seeds do not upgrade production.
- Every DB schema change must keep demo seeding current. Update `server/db/seed.sql`, `server/db/demoSeed.ts`, `server/db/demoSeedManifest.ts`, and relevant seed fixtures/tests wherever affected. Run the seed-related tests and `bun run seed:demo` against a migrated database; the schema change is incomplete if the canonical demo refresh fails. Add drift coverage under `server/test/db/` for changed seeded columns or relationships.
- Migration/backfill tests under `server/test/db/` must start from legacy data and prove the upgraded result. Verify `db:migrate`, `db:ready`, and `db:check` against PostgreSQL.
- PRs with upgrade impact must document deployment order, compatibility window, backfill, checks, risks, and rollback/roll-forward. If the previous image cannot run after migration, require an explicit backup/restoration plan.

### Authentication
- Interactive sessions use JWTs with local, LDAP/AD, OIDC, or SAML authentication and optional/enforced TOTP 2FA. Personal access tokens and scoped MCP tokens are also supported for eligible endpoints.
- Authorization is permission-based and supports multiple/custom roles. Built-in system roles include `admin`, `top_manager`, `manager`, and `user`; do not infer access from a role name when a permission guard is appropriate.

### Internationalization
- i18next; translation files under `locales/`

### Documentation Maintenance
- When changing application functionality, update the relevant user documentation under `docs-site/src/content/docs/` in both Italian root pages and English mirror pages.
- If the change affects API behavior, generated frontend docs, or routing, also update the relevant OpenAPI/TypeDoc sources or documentation routing so `/docs/`, `/docs/api`, and `/docs/frontend` remain accurate.
- Do not consider a feature or behavior change complete until documentation has been reviewed and either updated or explicitly deemed unchanged.

## Key Patterns

### Route Organization
Backend routes live in `server/routes/` and are registered with URL prefixes in `server/app.ts` — see that file for the current map.

Handler pattern: `fastify.get('/', { onRequest: [authenticateToken, requireScopedPermission('projects.manage', 'view')] }, handler)`. Use `requireRole` only when behavior is intentionally limited to specific system roles rather than capabilities.

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

### Frontend UI
- Always use shadcn/ui components and primitives for frontend UI work. Prefer existing components under `components/ui/*` and shadcn composition/props over bespoke controls or custom widget implementations.
- If a needed shadcn/ui component is missing, add it with `bunx --bun shadcn@latest add <component>` and adapt behavior through the component API instead of rebuilding the same behavior manually.
- Keep shadcn theme tokens (`bg-background`, `text-foreground`, `border-border`, `text-muted-foreground`, etc.) in new UI so the user's selected theme is respected.

## Important Notes

- **Path aliases**: `@/` maps to project root (Vite + TypeScript config)
- **CDN-pinned deps**: see the importmap in `index.html`
- **Tests**: `bun run test` runs backend (`server/test/`) and frontend (`test/`) Bun suites; frontend tests use `@testing-library/react`. New features and fixes require unit tests in the matching tree; a bug regression must fail before the fix. Manual testing does not replace automation.
- **React Doctor score**: For every code change, record the current `bun run test:react-doctor` score before editing and run it again before completion. If the score decreases, report the regression and fix it before finishing; do not consider the change complete until the original score is restored or exceeded.
- **Ports**: Frontend 3000, Backend 3001, PostgreSQL 5432
- **Remote Testing**: The app itself runs on remote Docker containers. Do not run Docker commands locally, but Bun test commands such as `bun test` and `bun run test` may be run locally.
- **Commit and PR titles**: Always format commit messages and pull request titles as `scope(category): description`.
- **Docs**: Always use Context7 MCP for shadcn/ui and any library/API documentation, code generation, setup, configuration, or best-practice checks without me having to explicitly ask.
