
# Praetor

Praetor is a modern, AI-enhanced ERP application inspired by the simplicity of tools like Anuko Time Tracker.

## Features

- **Robust Reporting**:
  - **Dashboard**: High-level overview with bar charts for weekly activity and pie charts for project distribution.
  - **Detailed Reports**: Filter by Date Range, Client, Project, Task, and User. 
  - **Visualizations**: Interactive charts built with Recharts.
  - **AI Reporting**: Chat to generate insights from business data you have access to (admin-controlled).
- **Role-Based Access Control (RBAC)**:
  - **Admin**: Full system access, user management, authentication settings.
  - **Manager**: Access to all user reports and project/client management.
  - **User**: Personal time tracking and reporting.
- **Hierarchical Management**: Manage Clients, Projects, and Tasks with dependency filtering.
- **Recurring Tasks**: Automate time entry placeholders for daily, weekly, or monthly tasks.
- **Authentication**: Built-in credential system with a UI for configuring LDAP/Active Directory integration.

## Tech Stack

- **Frontend**: React 19, TypeScript
- **Backend**: Fastify (API)
- **Database**: PostgreSQL with Drizzle ORM
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **AI Integration**: Gemini, OpenRouter, or Anthropic via server-side provider calls (AI Reporting).
- **Icons**: FontAwesome

## Setup & Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/xBounceIT/praetor
   cd praetor
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Environment Configuration**
   AI Reporting is optional. If you enable it, configure the provider + API key + model in Administration -> General Settings.

4. **Run Locally**
   ```bash
   bun run dev
   ```

## Deployment

### Developer Compose (builds from source)

Use this when you have the repository checked out and want local builds.

```bash
cp .env.example .env
docker compose up -d --build
```

The bundled database now targets fresh PostgreSQL 18 installs and pins `PGDATA` to the
official PG18 container layout. Do not point this compose file at an existing PostgreSQL 17
data volume.

The compose setup defaults backend `TRUST_PROXY=1` for the bundled Caddy -> API hop.
Set `DEMO_SEEDING=true` and a unique `DEMO_USER_PASSWORD` in `.env` when you want the stack to provision the canonical demo users and demo business data. The demo refresh fails before cleaning or reseeding demo data when the password is blank or matches the published legacy default.
That refresh flow is intended for demo and test stacks, owns the canonical demo namespace,
refreshes compatibility clients/projects/tasks, deletes financial documents and dependent
resales backed by demo products, and resets the seeded demo users' assignments, notifications, and time entries so
reused Docker volumes return to the curated demo state. Compatibility clients such as Acme
Corp and Global Tech are not blanket financial-document owners; their documents are removed
only when they use demo data such as demo products or seeded document IDs.
The demo users include HR profile data such as employee codes, departments, contract status, work locations, emergency contacts, and sample internal/external employee records.

To rerun the same refresh manually against an existing backend database:

For this direct-server command, export `DEMO_USER_PASSWORD` in the shell or copy
`server/.env.example` to `server/.env` and set it there. The root `.env` above is read by
Compose, not by a process whose working directory is `server`.

```bash
cd server
bun run seed:demo
```

### Customer Compose (pulls prebuilt images)

Use this when deploying from a container registry (GHCR by default), without cloning source.

```bash
cp deploy/.env.customer.example .env
# edit .env and set PRAETOR_VERSION + secrets

docker compose --env-file .env -f deploy/docker-compose.customer.yml pull
docker compose --env-file .env -f deploy/docker-compose.customer.yml up -d
```

This deployment defaults to PostgreSQL 18 for fresh installs only. The documented `pull` and
`up -d` flow is an application rollout path, not an in-place PostgreSQL major-version upgrade
procedure for an existing volume.

That deployment also defaults backend `TRUST_PROXY=1`; override it if your proxy chain differs.

For complete customer deployment details, see `deploy/README.md`.

### Publishing release images

This repository includes GitHub Actions workflow `create-release.yml` that pushes:

- `ghcr.io/<owner>/praetor-frontend:<version>`
- `ghcr.io/<owner>/praetor-backend:<version>`
- `latest` tags for both images

The workflow runs on `v*` git tags and can also be run manually. The resolved version must use
`vMAJOR.MINOR.PATCH` with an optional `-prerelease` suffix and cannot exceed 128 characters; invalid
values stop the workflow before release creation or registry authentication.

## Usage Guide

- **Login**:
  - Bootstrap Admin: `admin` / unique value of `ADMIN_DEFAULT_PASSWORD`. It is required before a fresh install can create the account; blank and published legacy defaults are rejected. Existing installations with an `admin` account do not need it during upgrades.
  - Demo Manager: `manager` / the configured `DEMO_USER_PASSWORD` when `DEMO_SEEDING=true`
  - Demo User: `user` / the configured `DEMO_USER_PASSWORD` when `DEMO_SEEDING=true`
  
- **Tracking Time**: Navigate to the "Time Tracker" view and log time entries.

- **Reports**: Go to the "Reports" view. Use the animated tabs to switch between the graphical Dashboard and the Detailed List view. Managers can filter by specific users.

- **Settings**: Click your avatar in the top right to access user profile settings, daily goals, and UI preferences.
