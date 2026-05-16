---
title: Administration
description: Managing users, roles, authentication, settings, email, and logs.
sidebar:
  order: 6
---

## Users and roles

Administrators manage users, roles, and permissions. Each role should grant only the functions needed for daily work.

Permission rows marked **All** grant cross-record access for the same area, such as all clients, suppliers, projects, tasks, time entries, or work units. **View** opens the matching view and allows reading every matching record; when selected, **Create**, **Update**, and **Delete** are real write permissions and can operate on records that are not assigned to the user. Non-**All** permissions keep the user's assigned-record scope.

When changing a role, consider the impact on every assigned user. Praetor blocks deletion of any role still assigned to a user, either as the primary role or as an additional role. After major changes, verify access with a test profile or representative user.

## Authentication

Praetor supports local authentication and company integrations such as LDAP or SSO when configured. Keep endpoints, role mappings, and security settings updated.

When saving LDAP configuration, Praetor confirms the save only after the settings are persisted successfully. If the server rejects the settings, the page shows the error message and keeps the values visible for correction.

When editing an already saved LDAP configuration, the bind password is shown as a locked **Secret stored — value hidden** preview rather than being prefilled. Use the **Replace** control to type a new password, or **Keep stored value** to back out. Saving without entering Replace mode keeps the stored password untouched, so you can update the Bind DN (or any other field) without re-entering the password. To remove the bind credentials entirely, clear the Bind DN.

Before enabling a SAML provider, configure either a valid metadata source (URL or XML) or manual settings with **Entry Point** and **IdP Certificate**. Praetor rejects enabled SAML providers that are missing this minimum configuration. Praetor also requires the **IdP Issuer** field unless the IdP entity ID can be extracted from an inline **Metadata XML** — otherwise the `<Issuer>` element of incoming SAML responses cannot be verified.

When editing an existing provider, sensitive fields (**Client Secret**, **Metadata XML**, **IdP Certificate**, **Signing Private Key**) are shown as a locked **Secret stored — value hidden** preview rather than being prefilled with their value. Use the **Replace** control to type a new value, or **Keep stored value** to back out. Saving without entering Replace mode keeps the stored value untouched.

If saving an OIDC or SAML provider fails, the provider tab shows an error message with the detail returned by the server. Correct the reported fields or retry when the service is available before treating the configuration as updated.

In the user list, open the row actions menu and choose **Change authentication method** to restrict an application user to local credentials, LDAP, OIDC, or SAML. For OIDC and SAML, also select the specific provider: the user will be able to sign in only through that provider. Internal and external employees are not application accounts and cannot be bound to LDAP/SSO.

When you bind a user to LDAP, Praetor looks them up in the directory and immediately applies the roles configured in the LDAP group role mapping, overriding the local role. If the directory is unreachable or the user is not in it yet, the existing role is kept and the next login or sync will re-apply the mapping.

LDAP synchronization updates only application users that are already set to LDAP. A local user with the same username remains local until an administrator explicitly changes their authentication method.

Manual LDAP synchronization requires an enabled LDAP configuration. If LDAP is disabled or not configured, the request is rejected and is not recorded as a successful sync; if the directory is unreachable, Praetor reports the error instead of reporting success.

The LDAP connection tester uses the saved configuration and can run while LDAP is still disabled. Save configuration edits first, validate credentials and groups with the tester, then enable LDAP after the validation succeeds.

LDAP group lookup uses the configured **Group Search Base** and **Group Member Filter**. In Active Directory, when you want to search group entries under a group OU by the user's DN, the usual filter is `(member={0})`: `{0}` is replaced with the user DN and the search runs under the configured group base.

On every LDAP login and on each periodic synchronization, Praetor recomputes the user's role from the LDAP group role mapping. If at least one of the user's LDAP groups matches a configured mapping, those mapped roles win and replace the user's current assignment. **If no LDAP group matches any configured mapping, the user's existing role is preserved** — the administrator's manual role assignment is not silently demoted to the default `User` role. To force a role change for a user with no matching mapping, update either the LDAP group membership or the role mapping configuration.

When LDAP is enabled, application users that exist in the directory but not yet in Praetor are auto-provisioned on their first successful login. The new account is created with the canonical LDAP username (`uid` or `sAMAccountName`) — not the value typed at the login form — so that subsequent LDAP synchronizations key the same row even when the user signs in with an alias such as their email address. The provisioned user is bound to LDAP authentication and receives the roles mapped from their LDAP groups; new accounts with no matching mapping default to the `User` role.

The **User Provisioning Mode** toggle in the LDAP settings controls what the periodic sync does for users that do not yet exist locally:

- **Provision on Login** (default) — periodic sync only refreshes display names and role mappings for existing application users. New users are only created the first time they sign in.
- **Auto provision all matching users** — periodic sync also creates a local account for every LDAP entry that matches the configured user filter. Use this when you need every directory user pre-listed in Praetor before they ever log in.

In both modes, on-login provisioning remains active, so a first-time login always works.

If a user cannot sign in, check credentials, user status, assigned role, and authentication logs.

## General and email settings

General settings control cross-cutting features such as AI reporting and application preferences. Email settings are used for sending messages and notifications.

After changing SMTP, sender, or security options, always run a send test before considering the configuration complete.

## Logs

Logs help reconstruct access and relevant operations. Use them for audit, troubleshooting, and checks after administrative changes.

Filter by period and user to reduce noise and focus on the event you need to analyze.
