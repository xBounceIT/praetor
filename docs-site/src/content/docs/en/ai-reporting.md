---
title: AI reporting
description: How to read AI-assisted reports and interpret answers.
sidebar:
  order: 5
---

## Availability

AI reporting is visible only when enabled by administration and when your role has access permission.

If you do not see the module, ask an administrator to check AI settings, API key, and role permissions.

## Recommended use

Ask specific questions: include period, business area, customer, project, or metric you want to analyze. Precise questions produce answers that are easier to verify.

Use results as analytical support, not as a replacement for official data. Before making operational decisions, compare suggestions with tables, documents, and reports available in Praetor.

## Good practices

- Do not enter unnecessary information or sensitive data without context.
- Always verify amounts, dates, and references mentioned in the answer.
- Rephrase the question if the answer is too generic.

## MCP Access For External Agents

Praetor exposes a remote MCP endpoint at `/api/mcp` for Model Context Protocol compatible agents. Agents must authenticate with a personal MCP token created from Settings > MCP Tokens.

The token is shown only once when it is created. Praetor stores only a hash, so revoke and recreate the token if it is lost.

MCP tools always respect the permissions of your current role. The first release includes tools for the current user, users and hierarchy, clients, suppliers, projects, tasks, time entries, notifications, and the AI reporting dataset.

Configure the MCP client with the endpoint URL and this header:

```text
Authorization: Bearer praetor_mcp_...
```

Use these steps to connect an external agent:

1. Open Settings > MCP Tokens.
2. Create a token with a recognizable name, such as the agent or device name.
3. Copy the token immediately; it will not be shown again.
4. Use the displayed MCP Server URL field for the exact endpoint, usually `https://your-praetor-host/api/mcp`.
5. Copy the Agent Setup Prompt if you want an AI agent to configure the server automatically.
6. Configure the MCP client with the endpoint URL and bearer token header above.
7. Revoke old or unused tokens from Settings > MCP Tokens.

Supported tools:

- `praetor_get_current_user`
- `praetor_get_users_hierarchy`
- `praetor_list_clients`
- `praetor_list_suppliers`
- `praetor_list_projects`
- `praetor_list_tasks`
- `praetor_list_time_entries`
- `praetor_create_time_entry`
- `praetor_update_time_entry`
- `praetor_delete_time_entry`
- `praetor_list_notifications`
- `praetor_mark_notification_read`
- `praetor_delete_notification`
- `praetor_get_reporting_dataset`

Security notes:

- MCP tokens inherit your current role permissions at call time.
- Store MCP tokens like passwords or API keys.
- Revoke tokens when an agent is retired, a device is lost, or access is no longer needed.
- Time-entry and notification tools can write data; review agent prompts and automation rules before enabling unattended use.
