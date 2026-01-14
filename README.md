
# Praetor

Praetor is a modern, AI-enhanced time tracking application inspired by the simplicity of tools like Anuko Time Tracker. It streamlines the process of logging work hours, categorizing tasks, and generating insightful reports using a clean, responsive interface and powerful AI capabilities.

## Features

- **Smart Time Entry**: Log time using natural language (e.g., "2 hours on Frontend for Acme") powered by Google Gemini AI.
- **Robust Reporting**:
  - **Dashboard**: High-level overview with bar charts for weekly activity and pie charts for project distribution.
  - **Detailed Reports**: Filter by Date Range, Client, Project, Task, and User. 
  - **Visualizations**: Interactive charts built with Recharts.
- **Role-Based Access Control (RBAC)**:
  - **Admin**: Full system access, user management, authentication settings.
  - **Manager**: Access to all user reports and project/client management.
  - **User**: Personal time tracking and reporting.
- **Hierarchical Management**: Manage Clients, Projects, and Tasks with dependency filtering.
- **Recurring Tasks**: Automate time entry placeholders for daily, weekly, or monthly tasks.
- **AI Coach**: Receive personalized productivity insights and pattern analysis.
- **Authentication**: Built-in credential system with a UI for configuring LDAP/Active Directory integration.

## Tech Stack

- **Frontend**: React 19, TypeScript
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **AI Integration**: Google Gemini API (`@google/genai`)
- **Icons**: FontAwesome

## Setup & Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/xBounceIT/praetor
   cd praetor
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   The application requires a Google Gemini API key to function fully (Smart Entry & AI Coach).
   
   Ensure the `API_KEY` environment variable is set in your environment.
   
   *Example `.env` (if using a build tool like Vite):*
   ```
   API_KEY=your_google_gemini_api_key
   ```

4. **Run Locally**
   ```bash
   npm run dev
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
  
- **Tracking Time**: Navigate to the "Time Tracker" view. You can manually select clients/projects or toggle "Magic Input" to type a sentence describing your work.

- **Reports**: Go to the "Reports" view. Use the animated tabs to switch between the graphical Dashboard and the Detailed List view. Managers can filter by specific users.

- **Settings**: Click your avatar in the top right to access user profile settings, daily goals, and UI preferences.
