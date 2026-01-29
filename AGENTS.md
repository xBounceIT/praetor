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

## Technology Stack

### Frontend

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

## Project Structure

```
praetor/
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
```

## Build and Development Commands

### Frontend

```bash
# Install dependencies
npm install

# Start development server (port 3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code with Prettier
npm run format
```

### Backend

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
```

## Code Style Guidelines

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

## Database Architecture

### Core Tables

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
