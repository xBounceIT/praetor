## Project Overview

Praetor is a modern, AI-enhanced ERP (Enterprise Resource Planning) application designed for time tracking, project management, CRM, and financial operations. It features a React-based SPA frontend with a Node.js/Fastify backend API, backed by PostgreSQL.

The application supports:
- **Timesheets**: Smart time entry with natural language processing (AI-powered), recurring tasks, weekly/daily views
- **CRM**: Client management, quotes, sales tracking
- **Projects**: Hierarchical project and task management with user assignments
- **Finances**: Invoices, payments, expenses, and financial reporting
- **Catalog**: Product management with supplier integration
- **Suppliers**: Supplier management and quote tracking

## Technology Stack

### Frontend
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

## Project Structure

```
praetor/
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
```

## Build and Development Commands

### Frontend
```bash
# Development server (port 3000)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
```

### Backend
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
```

## Code Style Guidelines

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

## Database Architecture

### Core Tables
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
