# Repository Guidelines

## Project Structure & Module Organization

- Frontend (Vite + React/TS) lives at the repo root: app entry in `index.tsx` / `App.tsx`, UI in `components/` (feature folders + a `shared/` primitives folder), client helpers in `services/` and `utils/`, static assets in `public/`, translations in `locales/`.
- Backend (Fastify + TS) lives under `server/`: app wiring in `server/app.ts`, HTTP routes in `server/routes/`, data access in `server/repositories/`, schema and migrations under `server/db/`.
- Generated docs are committed under `docs/` (frontend TypeDoc + API OpenAPI).

## Build, Test, and Development Commands

- `bun install` (and `cd server && bun install`): install deps.
- `bun run dev`: run the frontend dev server.
- `bun run build`: production frontend build to `dist/`.
- `bun run preview`: serve the production build.
- `bun run test`: run the Bun test suites.
- `bun run lint`: i18n-key check + typecheck + Biome (in that order). `bun run lint:fix` and `bun run format` apply Biome auto-fixes / formatting.
- `cd server && bun run dev`: run the API with watch.
- `cd server && bun run build`: typecheck/compile the API (`tsc`).
- `cd server && bun run start`: run the built API.
- `bun run docs`: regenerate TypeDoc + OpenAPI under `docs/`.
- `docker compose up -d --build`: bring up the full stack (see `docker-compose.yml` for the current service set).

## Coding Style & Naming Conventions

- TypeScript throughout; prefer explicit types at module boundaries.
- Formatting/linting is Biome: 2-space indent, 100 char line width, single quotes, semicolons.
- Use `bun run lint` and `bun run format` (or `bun run lint:fix`) before pushing.
- Naming: React components `PascalCase.tsx`, helpers `camelCase`, constants `SCREAMING_SNAKE_CASE`.

## Testing Guidelines

- Bun test runner. Backend repository-layer suites live under `server/test/` (fakes; no DB). Run via `bun run test` from the repo root.
- Other layers (UI flows, end-to-end route behavior) still rely on manual testing.
- Treat `bun run lint` (which also runs typecheck and the i18n key check) and `bun run build` as the minimum CI-quality gate.
- New backend tests should live under `server/test/`, mirroring the source layout.

## Commit & Pull Request Guidelines

- Prefer Conventional Commits as seen in history: `feat:`, `fix(scope):`, `refactor:`, `docs:`, `perf:`.
- Husky runs `lint-staged` plus a typecheck on pre-commit. Expect Biome auto-fixes to be staged. Generated `docs/` and `bun.lock` may also need to be staged when a PR touches APIs or dependencies.
- PRs should include: what/why, screenshots for UI changes, and notes for any DB/schema/migration changes in `server/db/`.

## Security & Configuration Tips

- Do not commit secrets. Use `.env.example` and `server/.env.example` as templates.
- If running frontend + API locally (not via Docker), set `VITE_API_URL=http://localhost:3001/api` and set `FRONTEND_URL` to match your dev server origin.
