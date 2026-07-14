---
title: Administration
description: Managing users, roles, authentication, settings, email, logs, and webhooks.
sidebar:
  order: 7
---

## Users and roles

Administrators manage users, roles, and permissions. Each role should grant only the functions needed for daily work.

The **Users** page stays focused on application access: username, role, permissions, authentication method, and account status. HR data such as company phone, work email, role, department derived from competence centers, responsible user, contract, location, personal profile, and full address is managed in the **HR** module, not in Administration.

Permission rows marked **All** grant cross-record access for the same area, such as all clients, suppliers, projects, tasks, time entries, or competence centers. **View** opens the matching view and allows reading every matching record; when selected, **Create**, **Update**, and **Delete** are real write permissions and can operate on records that are not assigned to the user. Non-**All** permissions keep the user's assigned-record scope.

The `timesheets.expired_projects.create` permission allows time entry logging on expired projects. The built-in **Manager** and **Top Manager** roles receive it by default; grant it to other roles only when they need late timesheet corrections or operational logging on completed projects.

The built-in **Top Manager** role includes every competence-center permission, including the **All** scope for view, create, update, and delete. Other roles cannot receive competence-center permissions.

When changing a role, consider the impact on every assigned user. Praetor blocks deletion of any role still assigned to a user, either as the primary role or as an additional role. After major changes, verify access with a test profile or representative user.

## Authentication

Praetor supports local authentication and company integrations such as LDAP or SSO when configured. Keep endpoints, role mappings, and security settings updated.

When saving LDAP configuration, Praetor confirms the save only after the settings are persisted successfully. If the server rejects the settings, the page shows the error message and keeps the values visible for correction.

For LDAP mTLS configured through environment variables, `LDAP_TLS_CERT_FILE` and `LDAP_TLS_KEY_FILE` must be set together and point to readable files. If either value is missing or a path does not exist, Praetor reports the error before creating the LDAP client instead of continuing with a partial TLS configuration.

When editing an already saved LDAP configuration, the bind password is hidden behind a **Secret stored — Replace** badge. Update the Bind DN or any other field and save without touching the password — the stored secret is preserved. Click **Replace** only when you want to enter a new password; use **Keep stored value** to undo before saving, or leave the field empty after Replace to remove the bind credentials. The same Stored / Replace pattern protects the SMTP password (Email Settings) and SSO secrets (OIDC client secret, SAML IdP certificate, signing private key, and metadata XML), so typing into these fields by mistake can no longer overwrite the stored value.

Before enabling a SAML provider, configure either a valid metadata source (URL or XML) or manual settings with **Entry Point** and **IdP Certificate**. Praetor rejects enabled SAML providers that are missing this minimum configuration. Praetor also requires the **IdP Issuer** field unless the IdP entity ID can be extracted from an inline **Metadata XML**. During login, Praetor only accepts signed SAML assertions whose `<Issuer>` element matches that value.

If saving an OIDC or SAML provider fails, the provider tab shows an error message with the detail returned by the server. Correct the reported fields or retry when the service is available before treating the configuration as updated.

During OIDC login, Praetor accepts only the remote authorization, token, JWKS, and UserInfo endpoints that use HTTPS and do not resolve to private, loopback, or link-local networks. The `end_session_endpoint` is validated the same way when OIDC logout is enabled. If the provider does not advertise `userinfo_endpoint`, sign-in continues with ID token claims only: in that case, configure username, name, email, and group attributes against claims present in the ID token.

For OIDC providers you can enable **Call IdP end-session endpoint on logout**: when active, Praetor logout redirects the user's browser to the `end_session_endpoint` advertised by the IdP's discovery document (OIDC RP-Initiated Logout). Without it, logout only revokes the Praetor session — the IdP cookie remains active and a fresh SSO attempt would silently log in as the previous user, which matters most on shared workstations. To use this option, the IdP must expose `end_session_endpoint` in discovery and Praetor's `FRONTEND_URL` must be registered as an allowed post-logout redirect URI. Leave the toggle off for IdPs whose end-session UX is poor (forced confirmation pages, unreliable post-logout redirects).

In the user list, open the row actions menu and choose **Change authentication method** to restrict an application user to local credentials, LDAP, OIDC, or SAML. For OIDC and SAML, also select the specific provider: the user will be able to sign in only through that provider. Internal and external employees are not application accounts and cannot be bound to LDAP/SSO.

When you bind a user to LDAP, Praetor looks them up in the directory and applies the roles configured in the LDAP group role mapping **only when at least one of the user's LDAP groups matches a configured mapping**. If no group matches (or the directory is unreachable, or the user is not in it yet at bind time), the existing role is preserved — Praetor never silently demotes the user to the default `User` role at bind time. This is a one-time bootstrap: subsequent logins and periodic syncs do **not** re-apply the mapping (see the bootstrap-only rule below).

LDAP synchronization updates only application users that are already set to LDAP. A local user with the same username remains local until an administrator explicitly changes their authentication method.

Manual LDAP synchronization requires an enabled LDAP configuration. The **Sync users now** button in LDAP settings runs the saved synchronization immediately and respects the **Bulk-provision during sync** switch: it creates missing users only when that option is on, otherwise it only refreshes existing LDAP users. If LDAP is disabled or not configured, the request is rejected and is not recorded as a successful sync; if the directory is unreachable, Praetor reports the error instead of reporting success.

The LDAP connection tester uses the saved configuration and can run while LDAP is still disabled. Save configuration edits first, validate credentials and groups with the tester, then enable LDAP after the validation succeeds. Repeated tester attempts use the same rate-limit threshold as login to protect the directory from retry loops or password spraying. The tester reports the role the **real login** would assign: an existing LDAP-bound user is always shown as `Current Role` preserved (because the real login is bootstrap-only and never overrides their stored role), and a username with no matching Praetor row falls back to the default `User` role when no group maps to a configured mapping.

The LDAP **User Filter** must identify exactly one directory entry for the typed username. If the search returns multiple entries, Praetor rejects authentication and the connection tester reports the error instead of choosing an arbitrary DN.

LDAP group lookup uses the configured **Group Search Base** and **Group Member Filter**. In Active Directory, when you want to search group entries under a group OU by the user's DN, the usual filter is `(member={0})`: `{0}` is replaced with the user DN and the search runs under the configured group base.

The **Attribute Mapping** section lets you choose which directory attributes populate each user's identity: the **First Name Attribute** (default `givenName`), **Surname Attribute** (default `sn`), and **Email Attribute** (default `mail`). Leave a field blank to fall back to its default. On both login and the periodic sync, Praetor stores the resolved first and last name on the user's profile and composes the display name as `First Last`, falling back to the directory `cn`/`displayName` when those attributes are empty. The resolved name and email are shown in the connection tester so you can confirm the mapping before enabling LDAP. For LDAP-managed users these identity fields are read-only in the employee profile, since the directory is the source of truth.

**Role mapping is bootstrap-only.** LDAP group-to-role mappings determine which roles a user receives the **first time** they are provisioned into Praetor (auto-provision on first login, bulk-sync provisioning, or an administrator binding an existing user to LDAP). After that, the user's roles are owned by Praetor: adding or removing them in the Users page is the source of truth, and subsequent LDAP logins or scheduled syncs will never overwrite those assignments — even if the user's LDAP group membership changes. The same rule applies to OIDC and SAML providers. To re-apply LDAP role mapping to a specific user, unbind them and rebind from the user actions menu — Praetor will refresh their roles from the directory at the rebind moment, preserving any admin-assigned role if no LDAP group matches. For OIDC/SAML users, role mapping is only consulted at the very first SSO login that creates the Praetor account; on subsequent logins (including after an admin auth-method change) update roles manually from the Users page.

When LDAP is enabled, application users that exist in the directory but not yet in Praetor can be auto-provisioned on their first successful login. The new account is created with the canonical LDAP username (`uid` or `sAMAccountName`, lowercased) — not the value typed at the login form — so that subsequent LDAP synchronizations key the same row even when the user signs in with an alias such as their email address, and a directory casing change between syncs (for example `jdoe` → `JDoe`) never creates a duplicate row. Praetor reads these LDAP attributes case-insensitively, so directories or proxies that return `samaccountname` or `displayname` still resolve the username and display name correctly. The provisioned user is bound to LDAP authentication and receives the roles mapped from their LDAP groups; new accounts with no matching mapping default to the `User` role.

Usernames are compared case-insensitively across local, LDAP, and SSO sign-in: typing `JDoe`, `jdoe`, or `JDOE` always resolves to the same user account, so users do not need to remember the exact casing of their account.

The **User Provisioning** section in the LDAP settings exposes two independent switches:

- **Provision on first login** (on by default) — when on, any LDAP user that authenticates successfully gets a local account created on first sign-in. Turn off to restrict logins to users that already have a local account (created manually or via the bulk sync below). Existing LDAP-bound users keep logging in either way; only the auto-create branch for unknown directory users is gated.
- **Bulk-provision during sync** (off by default) — when on, the periodic sync also creates a local account for every LDAP entry that matches the configured user filter, applying LDAP group role mappings at creation. When off, the sync only refreshes display names of users that already exist. Either way, role mappings are never re-applied to users that already exist in Praetor.

The two switches are independent: turning both off (combined with manual user creation) is the configuration to use when you want a manually-curated set of users to be the only accounts that can sign in via LDAP. The manual sync button follows the same rule as the scheduled sync and requires saving configuration edits first.

If a user cannot sign in, check credentials, user status, assigned role, and authentication logs.

### Session inactivity timeout

The **Session** tab in **Authentication** settings lets administrators with general-settings update permission configure how many idle minutes a browser session may keep running before Praetor signs the user out.

The **Inactivity timeout** field accepts whole numbers from `5` to `1440` minutes. The default remains `30` minutes. Praetor uses this threshold to verify the server-side idle age of the token, rotating it with a matching expiry on every valid request and immediately after saving the policy when the value changes.

If the timeout is reduced, the server applies the new threshold on the next request by checking the JWT `iat`. The absolute maximum session limit remains separate and unchanged: a session cannot exceed 8 total hours even when the inactivity timeout is longer. The browser warning and logout timers always use the nearest effective expiry between the inactivity timeout and the remaining absolute session limit.

### Two-factor authentication (2FA)

Praetor supports TOTP-based two-factor authentication (authenticator apps such as Google Authenticator, Authy, or 1Password) for accounts with local or LDAP credentials. Each user enables 2FA from their own **Settings → Security**. For security, enrolling from a logged-in session first requires re-entering the account password (so a hijacked session alone cannot register a second factor); Praetor then shows a QR code (and a key for manual entry) to scan with the authenticator app, asks for a six-digit code to confirm, and finally displays a set of single-use **backup codes** to store safely. Backup codes are shown only once; you can regenerate them at any time — invalidating the previous ones — by entering a valid code. Enabling 2FA also signs you out of your other devices and revokes your existing API tokens, so nothing issued before enrollment can keep bypassing the new second factor (the device you enrolled from stays signed in).

When 2FA is enabled and available, after username and password sign-in requires a code from the authenticator app (or one of the backup codes, each usable once). Disabling it requires re-authentication: local users enter their current password **and** a valid code, LDAP users a valid code. Disabling revokes the user's other active sessions.

**The MFA policy.** The 2FA policy lives on a dedicated **MFA** tab in the **Authentication** settings and exposes five controls. Because these settings are saved through the general settings, the tab is shown only to administrators who hold the general-settings update permission.

- **Enable 2FA** — a global on/off switch for the whole feature. When off, 2FA is unavailable org-wide: no one can enroll, and even users who were previously enrolled are no longer challenged for a code at sign-in and are never forced into 2FA. Use it as a kill-switch to suspend two-factor authentication entirely.
- **Enforce 2FA** — the master enforcement switch. It is available only while **Enable 2FA** is on. When off, 2FA stays optional (users may enroll voluntarily); when on, the role controls below decide who is actually required to use it.
- **Enforce for roles** — a multi-select of the roles whose users must use 2FA. Leaving it empty means **everyone** with local or LDAP credentials is required. Selecting one or more roles narrows enforcement to users who hold any of those roles, considering both the primary role and any additional assigned roles, not just the active one.
- **Exempt roles** — a multi-select of roles that are never required to use 2FA. Exemption **wins over enforcement**: a user who holds an exempt role is never forced, even if they also hold an enforced role.
- **Exempt users** — a multi-select of individual users who are never required to use 2FA. This exemption also wins over role enforcement and is intended for targeted exceptions without creating dedicated roles.

A user is required to use 2FA only when **Enable 2FA** and **Enforce 2FA** are both on, the account uses local or LDAP credentials, the user is not listed in **Exempt users**, none of the user's roles is in **Exempt roles**, and either **Enforce for roles** is empty or one of the user's roles is listed there.

When a user is required to use 2FA and has not yet set it up, they are routed into enrollment on their next sign-in and only receive a session once it is completed. Turning enforcement on (or broadening it to cover more users) does not log anyone out: existing browser sessions of affected users stay active and the policy takes hold the next time they sign in, while attempting to switch into a required role without a second factor is blocked. It does, however, revoke those users' API tokens (personal access tokens and MCP tokens) — in the same transaction that saves the policy — because such tokens never pass through the login enrollment step and would otherwise keep API access with no second factor. Credentials are revoked the same way whenever a user who is unenrolled becomes subject to the mandate — by being promoted into an enforced role or by having their authentication method changed to a TOTP-applicable one (local or LDAP). A user subject to the mandate cannot disable their own 2FA from settings; only an admin reset can remove it.

**OIDC/SAML providers.** Users who sign in through an external provider (OIDC or SAML) do not use Praetor's 2FA: the second factor is handled by their identity provider. Enrollment is not offered to these users and the enforcement policy never applies to them, whatever the role selection.

**Recovery.** If a user loses access to their authenticator, an administrator can reset the user's 2FA from the row actions menu in the user list (**Reset 2FA**). This disables the user's 2FA and revokes their active credentials — both sessions and API tokens (personal access tokens and MCP tokens), since a reset is a recovery action and a surviving token would otherwise keep access without 2FA; on next sign-in the user uses only their password (and, if the policy still requires 2FA for that user, they will be prompted to set it up again).

## General and email settings

General settings control cross-cutting features such as AI reporting and application preferences. Email settings are used for sending messages and notifications.

In the **AI Capabilities** tab, enable AI reporting and choose **Gemini**, **OpenRouter**, **Anthropic**, or **OpenAI**. Each provider keeps a separate API key and model ID, so switching providers does not overwrite the previous configuration. For Anthropic, create the key in Anthropic Console and enter the exact ID of a Claude model available to the account. For OpenAI, Praetor uses the Responses API and does not require an assistant ID or a preconfigured platform conversation. Use **Check** before saving. AI reporting requests are sent by the server directly to the selected provider.

In the **Document codes** tab, administrators with general-settings update permission define the global templates used to generate codes for customer quotes, customer offers, supplier quotes, customer orders, supplier orders, customer invoices, and supplier invoices. Each module has a prefix, a template, and the number of sequence digits (1 to 9, default 4). Available placeholders are `{PREFIX}`, `{YY}`, `{YYYY}`, and `{SEQ}`; `{SEQ}` and a year placeholder (`{YY}` or `{YYYY}`) are required. Literal template text can contain only letters, numbers, underscores, and hyphens, so generated codes remain usable in document URLs. Praetor shows a live preview and rejects blank templates, unknown placeholders, invalid prefixes, or rendered codes longer than the 100-character document-code limit.

Counters are separate per module and year and restart from `0001` at the beginning of each year: a new year's sequence is independent from the previous year. Invoices use the **Issue Date** year, while quotes, offers, and orders use the server's current date. Changing a template affects only documents created in the future: existing codes are not renamed.

When a document is created from a source document, Praetor reuses the source code's year and sequence in the target module: a quote `PREV_26_0045` can generate an offer `OFF_26_0045` even if `OFF_26_0044` does not exist. These gaps are expected. The same rule applies to source codes or manual overrides that match the `prefix_year_sequence_...` shape with `_` as separator; a parseable manual override reserves its own module counter at least to the following value. If the inherited target code is already taken, Praetor reports a collision instead of advancing automatically to another sequence. For customer invoices, if an invoice is already linked to the same order, later invoices use the module's sequential counter instead.

In **Branding**, administrators customize the company name and logo. The sidebar always keeps the "PRAETOR" product wordmark and shows the company name in the secondary line under it, replacing the role/workspace label; the bottom version label remains "Praetor v...". The uploaded logo replaces both the sidebar icon and the login-screen logo. Logos accept PNG, JPEG, WEBP, or SVG up to 2 MB; leaving a field empty restores the bundled Praetor default. Branding is readable publicly so the login screen can show it before sign-in, but only administrators with the general-settings update permission can change it.

In **Tracking Preferences**, administrators also configure the metadata used by the RIL statement: company name, default start and exit times, lunch-break minutes, Notes options, and Location options. Notes are configured with separate **Code** and **Name** fields; Location options are configured with addable name rows, with the first option used for office days and the second for remote days. The default times populate valid RIL workdays, and the lunch-break value is used to recalculate RIL Hours and PICAP from editable entrance and exit times; none of these settings change existing time entries.

RIL page visibility is managed through the **timesheets.ril.view** role permission. Roles that already had Time Tracker access receive that permission automatically during migration.

After changing SMTP, sender, or security options, always run a send test before considering the configuration complete.

## Logs

The **Audit** tab helps reconstruct access and relevant operations. Filter by period to reduce noise and focus on the event you need to analyze.

The **SIEM** tab configures streaming for runtime logs and application audits to a syslog collector. Events use UTF-8 LEEF 2.0 with an RFC 5424 header and `^` delimiter. UDP, TCP, and TLS are supported; TCP/TLS can use newline or octet-counting framing. TLS always verifies the server certificate (minimum TLS 1.2); a private CA and client credentials can be supplied for mTLS. The client private key is encrypted and uses the Keep/Replace workflow in the UI.

Configuration follows **Save → Test → Enable**. Changing the destination, framing, syslog identity, or TLS material automatically disables streaming and requires a new test. For UDP, a test only confirms that the operating system accepted the datagram; for TCP/TLS it confirms connection and write, not application-level ingestion by the SIEM.

The PostgreSQL queue preserves events across failures and restarts and retries with increasing delays. Disabling streaming keeps the backlog. Retention and capacity are configurable; when either limit is exceeded, Praetor drops the oldest events first and displays counters in the SIEM tab. The backlog always follows the current destination configuration. Updating configuration requires `administration.logs.update`; users with only `view` can inspect the tab in read-only mode.

## Webhooks

Webhooks let administrators register outbound HTTP targets that Praetor can call to notify external systems. The **Webhooks** page lists every configured target and is available to administrators with the matching `administration.webhooks` permissions.

Each target defines:

- **Name** and an optional **Description** to identify the integration.
- **URL** — the endpoint Praetor calls. Only `http` and `https` URLs are accepted.
- **HTTP method** — `GET`, `POST` (default), `PUT`, `PATCH`, or `DELETE`.
- **Authentication** — how Praetor authenticates to the target: **None**, **Bearer token**, **Basic** (username and password), or **API key** (a value sent under a custom header you name). The secret credential is encrypted at rest and never returned to the browser; when editing it shows a **Stored — Replace** badge, and the same Keep / Replace behavior as the other secret fields preserves it unless you explicitly replace or clear it.
- **Custom headers** — optional key/value pairs attached to every request, layered on top of the authentication header. Use these for non-secret routing values such as a tenant id.
- **Enabled** — a toggle that marks the target active or inactive.

Create, edit, and delete actions are gated by the create, update, and delete permissions respectively, and every change is written to the audit log.

This page configures targets only; the events that trigger each webhook are wired up separately, for example in job-rule actions.
