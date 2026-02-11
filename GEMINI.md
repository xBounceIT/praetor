# Praetor - Project Overview

Praetor is a modern, AI-enhanced ERP (Enterprise Resource Planning) application designed for simplicity and efficiency. It features a comprehensive suite of modules for business management, with a focus on smart time tracking and productivity insights powered by Google Gemini AI.

## Architecture

The project follows a full-stack architecture with a React-based frontend and a Fastify-based backend.

- **Frontend:** A Single Page Application (SPA) built with React 19, TypeScript, and Vite. Styling is handled via Tailwind CSS, and data visualization uses Recharts.
- **Backend:** An API server built with Fastify, using PostgreSQL as the primary relational database and Redis for caching.
- **AI Integration:** Supports AI Reporting (Gemini/OpenRouter, server-side provider calls) for generating insights from business data.
- **Deployment:** Containerized using Docker and Orchestrated via Docker Compose.

## Key Modules

- **Timesheets:** 
    - **Tracker:** Manual time logging.
    - **Recurring Manager:** Automation for recurring tasks.
- **CRM (Customer Relationship Management):** 
    - **Clients:** Manage client details and associations.
    - **Suppliers:** Manage vendor information.
- **Sales & Catalog:**
    - **Client Quotes:** Create and manage sales quotations.
    - **Special Bids:** Client-specific pricing and discounts.
    - **Products Catalog:** Internal and external product listings.
- **Accounting & Finances:**
    - **Clients Orders:** Track orders from clients.
    - **Invoices:** Manage billing and payment status.
    - **Payments:** Record and track payments received.
    - **Expenses:** Log and categorize business expenses.
- **HR (Human Resources):**
    - **Workforce:** Manage internal and external employees.
    - **Work Units:** Hierarchical organizational structure with manager assignments.
- **Administration:**
    - **User Management:** RBAC (Role-Based Access Control) with Admin, Manager, and User roles.
    - **Authentication:** Local credentials and LDAP/Active Directory integration.
    - **Settings:** General system settings, Email configuration (SMTP), and AI provider settings.

## Technology Stack

- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS, Recharts, i18next, Biome.
- **Backend:** Fastify, PostgreSQL (`pg`), Redis, Bun, JWT.
- **Infrastructure:** Docker, Caddy (for serving frontend).

## Development Commands

### Frontend (Root Directory)
- `bun install`: Install dependencies.
- `bun run dev`: Start the Vite development server.
- `bun run build`: Build for production.
- `bun run lint`: Run Biome linter/formatter.
- `bun run docs`: Generate TSDoc and OpenAPI documentation.

### Backend (`server/` Directory)
- `cd server && bun install`: Install backend dependencies.
- `cd server && bun run dev`: Start the Fastify server with hot-reload.
- `cd server && bun run build`: Compile TypeScript to JavaScript.

### Docker
- `docker compose up -d --build`: Build and start the entire stack (Postgres, Redis, Backend, Frontend).

## Key Files & Directories

- `App.tsx`: Main frontend entry point and routing.
- `types.ts`: Shared TypeScript interfaces and types.
- `components/`: UI components organized by functional module (Accounting, CRM, Timesheet, etc.).
- `server/index.ts`: Backend entry point, handling migrations and server startup.
- `server/app.ts`: Fastify application configuration and route registration.
- `server/db/`: SQL schema, seeds, and migration scripts.
- `locales/`: Translation files for Internationalization (English/Italian).

## Development Conventions

- **Typing:** Strict TypeScript usage is encouraged. Common types are centralized in the root `types.ts`.
- **Styling:** Tailwind CSS is used for all UI components.
- **Linting:** Biome is the preferred tool for linting and formatting.
- **Migrations:** Database migrations are handled programmatically on server startup in `server/index.ts`.
- **API:** RESTful API with documentation generated via Swagger.
