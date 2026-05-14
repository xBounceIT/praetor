---
title: CRM, catalog, and projects
description: Managing customers, suppliers, products, projects, tasks, and work units.
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

When creating or editing a project you can also fill in:

- **Project start date** and **Project end date** — define the planned window; the end date must not precede the start date.
- **Offer reference** — links the project to an accepted offer. This field is required.
- **Project revenue** — resolved with this precedence: (1) if the activities have a per-row revenue, the project revenue is the sum of those values shown read-only; (2) otherwise, if an order is linked, the revenue is inherited read-only from the order total; (3) otherwise you can enter it manually.

Praetor assigns a unique color automatically when you create a project. You can change it later from the project record; duplicate colors are blocked, and new colors are generated when the initial palette is exhausted.

When a project ends, check that tasks are consistent and that no pending entries remain.

## Work units

Work units connect people, costs, and assignments. They support HR analysis and economic project control.

Only users with the right permissions should change costs, assignments, or historical data.
