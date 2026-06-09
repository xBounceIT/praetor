---
title: HR and employees
description: Managing HR profiles for internal employees, external employees, and application users.
sidebar:
  order: 4
---

## Employee records

The **HR** module manages operational employee data separately from access controls. The **Internal Employees** and **External Employees** screens show the details HR needs for daily work: employee code, phone, email, job title, department, contract type, HR status, work location, hire or termination dates, emergency contact, and notes.

Application users with Praetor access appear among internal employees when you have the right HR permissions. This lets HR maintain the operational profile for people who also use the application, while **Administration > Users** stays focused on roles, permissions, authentication method, account status, and other security controls.

## Internal and external profiles

Use **Internal Employees** for company personnel and application users. Use **External Employees** for contractors, consultants, suppliers, or other outside resources that need to be tracked in HR and project workflows but do not have an application account.

The HR tables expose the fields needed for quick review: employee code, contact details, role or title, department, and HR status. Open a row to update the profile when you have the matching update permission.

HR status describes the employee lifecycle (**Active**, **Onboarding**, **On leave**, **Terminated**) and does not disable application access. To block an application account, keep using the account status in **Administration > Users**.

In demo environments, the data seed includes realistic HR profiles for application users, non-login internal employees, and external collaborators, so the HR screens immediately show complete examples of contract, location, status, and contact data.

## Name, email, and company providers

For local users, HR can update name and email directly from the employee profile. Email is saved through the same settings-backed path used by personal settings, so it stays consistent with the rest of the application.

For users managed by LDAP, OIDC, or SAML, name and email are controlled by the company provider. Praetor shows those fields as read-only in HR screens and rejects manual server-side changes. On each login or synchronization, non-empty provider values refresh the user's name, avatar initials, and email; missing provider values do not erase existing local data.

## Permissions

HR detail visibility follows the employee type:

- **Internal HR - View/Update** allows reading or changing HR details for internal employees and application users treated as internal employees.
- **External HR - View/Update** allows reading or changing HR details for external employees.

Without the matching HR permissions, HR fields are omitted from user API responses and are unavailable in the screens. Account administration controls remain governed by user administration permissions.

## Competence centers

Competence centers connect people, costs, and assignments. Keep HR profiles current before analyzing costs, availability, and team composition on projects.

Each competence center card shows the initials of its assigned members; hover an initial to read the full name. When members exceed the space available, a `+N` badge sums up the rest and, on hover, lists the complete membership so you can see it without opening the card.
