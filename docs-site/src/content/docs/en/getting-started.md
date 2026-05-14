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
- **HR** for employees and work units.
- **Reports** for analysis and AI reporting.
- **Administration** for configuration and audit.

## Personal settings

From the user menu you can open settings, switch role when multiple profiles are available, open this documentation, and log out.

The **Security** tab contains password changes and your personal access token for API use. Changing your password immediately revokes every other active session for your account: only the device you used to make the change stays signed in. The token inherits your user permissions; copy it when it is created or renewed, because it is shown only in masked form afterward. The token is also rejected after 30 days without use — renew it before it goes idle, or have an administrator adjust the idle window via the `PAT_IDLE_TIMEOUT_MS` server environment variable.

Always check that you are using the right role before changing administrative or accounting data.
