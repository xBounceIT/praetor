
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
- **Backend**: Fastify (API), Redis (cache)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **AI Integration**: Gemini/OpenRouter via server-side provider calls (AI Reporting).
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

### Docker

You can containerize the application using Nginx to serve the static files:

```bash
cp .env.example .env

docker compose up -d --build
```

## Usage Guide

- **Login**:
  - Default Admin: `admin` / `password`
  - Default Manager: `manager` / `password`
  - Default User: `user` / `password`
  
- **Tracking Time**: Navigate to the "Time Tracker" view and log time entries.

- **Reports**: Go to the "Reports" view. Use the animated tabs to switch between the graphical Dashboard and the Detailed List view. Managers can filter by specific users.

- **Settings**: Click your avatar in the top right to access user profile settings, daily goals, and UI preferences.
