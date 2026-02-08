# Repository Guidelines

## Project Structure & Module Organization

- Frontend (Vite + React/TS) lives at repo root.
- Entry points: `index.html`, `index.tsx`, `App.tsx`.
- UI modules: `components/` (feature folders like `components/HR/`, shared primitives in `components/shared/`).
- Client-side helpers: `services/` (API + Gemini integration), `utils/`, shared types in `types.ts` and `constants.tsx`.
- Static assets: `public/`, translations in `locales/`.
- Backend API (Fastify + TS) is in `server/`.
- API entry/build: `server/index.ts`, app wiring in `server/app.ts`, routes in `server/routes/`, DB schema/seed in `server/db/`.
- Generated docs are committed under `docs/` (`docs/frontend/`, `docs/api/openapi.json`).

## Build, Test, and Development Commands

- `bun install` (and `cd server && bun install`): install deps.
- `bun run dev`: run frontend dev server (defaults to `http://localhost:3000`).
- `bun run build`: production frontend build to `dist/`.
- `bun run preview`: serve the production build.
- `cd server && bun run dev`: run API with watch.
- `cd server && bun run build`: typecheck/compile API (`tsc`).
- `cd server && bun run start`: run the built API (defaults to `http://localhost:3001`).
- `bun run docs`: generate TypeDoc + OpenAPI into `docs/`.
- `docker compose up -d --build`: run full stack (Postgres/Redis/API/Caddy).

## Coding Style & Naming Conventions

- TypeScript throughout; prefer explicit types at module boundaries.
- Formatting/linting is Biome: 2-space indent, 100 char line width, single quotes, semicolons.
- Use `bun run lint` and `bun run format` (or `bun run lint:fix`) before pushing.
- Naming: React components `PascalCase.tsx`, helpers `camelCase`, constants `SCREAMING_SNAKE_CASE`.

## Testing Guidelines

- No dedicated unit/integration test runner is configured currently.
- Treat `bun run build`, `cd server && bun run build`, and `bun run lint` as the minimum CI-quality gate.
- For changes touching UI flows, do a manual smoke test against `server/index.ts` and key routes under `server/routes/`.
- If you introduce tests, prefer `*.test.ts` / `*.test.tsx` (co-located or under `__tests__/`).

## Commit & Pull Request Guidelines

- Prefer Conventional Commits as seen in history: `feat:`, `fix(scope):`, `refactor:`, `docs:`, `perf:`.
- Husky pre-commit runs build, server build, docs generation, lint-staged, and lint. Expect `docs/` and `bun.lock` to update and be staged.
- PRs should include: what/why, screenshots for UI changes, and notes for any DB/schema/migration changes in `server/db/`.

## Security & Configuration Tips

- Do not commit secrets. Use `.env.example` and `server/.env.example` as templates.
- If running frontend + API locally (not via Docker), set `VITE_API_URL=http://localhost:3001/api` and set `FRONTEND_URL` to match your dev server origin.
