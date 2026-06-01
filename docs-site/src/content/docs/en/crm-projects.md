---
title: CRM, catalog, and projects
description: Managing customers, suppliers, products, projects, tasks, and competence centers.
sidebar:
  order: 3
---

## Customers and suppliers

CRM records store the data used in commercial and accounting workflows. Keep names, contacts, addresses, and tax details updated before creating offers, orders, or invoices.

Avoid duplicates: before creating a new record, search for the customer or supplier first.

### Protected deletion

A customer or supplier cannot be deleted while any related financial document (quote, offer, order, invoice) still references it. The delete request is rejected and the document is not lost: remove or cancel the linked documents first, then delete the record. This guardrail exists because an issued accounting document must remain traceable even if the counterparty record is no longer needed.

## Internal catalog

The catalog contains products, categories, units, and pricing logic. Catalog data feeds quotes, offers, and accounting documents.

Update the listing when costs, margins, or sales conditions change so new documents start from reliable data.

## Projects and tasks

Projects connect customers, tasks, and time entries. Create clear reusable tasks with names that describe the actual work.

For each project and task, you can set the billing type: retainer or time and materials. Time-and-materials tasks are always monthly; retainers can be monthly or one-time. If tasks use a billing type that differs from the project, the project is shown as mixed.

Use estimated monthly effort to plan recurring load and total effort to track progress against the overall expected hours.

The **Add Project** action opens a focused dialog with only what's needed to create a project: client, name, dates, offer, billing, optional order, optional revenue, and a draft tasks table. Submitting the dialog takes you straight to the new project's dedicated detail page.

Click any row in the projects list to open the **project detail page**. The detail page replaces the legacy edit dialog and is laid out in two areas:

- The top section lays out the project fields horizontally (client, name, description, dates, offer, billing, revenue, color, disabled toggle) next to the inline-editable project tasks table.
- Below, the **project dashboard** shows KPIs (total hours, total cost, team size, budget used %) and four charts: hours by user (broken down by task), hours by task (logged hours against the available effort), cost vs revenue, and monthly activity. Charts populate as time is logged against the project; before any entries exist, each chart shows an empty state. The page also surfaces a notice when (a) the project has more than 5,000 entries (only the most recent are loaded), (b) your role limits which users' entries you can see (totals reflect just your scope), or (c) you don't have permission to view time entries at all.

Next to the project dashboard heading are two buttons, **Edit** and **Views**. **Edit** turns the whole dashboard — every KPI stat card, the project timeline, and all four charts — into a free-form layout you can rearrange. Drag a card by its header to move it anywhere on the 12-column grid, drag its right edge, bottom edge, or corner to resize it, and use the eye button on a card to hide it (or restore a hidden one). You can also move the focused card with the arrow keys, and resize it by holding **Shift** with the arrow keys. Cards float up to fill the gaps left behind. When you're done, keep the arrangement for this project or save it as a reusable view. Editing a project's dashboard creates a **per-project layout** that affects only that project. The **Views** menu lets you apply one of your saved views, choose **Use global default** (drop this project's custom layout so it follows the shared default again), or choose **Set as global default** (make the current arrangement the baseline for every project that doesn't have its own layout).

**Named saved views** are stored on the server and owned by whoever creates them: they stay available from any device and can be shared. From the **Views** menu the owner can **share** a view with specific users, granting each one **read** access (apply only) or **write** access (edit, rename, and re-save it — and the change then applies to everyone the view is shared with). Only the owner can **delete** a view or manage its sharing; shared views show the author's initials in a small avatar (hover to see their full name) alongside your access level. Read recipients can still **duplicate** the view into their own editable copy. Edits made by write recipients propagate to others the next time they load or apply the view, not in real time. The **per-project layout** and your **personal global default**, by contrast, stay stored locally in your browser and private to each user. On narrow screens the cards stack in a single column and drag-and-drop editing is unavailable.

When creating or editing a project you can fill in:

- **Project start date** and **Project end date** — define the planned window. Both are required (at creation and on every subsequent save from the detail page) so projects always carry a planning window; the end date must not precede the start date.
- **Offer reference** — links the project to an accepted offer. This field is required.
- **Project revenue** — resolved with this precedence: (1) if the activities have a per-row revenue, the project revenue is the sum of those values shown read-only; (2) otherwise, if an order is linked, the revenue is inherited read-only from the order total; (3) otherwise you can enter it manually.

Praetor assigns a unique color automatically when you create a project. You can change it later from the detail page; duplicate colors are blocked, and new colors are generated when the initial palette is exhausted.

When a project ends, check that tasks are consistent and that no pending entries remain.

### Assigning users

The **Assign Users** command manages who is assigned to a project or one of its activities. Access to this dialog is governed by the **Project Assignments** permission: the **View** action lets a role open the assignments of any project or activity regardless of its own membership, while **Update** lets it edit them. Managers and Top Managers hold both by default, so they can manage assignments even when they are not members of the project or activity.

## Competence centers

Competence centers connect people, costs, and assignments. They support HR analysis and economic project control.

Only users with the right permissions should change costs, assignments, or historical data.
