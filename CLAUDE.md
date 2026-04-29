# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Praetor is an AI-enhanced ERP application for time tracking, project management, CRM, and financial operations. React 19 + Vite frontend with Fastify + PostgreSQL backend.

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
- No Redux/MobX - uses React hooks with centralized state in `App.tsx`
- `App.tsx` (~83KB) manages all application state and passes via props
- Components receive data through props, not global stores

### API Layer
- `/services/api.ts` - Custom fetch wrapper with token management
- RESTful endpoints at `/api/*`
- Sliding window JWT auth (30min idle timeout, 8hr max session)
- Server returns new token in `x-auth-token` header on each request

### Database
- Direct PostgreSQL via `pg` driver (no ORM)
- Raw SQL queries with parameterized inputs
- Snake_case in DB → camelCase in API responses

### Authentication
- JWT (HS256) with optional LDAP/AD fallback
- Roles: admin (full access), manager (CRM/reports), user (personal tracking)

### Internationalization
- i18next with English (en) and Italian (it)

## Key Patterns

### Route Organization
Backend routes in `/server/routes/` with prefix-based registration:
- `auth.ts` → `/api/auth`
- `clients.ts` → `/api/clients`
- Pattern: `fastify.get('/', { onRequest: [authenticateToken, requireRole('manager')] }, handler)`

### Repositories (data access)
SQL belongs in `/server/repositories/<domain>Repo.ts`, not inline in route handlers. Migration is incremental — `notificationsRepo.ts` is the reference implementation; new SQL should follow this pattern, and existing inline SQL should move when its route file is touched.

- Each function takes an optional `QueryExecutor` parameter (default `pool`) so it works both standalone and inside `withTransaction(async (tx) => repo.fn(args, tx))`. Type imported from `../db/index.ts`.
- Row types and any `mapXxxRow` helpers live in the repo file alongside the SQL they belong to.
- Routes import the repo as a namespace: `import * as notificationsRepo from '../repositories/notificationsRepo.ts'`.
- Repos return domain shapes (camelCase, parsed numbers, mapped enums); they do not touch `request`, `reply`, validation, or HTTP status codes.

### Component Naming
- Views: PascalCase `*View.tsx` (e.g., `ClientsView.tsx`, `SalesView.tsx`)
- Utilities: camelCase (e.g., `geminiService.ts`)
- Routes: kebab-case (e.g., `general-settings.ts`)

## Important Notes

- **Path aliases**: `@/` maps to project root (Vite + TypeScript config)
- **CDN dependencies**: React, Recharts
- **Test accounts**: admin/password, manager/password, user/password
- **No automated tests**: Manual testing only
- **Ports**: Frontend 3000, Backend 3001, PostgreSQL 5432
- **Remote Testing**: App runs on remote Docker containers - do not run commands locally for testing
- **Docs**: Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.
