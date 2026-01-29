<<<<<<< HEAD
## Project Overview

Praetor is a modern, AI-enhanced ERP (Enterprise Resource Planning) application designed for time tracking, project management, CRM, and financial operations. It features a React-based SPA frontend with a Node.js/Fastify backend API, backed by PostgreSQL.

The application supports:
- **Timesheets**: Smart time entry with natural language processing (AI-powered), recurring tasks, weekly/daily views
- **CRM**: Client management, quotes, sales tracking
- **Projects**: Hierarchical project and task management with user assignments
- **Finances**: Invoices, payments, expenses, and financial reporting
- **Catalog**: Product management with supplier integration
- **Suppliers**: Supplier management and quote tracking
=======
# Praetor - AI Coding Agent Guide

## Project Overview

Praetor is a modern, AI-enhanced ERP (Enterprise Resource Planning) application for time tracking and business management. It is inspired by tools like Anuko Time Tracker and features AI-powered productivity insights through Google Gemini integration.

### Key Features

- **Smart Time Entry**: Natural language time logging (e.g., "2 hours on Frontend for Acme") using Google Gemini AI
- **Role-Based Access Control**: Three-tier system (Admin, Manager, User) with hierarchical permissions
- **Business Modules**:
  - Timesheets: Time tracking with daily/weekly views, recurring tasks
  - CRM: Client management with quotes and sales
  - Catalog: Product and special bid management
  - Projects: Project and task hierarchy
  - Finances: Invoices, payments, expenses, and financial reports
  - Suppliers: Supplier management and supplier quotes
  - Configuration: User management, authentication (LDAP/Local), general settings
- **Internationalization**: English and Italian language support
- **Reporting**: Dashboard with Recharts visualizations and detailed reports
>>>>>>> 3340c69a3d9090bfc63fa4a6c7d9a0a71260d77e

## Technology Stack

### Frontend
<<<<<<< HEAD
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 6
- **Styling**: Tailwind CSS (loaded via CDN in production)
- **Icons**: FontAwesome 6 (CDN)
- **Charts**: Recharts
- **Internationalization**: i18next with react-i18next
- **Language Support**: English (en), Italian (it)

### Backend
- **Framework**: Fastify 5 with HTTP/2 support
- **Language**: TypeScript (compiled with `tsc`)
- **Database**: PostgreSQL 17 (via `pg` driver)
- **Authentication**: JWT with bcryptjs
- **LDAP**: ldapjs for Active Directory integration
- **Development**: tsx for hot reload

### AI Integration
- **Provider**: Google Gemini API via `@google/genai`
- **Features**: Smart time entry parsing, productivity insights/coaching

### Infrastructure
- **Web Server**: Caddy (reverse proxy + static file serving)
- **Containerization**: Docker & Docker Compose
- **Process Manager**: Built-in Node.js for backend
=======

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 6
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **State Management**: React hooks (useState, useEffect, useCallback, useMemo)
- **HTTP Client**: Native fetch API
- **Authentication**: JWT tokens with sliding window refresh
- **Icons**: FontAwesome
- **Internationalization**: i18next with react-i18next

### Backend

- **Runtime**: Node.js with TypeScript
- **Framework**: Fastify 5 with HTTP/2 support
- **Database**: PostgreSQL 17
- **Authentication**: JWT with bcryptjs for password hashing
- **LDAP Integration**: ldapjs for Active Directory/LDAP authentication
- **Development**: tsx for hot-reload development

### AI Integration

- **Provider**: Google Gemini API via `@google/genai`
- **Model**: gemini-3-flash-preview
- **Features**: Natural language parsing for time entries, productivity insights
>>>>>>> 3340c69a3d9090bfc63fa4a6c7d9a0a71260d77e

## Project Structure

```
praetor/
<<<<<<< HEAD
├── App.tsx                 # Main application component
├── index.tsx               # Entry point
├── types.ts                # Shared TypeScript interfaces
├── constants.tsx           # Default data (users, clients, projects, colors)
├── i18n.ts                 # Internationalization configuration
├── components/             # React components (36 views)
│   ├── Layout.tsx          # Main layout with navigation
│   ├── Login.tsx           # Authentication
│   ├── TimeEntryForm.tsx   # Time tracking
│   ├── Reports.tsx         # Reporting dashboard
│   ├── *View.tsx           # Various management views
│   └── ...
├── services/               # Frontend services
│   ├── api.ts              # REST API client
│   └── geminiService.ts    # Google Gemini AI integration
├── utils/                  # Utility functions
│   ├── holidays.ts         # Italian holiday calculations
│   ├── numbers.ts          # Number formatting
│   └── theme.ts            # Theme management
├── locales/                # Translation files
│   ├── en/                 # English translations
│   └── it/                 # Italian translations
├── server/                 # Backend API
│   ├── index.ts            # Server entry point
│   ├── package.json        # Server dependencies
│   ├── Dockerfile          # Server container image
│   ├── middleware/
│   │   └── auth.ts         # JWT authentication middleware
│   ├── routes/             # API route handlers (20+ modules)
│   ├── services/
│   │   └── ldap.ts         # LDAP/AD service
│   ├── db/
│   │   ├── index.ts        # Database connection pool
│   │   ├── schema.sql      # Database schema (671 lines)
│   │   ├── seed.sql        # Initial seed data
│   │   └── *.ts            # Migration scripts
│   └── types/
│       └── fastify.d.ts    # Fastify type extensions
├── docker-compose.yml      # Docker orchestration
├── Dockerfile              # Frontend container image
├── Caddyfile               # Caddy web server configuration
└── vite.config.ts          # Vite build configuration
=======
├── components/          # React components (flat structure)
│   ├── Layout.tsx      # Main layout with sidebar navigation
│   ├── Login.tsx       # Authentication component
│   ├── Reports.tsx     # Reporting dashboard
│   ├── TimeEntryForm.tsx
│   └── ...             # Other view components
├── services/           # API and external service integrations
│   ├── api.ts          # REST API client with normalization helpers
│   └── geminiService.ts # Google Gemini AI integration
├── utils/              # Utility functions
│   ├── holidays.ts     # Italian holiday calculations
│   ├── numbers.ts      # Number formatting utilities
│   └── theme.ts        # Theme management (light/dark/system)
├── locales/            # i18n translation files
│   ├── en/             # English translations
│   └── it/             # Italian translations
├── server/             # Backend API server
│   ├── index.ts        # Fastify server setup and startup
│   ├── routes/         # API route handlers
│   ├── middleware/     # Authentication middleware
│   ├── services/       # LDAP service
│   ├── db/             # Database schema, migrations, and connection
│   └── types/          # TypeScript type declarations
├── types.ts            # Shared TypeScript types (frontend/backend)
├── constants.tsx       # Default data and constants
├── i18n.ts             # i18next configuration
├── App.tsx             # Main application component
├── index.tsx           # React application entry point
└── vite.config.ts      # Vite configuration
>>>>>>> 3340c69a3d9090bfc63fa4a6c7d9a0a71260d77e
```

## Build and Development Commands

### Frontend
<<<<<<< HEAD
```bash
# Development server (port 3000)
npm run dev

# Production build
=======

```bash
# Install dependencies
npm install

# Start development server (port 3000)
npm run dev

# Build for production
>>>>>>> 3340c69a3d9090bfc63fa4a6c7d9a0a71260d77e
npm run build

# Preview production build
npm run preview

<<<<<<< HEAD
# Linting
npm run lint
npm run lint:fix

# Formatting
=======
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code with Prettier
>>>>>>> 3340c69a3d9090bfc63fa4a6c7d9a0a71260d77e
npm run format
```

### Backend
<<<<<<< HEAD
```bash
cd server

# Development with hot reload
npm run dev

# Production build
npm run build

# Start production server
npm run start
```

### Docker (Full Stack)
```bash
# Copy environment template
cp .env.example .env

# Build and start all services
docker compose up -d --build

# Services:
# - Frontend: http://localhost:3000 (Caddy)
# - Backend API: http://localhost:3001 (Fastify)
# - PostgreSQL: port 5432
=======

```bash
cd server/

# Install dependencies
npm install

# Development with hot-reload (requires local PostgreSQL)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### Docker (Full Stack)

```bash
# Copy environment configuration
cp .env.example .env
# Edit .env with your settings

# Build and start all services (PostgreSQL, Backend, Frontend)
docker compose up -d --build

# Services:
# - Frontend: http://localhost:3000 (Caddy server)
# - Backend API: http://localhost:3001 (internal)
# - PostgreSQL: port 5432 (internal)
>>>>>>> 3340c69a3d9090bfc63fa4a6c7d9a0a71260d77e
```

## Code Style Guidelines

<<<<<<< HEAD
### TypeScript/JavaScript
- **Target**: ES2022
- **Module**: ESNext with `type: "module"`
- **Strict mode**: Enabled
- **Quote style**: Single quotes
- **Semicolons**: Required
- **Trailing commas**: All
- **Print width**: 100 characters
- **Tab width**: 2 spaces

### React
- Functional components with hooks
- Props destructuring in component parameters
- Use `useTranslation()` hook for i18n
- Theme variables via CSS custom properties

### File Naming
- Components: PascalCase (e.g., `TimeEntryForm.tsx`)
- Utilities: camelCase (e.g., `geminiService.ts`)
- Routes: kebab-case (e.g., `general-settings.ts`)

### ESLint Configuration
- TypeScript ESLint recommended
- React hooks rules
- React refresh rules
- Prettier integration
- Unused vars ignored with `_` prefix

### Pre-commit Hooks
- Husky + lint-staged
- Auto-fix ESLint issues
- Auto-format with Prettier
=======
### TypeScript

- **Target**: ES2022
- **Strict mode**: Enabled
- **Module system**: ESNext with NodeNext resolution (backend), bundler (frontend)
- **File extensions**: Use `.ts` and `.tsx` with explicit extensions in imports

### Formatting (Prettier)

```json
{
  "semi": true,
  "tabWidth": 2,
  "printWidth": 100,
  "singleQuote": true,
  "trailingComma": "all",
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "auto"
}
```

### ESLint Configuration

- Extends: `@eslint/js`, `typescript-eslint`, `react`, `react-hooks`, `prettier`
- Key rules:
  - `@typescript-eslint/no-unused-vars`: warn with `^_` ignore pattern
  - `@typescript-eslint/no-explicit-any`: warn (avoid `any` when possible)
  - `react-refresh/only-export-components`: warn with constant export allowed
  - `react-hooks/*`: All recommended hooks rules enabled

### React Conventions

- Functional components with hooks
- Props interfaces named with `Props` suffix (e.g., `LayoutProps`)
- Event handlers prefixed with `on` (e.g., `onViewChange`)
- Callback props prefixed with `on` for parent notification
- Use `useMemo` for expensive computations
- Use `useCallback` for stable function references

### Import Organization

1. React and external libraries
2. Internal types and constants
3. Services and utilities
4. Components

## Testing Strategy

This project currently relies on:

- **Linting**: ESLint for code quality
- **Type Checking**: TypeScript strict mode for compile-time validation
- **Pre-commit Hooks**: Husky with lint-staged for automated checks

### Pre-commit Hook

```bash
# .husky/pre-commit
npx lint-staged
```

Runs on staged files:
- `*.{js,jsx,ts,tsx}`: ESLint --fix + Prettier --write
- `*.{json,md,css}`: Prettier --write

## Authentication and Security

### JWT Authentication

- **Token expiry**: 30 minutes (idle timeout)
- **Max session duration**: 8 hours
- **Sliding window**: New token issued on each request to reset idle timer
- **Storage**: localStorage for token persistence

### Role-Based Access Control

| Role | Permissions |
|------|-------------|
| `admin` | Full system access, user management, LDAP configuration, general settings |
| `manager` | Access to CRM, Catalog, Finances, Suppliers, all user reports, project management |
| `user` | Personal time tracking, own reports, personal settings |

### LDAP/Active Directory Integration

- Configurable via Admin > Authentication settings
- Periodic sync (every hour) for user provisioning
- Role mapping from LDAP groups to Praetor roles
- Supports TLS/SSL certificates for secure connections
>>>>>>> 3340c69a3d9090bfc63fa4a6c7d9a0a71260d77e

## Database Architecture

### Core Tables
<<<<<<< HEAD
- **users**: User accounts with role-based access (admin/manager/user)
- **clients**: Customer/company information with VAT/tax details
- **projects**: Projects linked to clients
- **tasks**: Tasks linked to projects, supports recurring patterns
- **time_entries**: Time tracking records
- **work_units**: Team/department management
- **products**: Catalog items with cost/pricing
- **quotes/sales/invoices**: Sales workflow
- **payments/expenses**: Financial tracking
- **suppliers**: Vendor management

### Associations (Many-to-Many)
- `user_clients`, `user_projects`, `user_tasks`: User access control
- `user_work_units`: Team membership
- `work_unit_managers`: Team leadership

### Key Features
- Soft deletes via `is_disabled` columns
- UUID primary keys (varchar(50))
- Decimal precision for currency (DECIMAL(15,6))
- JSONB for flexible data (role_mappings)
- Automatic migrations on server startup

## Authentication & Security

### JWT Implementation
- Algorithm: HS256
- Access token expiry: 30 minutes (idle timeout)
- Max session duration: 8 hours
- Sliding window refresh (new token on each request)
- Token stored in `localStorage` on frontend

### Role-Based Access Control (RBAC)
- **admin**: Full system access, user management, authentication settings
- **manager**: All user reports, project/client management
- **user**: Personal time tracking and reporting

### LDAP/Active Directory
- Configurable via UI
- Automatic user synchronization (hourly)
- Role mapping from LDAP groups
- Falls back to local authentication

### Security Headers
- CORS configured per environment
- HTTP/2 with Caddy reverse proxy

## Testing Instructions

This project does not have automated test suites configured. Testing is manual:

1. **Local Development**:
   ```bash
   npm run dev
   ```

2. **Default Test Accounts**:
   - Admin: `admin` / `password`
   - Manager: `manager` / `password`
   - User: `user` / `password`

3. **Docker Testing**:
   ```bash
   docker compose up -d --build
   ```

## Deployment Process

### Environment Variables

**Frontend Build Args**:
- `VITE_API_URL`: Backend API base URL (default: `/api`)
- `APP_VERSION`: Application version

**Backend Environment**:
- `PORT`: Server port (default: 3001)
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`: PostgreSQL connection
- `JWT_SECRET`: Secret for JWT signing
- `FRONTEND_URL`: CORS origin

**Docker Compose**:
- `SERVER_IP`: Public IP or domain
- `POSTGRES_*`: Database credentials
- `JWT_SECRET`: Application secret

### Production Deployment

1. **Using Docker Compose** (Recommended):
   ```bash
   cp .env.example .env
   # Edit .env with production values
   docker compose up -d --build
   ```

2. **Architecture**:
   - Caddy serves static frontend files
   - API requests proxied to backend via h2c (HTTP/2 cleartext)
   - Backend connects to PostgreSQL
   - Automatic SSL via Caddy (if configured with domain)

### Database Migrations

Migrations run automatically on server startup via `server/index.ts`. Migration scripts are in `server/db/`:
- TypeScript migrations for data transformations
- SQL schema updates via `schema.sql` (idempotent)

## Internationalization

- **Languages**: English, Italian
- **Namespaces**: common, layout, auth, timesheets, crm, hr, projects, finances, suppliers, settings, notifications
- **Detection**: Query string (`?lng=it`) or browser language
- **Fallback**: English

## AI Integration

### Smart Time Entry
- Natural language parsing (e.g., "2 hours on Frontend for Acme")
- Model: `gemini-3-flash-preview`
- Returns structured: `{ project, task, duration, notes }`

### AI Coach
- Productivity insights based on time entries
- Pattern analysis and recommendations

### Configuration
- API key stored in `general_settings.gemini_api_key`
- Can be enabled/disabled per user

## Important Development Notes

1. **IDE Environment**: Windows (do not use Linux commands)
2. **Remote Testing**: App runs on remote Docker containers - do not run commands locally for testing
3. **Database Compatibility**: All schema changes must be backward compatible with existing Docker containers
4. **Path Aliases**: `@/` maps to project root (configured in Vite and TypeScript)
5. **CDN Dependencies**: React, Recharts, Google GenAI loaded via esm.sh in production
6. **Tailwind**: Loaded via CDN - no build step required for styles

## Troubleshooting

- **Port conflicts**: Frontend (3000), Backend (3001), Postgres (5432)
- **Database connection**: Check `DB_HOST` environment variable
- **JWT issues**: Verify `JWT_SECRET` is consistent
- **LDAP sync**: Check logs for hourly sync status
=======

- `users`: User accounts with role, cost per hour, authentication
- `clients`: Client/company information with extended details (VAT, tax code, etc.)
- `projects`: Projects linked to clients with color coding
- `tasks`: Tasks linked to projects, supports recurring tasks
- `time_entries`: Time tracking records with user, date, duration, cost
- `work_units`: Organizational units with manager associations

### Business Tables

- `products`: Product/service catalog with pricing and categories
- `quotes` / `quote_items`: Customer quotes with line items
- `sales` / `sale_items`: Sales orders linked to quotes
- `invoices` / `invoice_items`: Billing documents
- `payments`: Payment records linked to invoices
- `expenses`: Company expense tracking
- `suppliers` / `supplier_quotes`: Supplier management
- `special_bids`: Customer-specific pricing agreements
- `notifications`: User notification system

### Association Tables

- `user_clients`, `user_projects`, `user_tasks`: User access restrictions
- `user_work_units`: Work unit membership
- `work_unit_managers`: Manager assignments

### Migration Strategy

Migrations run automatically on server startup in `server/index.ts`:
1. Schema application (`schema.sql`)
2. Data migrations (TypeScript files in `server/db/`)
3. Seed data (`seed.sql`)

## API Architecture

### Base URL

- Development: `http://localhost:3001/api`
- Production: `/api` (proxied through Caddy)

### Response Normalization

All API responses go through normalization helpers in `services/api.ts` to ensure numeric types are properly converted from PostgreSQL decimal strings.

### Route Structure

```
/api/auth/*          # Authentication (login, me)
/api/users/*         # User management
/api/clients/*       # Client CRUD
/api/projects/*      # Project CRUD
/api/tasks/*         # Task CRUD with user assignments
/api/entries/*       # Time entries
/api/settings/*      # User settings
/api/general-settings/* # System settings
/api/ldap/*          # LDAP configuration
/api/products/*      # Product catalog
/api/quotes/*        # Customer quotes
/api/sales/*         # Sales orders
/api/invoices/*      # Invoicing
/api/payments/*      # Payment tracking
/api/expenses/*      # Expense tracking
/api/suppliers/*     # Supplier management
/api/supplier-quotes/* # Supplier quotes
/api/special-bids/*  # Special pricing
/api/notifications/* # User notifications
/api/work-units/*    # Organizational units
```

## Environment Configuration

### Frontend (Build-time)

```bash
VITE_API_URL=/api           # API base URL
VITE_APP_VERSION=1.0.0      # App version (from package.json)
VITE_BUILD_DATE=20260127    # Build date in yyyymmdd format
```

### Backend

```bash
# Server
PORT=3001
FRONTEND_URL=http://localhost:5173

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=tempo
DB_USER=tempo
DB_PASSWORD=tempo

# Security
JWT_SECRET=change-in-production

# LDAP (optional)
LDAP_TLS_CA_FILE=/path/to/ca.crt
LDAP_TLS_CERT_FILE=/path/to/client.crt
LDAP_TLS_KEY_FILE=/path/to/client.key
LDAP_REJECT_UNAUTHORIZED=false
```

### Docker Compose

```bash
SERVER_IP=localhost
POSTGRES_USER=praetor
POSTGRES_PASSWORD=praetor
POSTGRES_DB=praetor
JWT_SECRET=change-in-production
```

## Development Notes

### Adding New Features

1. **Types**: Add shared types to `/types.ts`
2. **API**: Add endpoints to `server/routes/` and client methods to `services/api.ts`
3. **Components**: Create React components in `components/`
4. **Navigation**: Update `Layout.tsx` for new routes
5. **Translations**: Add keys to `locales/en/` and `locales/it/`
6. **Database**: Add migrations to `server/db/` if schema changes required

### Key Utilities

- `getTheme()` / `applyTheme()`: Theme management
- `isItalianHoliday()`: Holiday detection for Italian calendar
- Number normalization: Always use normalization helpers for API data
- `COLORS`: Predefined color palette for UI consistency

### Common Pitfalls

- PostgreSQL returns decimals as strings - always normalize numeric fields
- Token expiry is handled via sliding window - check `x-auth-token` header
- LDAP configuration requires server restart to take effect
- Database migrations run automatically - ensure idempotency

## Default Credentials (Development)

| Username | Password | Role    |
|----------|----------|---------|
| admin    | password | Admin   |
| manager  | password | Manager |
| user     | password | User    |

**Important**: Change default passwords before production deployment.

## Deployment Checklist

- [ ] Change default user passwords
- [ ] Set strong `JWT_SECRET`
- [ ] Configure PostgreSQL credentials
- [ ] Set `SERVER_IP` to public IP/domain
- [ ] Configure LDAP if needed
- [ ] Set up SSL/TLS certificates
- [ ] Review and configure firewall rules
- [ ] Enable PostgreSQL backups
>>>>>>> 3340c69a3d9090bfc63fa4a6c7d9a0a71260d77e
