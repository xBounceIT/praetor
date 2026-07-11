---
title: Get started
description: Sign-in, navigation, and initial settings for working in Praetor.
sidebar:
  order: 1
---

## Sign in

Sign in with the credentials provided by your administrator. If your company uses LDAP or single sign-on, you may be redirected to the company identity provider before entering the platform.

If the session stays idle for too long, Praetor asks you to sign in again. This protects open sessions from unauthorized use.

## Navigation

The sidebar groups the main modules. Available items depend on your role:

- **Timesheets** for time entries and recurring tasks.
- **CRM** for customers and suppliers.
- **Catalog** for the internal listing.
- **Sales** for quotes and offers.
- **Accounting** for orders and invoices.
- **Projects** for tasks, customers, and progress.
- **HR** for employee profiles, operational details, and competence centers.
- **Reports** for analysis and AI reporting.
- **Administration** for configuration and audit.

## Table views and sharing

Most lists in Praetor (projects, tasks, customers, suppliers, accounting documents, users) use a shared table where you can show or hide columns, sort, and apply filters. You can save a combination as a **named view** to recall it later.

Use the handle in a column header to drag that column into position; with the keyboard, use the left and right arrow keys on the same handle. **Reset columns** restores both the default visibility and order. An unsaved manual order is temporary, while a named view preserves and shares the column order together with visibility, data sorting, and filters.

Named views are stored on the server and owned by whoever creates them, so they stay available from any device and can be shared. The owner can **share** a view with specific users, granting each one **read** access (apply only) or **write** access (edit, rename, and re-save it — and the change then applies to everyone the view is shared with). Only the owner can **delete** a view or manage its sharing; read recipients can still **duplicate** it into their own editable copy. Views shared with you show a badge with the author and your access level, and edits made by write recipients propagate the next time you load or apply the view, not in real time.

View-only preferences such as row density, text size, column widths, and which view is active stay local to the browser, and are therefore private to each device.

Shared views are backed by the `GET/POST/PUT/DELETE /api/views/*` endpoints documented in the **API** section. On the development side, a table enables the server-backed, shareable mode only when it receives a stable `viewKey` (for example `projects.directory`): the key namespaces the view and prevents collisions between different tables; tables without a `viewKey` keep saving views in the browser only.

## Personal settings

From the user menu you can open settings, switch role when multiple profiles are available, open this documentation, and log out.

The **Security** tab contains password changes and your personal access token for API use. Changing your password immediately revokes every other active session for your account *and* invalidates every personal access token and MCP token you previously issued: only the device you used to make the change stays signed in, every API integration must be re-keyed with a fresh token, and the operation is recorded in the audit logs. The token inherits your user permissions; copy it when it is created or renewed, because it is shown only in masked form afterward. The token is also rejected after 30 days without use — renew it before it goes idle, or have an administrator adjust the idle window via the `PAT_IDLE_TIMEOUT_MS` server environment variable.

Always check that you are using the right role before changing administrative or accounting data.
