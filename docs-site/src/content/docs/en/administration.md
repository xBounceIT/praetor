---
title: Administration
description: Managing users, roles, authentication, settings, email, and logs.
sidebar:
  order: 6
---

## Users and roles

Administrators manage users, roles, and permissions. Each role should grant only the functions needed for daily work.

When changing a role, consider the impact on every assigned user. After major changes, verify access with a test profile or representative user.

## Authentication

Praetor supports local authentication and company integrations such as LDAP or SSO when configured. Keep endpoints, role mappings, and security settings updated.

In the user list, open the row actions menu and choose **Change authentication method** to restrict an application user to local credentials, LDAP, OIDC, or SAML. For OIDC and SAML, also select the specific provider: the user will be able to sign in only through that provider.

If a user cannot sign in, check credentials, user status, assigned role, and authentication logs.

## General and email settings

General settings control cross-cutting features such as AI reporting and application preferences. Email settings are used for sending messages and notifications.

After changing SMTP, sender, or security options, always run a send test before considering the configuration complete.

## Logs

Logs help reconstruct access and relevant operations. Use them for audit, troubleshooting, and checks after administrative changes.

Filter by period and user to reduce noise and focus on the event you need to analyze.
