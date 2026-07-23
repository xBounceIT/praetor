---
title: AI reporting
description: How to read AI-assisted reports and interpret answers.
sidebar:
  order: 6
---

## Availability

AI reporting is visible only when enabled by administration and when your role has access permission.

If you do not see the module, ask an administrator to check AI settings, API key, and role permissions.

Administrators can connect AI reporting to Gemini, OpenRouter, Anthropic, or OpenAI. Praetor uses only the provider selected in general settings and stores each provider's key and model separately.

## Conversation history

On desktop, AI Reporting shows conversation history in the left column and the active chat on the right. Chats are ordered by latest activity and grouped by time period.

Use the search field to filter chats by title. Select an item to resume that conversation, or press **New Chat** at the bottom of the history to start a new one.

When you open a conversation, Praetor loads only its most recent messages. Use **Load older messages** to retrieve earlier parts progressively without slowing down the page.

In the browser, only visible messages and a small area above and below the scroll viewport are rendered. Distant content remains as lightweight placeholders and is materialized only as you approach it.

On mobile devices, open the history with the button in the conversation header.

Chat actions are contained in its history row: use the pencil to rename the title, or use the trash button to remove the conversation and confirm the action.

The **Technical info** toggle in the top-right corner shows the provider and model used for the latest response, together with used context tokens, the model's total capacity, and the percentage occupied. For OpenAI and Anthropic, the displayed model always matches the ID configured by the administrator, even when the provider internally returns a versioned slug. Above 80%, a warning appears: a nearly full window can reduce quality or performance, so starting a new chat is recommended. Conversations created before this feature show these details after their next AI response.

## Composer and attachments

The composer floats over the conversation: it stays compact on one line and grows automatically when the text wraps onto additional lines. Press **Enter** to send or **Shift+Enter** to insert a new line.

Use the paperclip button to attach up to 5 text files, including TXT, Markdown, CSV, JSON, XML, YAML, logs, SQL, and common source-code files. Each file can be up to 64 KB, while the combined text content can contain up to 12,000 characters. Files are read in the browser and included in the request sent to AI Reporting. Their contents become an explicit data source for analysis, calculations, and visualizations, while remaining data rather than instructions for the AI.

## Usage limits

To protect provider costs and server capacity, each user can start up to 10 AI generations per minute and run at most 2 generations at the same time. This shared budget covers new messages, streamed messages, and edited-message regeneration. A response is limited to 4,096 output tokens.

When a limit is reached, Praetor returns a `429` response. Wait for an active generation to finish or for the one-minute budget to reset before retrying.

## Available business datasets

For every request, AI Reporting builds a fresh dataset restricted to the view permissions granted to your role. Answers can use these sections:

- **Timesheets** — hours, authorized costs, and distributions by period, location, user, client, project, and task.
- **Clients** — master data and related activity.
- **Projects** — status, active/passive/internal type, client (Internal jobs use Praetor's configured company), optional dates for Internal jobs, revenue, billing, optional linked documents, hours, and authorized costs.
- **Tasks** — recurrence, duration, effort, revenue, billing, and recorded hours.
- **Client quotes** and **client offers** — amounts, statuses, expiry dates, and leading clients.
- **Client orders** and **client invoices** — values, statuses, payments, outstanding amounts, and aging.
- **Suppliers** and **supplier quotes** — master data, activity, and amounts.
- **Supplier orders** and **supplier invoices** — purchasing, payments, outstanding amounts, and aging.
- **Catalog** — products, types, categories, suppliers, and authorized document usage.
- **Resales** — costs, revenue, margin, billing frequencies, categories, and activity release state.

Unauthorized sections are never added to the AI context. When a question targets one area, Praetor loads only the relevant sections; an overview request uses every available section. Document totals for duration-based lines use the displayed value as their multiplier without converting months and years; historical documents retain the calculation contract that was active when they were saved. For quotes with multiple candidates, reporting analyzes the selected candidate or the first active candidate.

Within the client dataset, contact name, email, phone, and address are included only with `crm.clients.view`. Other permissions that make the client section available, such as timesheet, project, or commercial-document permissions, preserve the already authorized client row scope without exposing these master-data details.

Within the supplier dataset, master-data details are included only with `crm.suppliers_all.view`. With a base supplier permission or supplier-document view permission alone, AI Reporting and the `praetor_list_suppliers` MCP tool receive only the supplier identifier, name, and status.

Within the catalog dataset, product counts and classifications follow catalog permissions. Usage metrics include only client documents the role can view: quotes with `sales.client_quotes.view`, orders and their revenue with `accounting.clients_orders.view`, and invoices with `accounting.clients_invoices.view`.

## Interactive visualizations

You can explicitly request a chart, for example “show the monthly trend of hours by project” or “compare revenue for the top five customers.” AI Reporting can answer with bar, line, area, pie, or donut charts and select the shape that best fits the available data.

When a request explicitly asks for a chart, visualization, dashboard, or data report, the assistant uses the built-in renderer instead of substituting a prose-only description or table. If required data is unavailable, it identifies what is missing and asks for clarification without inventing values.

A single response can include up to seven visualizations when multiple charts materially improve the analysis.

In responses with multiple visualizations, each short interpretation appears immediately before its matching chart. During generation, completed charts appear progressively one at a time, while the chart still being built remains represented by a placeholder.

Point at the chart or use keyboard navigation to read values, use the legend when several series are present, and press **Show data** to open the accessible table behind the visualization. **Copy PNG** places the heading, chart, and legend on the clipboard, ready to paste into a document or message. Colors and surfaces automatically adapt to the light or dark theme.

Visualizations use only data included in the conversation's authorized dataset. Praetor validates the structure, size, and values before rendering and safely discards an invalid specification; charts remain a visual aid, so verify important figures against their original sources.

## Recommended use

Ask specific questions: include period, business area, customer, project, or metric you want to analyze. Precise questions produce answers that are easier to verify.

Use results as analytical support, not as a replacement for official data. Before making operational decisions, compare suggestions with tables, documents, and reports available in Praetor.

## Good practices

- Do not enter unnecessary information or sensitive data without context.
- Always verify amounts, dates, and references mentioned in the answer.
- Rephrase the question if the answer is too generic.

## Advanced project data

AI reporting datasets include a project's linked order, offer, and revenue only when the role has the `projects.details.view` permission. Without this permission, project operational data allowed by other permissions remains available, but commercial references and revenue are omitted.

## Cost in reports

Praetor computes each time entry cost as `duration * hourly cost`, using the same currency precision as invoices. The stored hourly cost comes from the employee calendar on the entry date; changing that calendar retroactively updates affected entries and their aggregates.

Cost aggregates per project, client, user, and period are included in AI reporting datasets only when your role has the `reports.cost` permission. Without it:

- The `cost` field is stripped from time entries returned by the API.
- Cost totals and "top by cost" lists are omitted from AI reporting datasets; hours and entry counts remain available.

To grant or revoke cost visibility, edit the role in Administration > Roles and toggle the "Reports > Cost reports" entry.

## MCP Access For External Agents

Praetor exposes a remote MCP endpoint at `/api/mcp` for Model Context Protocol compatible agents. Agents must authenticate with a personal MCP token created from Settings > MCP.

The token is shown only once when it is created. Praetor stores only a hash, so revoke and recreate the token if it is lost.

Creating and revoking MCP tokens requires an active interactive session: sign in to Praetor in the browser to perform either operation. Personal access tokens (PATs) cannot create or revoke MCP tokens.

> Upgrade note: the release that introduces cryptographic key separation (issue #416) changes the HMAC key used for MCP-token hashes. After the upgrade, existing MCP tokens stop working and must be regenerated from Settings > MCP.

MCP tools always respect the permissions of your current role. The first release includes tools for the current user, users and hierarchy, clients, suppliers, projects, tasks, quotes, offers, orders, invoices, time entries, and notifications.

Each MCP token is created with a **scope**:

- **Full access** — the token can call any tool your role grants, including write tools (create / update / delete).
- **Read-only** — the token can only call tools that map to `*.view` permissions. Write tools return "Insufficient permissions" even if your role has write access.

Configure the MCP client with the endpoint URL and this header:

```text
Authorization: Bearer praetor_mcp_...
```

Use these steps to connect an external agent:

1. Open Settings > MCP.
2. Create a token with a recognizable name, such as the agent or device name. Pick **Read-only** if the agent only needs to read data; pick **Full access** if it needs to create or update entries.
3. Copy the token immediately; it will not be shown again.
4. Use the displayed MCP Server URL field for the exact endpoint, usually `https://your-praetor-host/api/mcp`.
5. Copy the Agent Setup Prompt if you want an AI agent to configure the server automatically.
6. Configure the MCP client with the endpoint URL and bearer token header above.
7. Revoke old or unused tokens from Settings > MCP.

Supported tools:

- `praetor_get_current_user`
- `praetor_get_users_hierarchy`
- `praetor_list_clients`
- `praetor_list_suppliers`
- `praetor_list_projects`
- `praetor_list_tasks`
- `praetor_list_quotes`
- `praetor_list_offers`
- `praetor_list_orders`
- `praetor_list_invoices`
- `praetor_list_time_entries`
- `praetor_create_time_entry`
- `praetor_update_time_entry`
- `praetor_delete_time_entry`
- `praetor_bulk_create_time_entries`
- `praetor_bulk_update_time_entries`
- `praetor_bulk_delete_time_entries`
- `praetor_list_notifications`
- `praetor_mark_notification_read`
- `praetor_delete_notification`

Bulk time-entry tools accept up to 100 items per call. They process each item independently and return a summary with per-item successes and errors.

Time-entry update tools require the `version` field returned by `praetor_list_time_entries`. If the entry changed after it was read, the update returns a conflict error and the agent should read the entry list again before retrying.

Security notes:

- MCP tokens inherit your current role permissions at call time, filtered by the token's scope (full or read-only).
- Tokens expire automatically after 30 days of inactivity. Operators can override the window with the `MCP_IDLE_TIMEOUT_MS` environment variable (milliseconds).
- Changing your account password also invalidates every MCP token you previously issued. Re-issue and re-key your agents after a password rotation.
- The MCP endpoint is rate-limited at the standard authenticated-route limit (600 requests/minute per client IP); excess requests get a 429 response.
- Store MCP tokens like passwords or API keys.
- Revoke tokens when an agent is retired, a device is lost, or access is no longer needed.
- Time-entry and notification tools can write data; review agent prompts and automation rules before enabling unattended use.
