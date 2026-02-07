# AGENTS.md

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

### Docker (full stack)
```bash
docker compose up -d --build    # Build and start all services
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
- Connection pool in `/server/db/index.ts`
- Raw SQL queries with parameterized inputs
- Schema in `/server/db/schema.sql`, migrations in `/server/db/*.ts`
- Snake_case in DB → camelCase in API responses

### Authentication
- JWT (HS256) with optional LDAP/AD fallback
- Roles: admin (full access), manager (CRM/reports), user (personal tracking)
- Middleware: `/server/middleware/auth.ts`

### Internationalization
- i18next with English (en) and Italian (it)
- Translations in `/locales/{en,it}/*.json`
- Namespaces: common, layout, auth, timesheets, crm, hr, projects, finances, suppliers, settings, notifications

## Key Patterns

### Route Organization
Backend routes in `/server/routes/` with prefix-based registration:
- `auth.ts` → `/api/auth`
- `clients.ts` → `/api/clients`
- Pattern: `fastify.get('/', { onRequest: [authenticateToken, requireRole('manager')] }, handler)`

### Component Naming
- Views: PascalCase `*View.tsx` (e.g., `ClientsView.tsx`, `SalesView.tsx`)
- Utilities: camelCase (e.g., `geminiService.ts`)
- Routes: kebab-case (e.g., `general-settings.ts`)

### Types
- Central type definitions in `/types.ts`
- Fastify extensions in `/server/types/fastify.d.ts`

## Important Notes

- **Environment**: Windows - avoid Linux-specific commands
- **Path aliases**: `@/` maps to project root (Vite + TypeScript config)
- **CDN dependencies**: React, Recharts
- **Test accounts**: admin/password, manager/password, user/password
- **No automated tests**: Manual testing only
- **Ports**: Frontend 3000, Backend 3001, PostgreSQL 5432
- **Remote Testing**: App runs on remote Docker containers - do not run commands locally for testing
- **Docs**: Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.
