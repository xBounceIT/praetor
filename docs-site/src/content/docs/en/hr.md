---
title: HR and employees
description: Managing HR profiles for internal employees, external employees, and application users.
sidebar:
  order: 4
---

## Employee records

The **HR** module manages operational employee data separately from access controls. The **Internal Employees** and **External Employees** screens show the details HR needs for daily work: employee code, company phone, email, role, department derived from competence centers, responsible user, contract type, HR status, work location, hire or termination dates, and personal profile data with full name, personal phone, full address, and notes.

Application users with Praetor access appear among internal employees when you have the right HR permissions. This lets HR maintain the operational profile for people who also use the application, while **Administration > Users** stays focused on roles, permissions, authentication method, account status, and other security controls.

## Internal and external profiles

Use **Internal Employees** for company personnel and application users. Use **External Employees** for contractors, consultants, suppliers, or other outside resources that need to be tracked in HR and project workflows but do not have an application account.

The HR tables expose the fields needed for quick review: employee code, email and company phone in separate columns, role, department, responsible user, and HR status. Open a row to update the profile when you have the matching update permission.

The **Department** field is read-only in the HR profile: Praetor derives it from the active competence centers the person belongs to, sorted alphabetically and separated by commas. Change memberships from **Competence Centers**, not from the HR form. **Responsible** is optional and can only point to an active application user other than the employee themselves.

HR status describes the employee lifecycle (**Active**, **Onboarding**, **On leave**, **Terminated**) and does not disable application access. To block an application account, keep using the account status in **Administration > Users**.

In demo environments, the data seed includes realistic HR profiles for application users, non-login internal employees, and external collaborators, so the HR screens immediately show complete examples of contract, location, status, and contact data.

## Name, email, and company providers

For local users, HR can update name and email directly from the employee profile's **Company Profile** section. Email is saved through the same settings-backed path used by personal settings, so it stays consistent with the rest of the application.

## Hourly costs by period

With cost visibility permission, the employee record shows a table with **From**, **To**, and **Hourly cost**. The first period always starts **From the beginning** and the last ends at **Present**. Adding an effective date closes the preceding period on the day before it. You can edit a date or rate, or delete any period after the first; deleting one automatically extends the preceding period.

The employee profile and cost calendar are saved atomically. When the calendar changes, Praetor recalculates that person's timesheet entries using the rate effective on each entry date, including historical entries. New entries, date changes, and recurring generation also resolve cost from the entry date.

HR tables continue to summarize the rate effective today. **Administration > Users** does not display or edit costs: rates are managed only in the HR employee record. `hr.costs.view` and `hr.costs_all.view` control reading, while their matching `update` permissions control editing.

For users managed by LDAP, OIDC, or SAML, name and email are controlled by the company provider. Praetor shows those fields as read-only in HR screens and rejects manual server-side changes. On each login or synchronization, non-empty provider values refresh the user's name, avatar initials, and email; missing provider values do not erase existing local data.

## Permissions

HR detail visibility follows the employee type:

- **Internal HR - View/Update** allows reading or changing HR details for internal employees and application users treated as internal employees. Creating and deleting internal profiles instead uses **User Management - Create/Delete** permissions, even when the action starts from the HR screen.
- **External HR - View/Update** allows reading or changing HR details for external employees.

The **Admin** role no longer includes HR access by default: account creation, account status changes, and role management remain in **Administration > Users**, while HR employee records require the matching HR permissions.

Without the matching HR permissions, HR fields are omitted from user API responses and are unavailable in the screens. Account administration controls remain governed by user administration permissions.

## Competence centers

Competence centers connect people, costs, and assignments. Keep competence-center memberships current because they feed the **Department** field shown in HR profiles, as well as cost, availability, and project team composition analysis.

Competence-center permissions without the **All** scope remain limited to centers the user manages: updating, deleting, and managing members require the user to be a center manager. When creating a center or changing its managers, the user must keep themselves as a manager and may add only people already in their managed HR scope as additional managers. The matching **All** action permission enables the operation across scopes.

Each competence center card shows the initials of its assigned members; hover an initial to read the full name. When members exceed the space available, a `+N` badge sums up the rest and, on hover, lists the complete membership so you can see it without opening the card.
