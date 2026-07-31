---
title: Time tracking and recurring tasks
description: How to record time, review the week, and manage repeated work.
sidebar:
  order: 2
---

## Tracker

Use the tracker to record time spent on projects and tasks. In the updated interface, every
time entry requires a non-empty note. This applies to daily and weekly entry, duplication,
and note edits. In the weekly view, enter a day-specific note or use the weekly note as a
shared fallback. Recurring entries use the task notes, description, or name, in that order.
During the rollout window, existing REST and MCP integrations continue to accept entries
without notes.

Each entry should include period, project, task, description, and location when required.

By default, the system **Top Manager** role has the complete **Tracker (All)** scope (`timesheets.tracker_all.view/create/update/delete`). It can view, create, update, and delete entries for every user, including users outside its competence centers. Custom roles must be granted each global action explicitly.

In the tracker selectors, hover over a project or task to read its description without changing the selection. The tooltip appears only when the item has a description. During keyboard navigation, screen readers also announce the active option's description.

Before saving, verify that dates are correct and that the task belongs to the selected project. This keeps reports, totals, and costs consistent.

The tracker always allows entries on Saturdays, Sundays, and Italian holidays. When the daily total exceeds **8 hours**, or when any time is recorded on a weekend or Italian holiday, Praetor creates an overtime notification for the user's competence-center managers and all Top Managers. Each event is notified only once per user, date, and tracker source.

From the daily activity list you can **Duplicate** an existing entry: a dialog lets you pick one or more target days. Praetor always creates new entries with the same client, project, task, hours, notes, and location (`isPlaceholder` always `false`), appending them alongside whatever is already logged that day — including when the same project/task is already present. The source day cannot be selected. If some selected days already have that project/task, the dialog shows an informational warning but still allows confirmation. Duplicate creates are not idempotent: if a request fails or times out, check the calendar before duplicating those days again so you do not append a second billable row.

`POST /api/entries` always inserts a new row. Multiple entries for the same user, date, project, and task are allowed. `PUT /api/entries/:id` returns `409` only when the optimistic-lock version is stale.

Single-entry duration is capped at 24 hours: both `POST /api/entries` and `PUT /api/entries/:id` reject any `duration` greater than `24`. Split work across separate dates instead of recording impossibly long durations.

Projects whose end date is before today are considered expired in selectors, except jobs in **Perpetuo** status, which remain available even with a past end date. The server compares the entry date with the project end date: a historical entry within the project's valid period can be created or moved without an additional permission even when the project is expired today. `timesheets.expired_projects.create` is required only for entries after the project end date. Jobs in **In pausa** or **Terminato** status are always excluded from the tracker, weekly-view, and RIL selectors, and the server always rejects new entries or moves into those jobs. Existing entries can still be edited for non-catalog fields such as duration, notes, location, and placeholder state; **In pausa** or **Terminato** also blocks edits to entries already linked to that job and any catalog change into that job.

When an entry is edited, Praetor uses the API-returned `version` field to prevent concurrent overwrites. If the same entry was saved elsewhere meanwhile, `PUT /api/entries/:id` returns `409` and the entry must be reloaded before retrying.

The `timesheets.tracker_all.view` permission allows viewing every user's time entries without requiring the viewer to manage those users' competence centers. To make the correct user selectable, both the REST user list and `praetor_get_users_hierarchy` include every user; email addresses, HR details, and costs remain masked unless their dedicated permissions are also granted.

## Weekly view

The weekly view helps you quickly review hours across days. Use it to find missing days, duplicates, or entries assigned to the wrong project.

Each existing entry occupies its own row. The "New entry" row at the top is for creating new entries only; multiple rows with the same project and task on the same day are allowed.

## RIL

The **RIL** page in Timesheets generates a monthly attendance statement from the selected user's time entries. It is available to users with **timesheets.ril.view**; the migration automatically grants that permission to roles that already had Time Tracker access. You can choose the month and year and, for managed users, the collaborator to review.

Praetor retrieves entries with `GET /api/entries?purpose=ril` using inclusive `fromDate` and `toDate` filters for the full month, then builds an editable draft. Edits made in the RIL table stay local to the page and Excel export; they do not update the underlying time entries.

Your edits are saved automatically as a per-month draft, scoped to the selected user, and restored when you reopen or refresh the page so nothing is lost on reload. A small status indicator near the title shows when the draft is **saving** or **saved**. Drafts persist server-side via `GET`/`PUT`/`DELETE /api/ril-drafts/:monthKey`, so they follow you across devices. Use **Reset from timesheets** to discard the saved draft and regenerate the month from the current time entries. Automatically marked holiday rows stay highlighted but are editable; weekend rows are highlighted for quick scanning.

For every valid weekday, Praetor starts the draft with the configured default entrance and exit times, **09:00** and **18:00** by default, even when that day has no tracked entries. **Hours** and **PICAP** are recalculated from the editable entrance and exit values, subtracting the portion of the span that overlaps the configured lunch break starting at **13:00**. Italian holidays that fall Monday through Friday are marked with the configured holiday note code, `F` by default; weekend holidays are not marked. If timesheets contain tracker-generated overtime, the RIL row uses the tracked total only for that overtime day. For the **Location** (Trasferta) column, a per-weekday default from your user settings takes precedence when configured for that weekday; otherwise, if any entry for the day is not `remote`, the row uses the first Location option configured in RIL global settings, and if all entries are remote it uses the second.

When you manually edit a RIL row and it exceeds **8 hours** or contains work on a weekend or Italian holiday, Praetor creates an overtime notification with the manual RIL source. This is distinct from the tracker notification, but it is still deduplicated per user, date, and source.

You can set those per-weekday defaults under **Settings → RIL**: pick a default Trasferta value for each weekday (Monday through Friday), and Praetor pre-fills the matching rows when it generates your own RIL sheet. The list of selectable values comes from the RIL Location options configured by administrators in RIL global settings.

On their first sign-in, users who can view RIL receive a **Tip** notification reminding them to configure these preferences. The notification's **Set preferences** button opens **Settings → RIL** directly; the tip is created only once per account.

In the statement, **Notes** and **Location** use the option lists configured by administrators in RIL global settings. **Code** can be selected from `TR` business trip and `SD` hardship office.

Before export, every valid weekday and every worked overtime row must have **Start**, **End**, and **Location** filled in. The **Export Excel** button creates a one-sheet `.xlsx` workbook named **Prospetto Presenze** with the RIL columns: Giorno, Entrata, Uscita, Ore, PICAP, Reperib. Telef., Note, Trasferta, Cod, and Commessa. The sheet shows **Dipendente** (employee), **Società** (company), and **MESE** (month) at the top, followed by the day grid and, at the bottom, the code legend (P, P2, M, F, TR, SD) and the monthly totals: **Giorni Lavorati**, **Ore Extra**, **Totale Ore**, **Totale PICAP**, and **Pausa Pranzo**.

## Recurring tasks

Recurring tasks generate repeated entries, such as weekly meetings or periodic administrative work.

When configuring a recurrence, check frequency, start date, optional end date, and description. If a recurrence is no longer needed, disable it instead of creating duplicate manual entries.

### Template model

Each recurring template is defined on a project task and includes:

- `recurrencePattern`: `daily`, `weekly`, `monthly`, or the custom patterns `monthly:first:<dow>`, `monthly:second:<dow>`, `monthly:third:<dow>`, `monthly:fourth:<dow>`, `monthly:last:<dow>` (with `<dow>` = 0 Sunday … 6 Saturday).
- `recurrenceStart`: the date occurrences begin from.
- `recurrenceEnd` (optional): when set, generation stops on this date.
- `recurrenceDuration`: the default duration (in hours) of each generated entry. Capped at 24 hours to match the per-entry limit.

For `monthly` recurrences, if the start-date day does not exist in a shorter month, the occurrence is generated on that month's final day.

Sundays, Saturdays (when the _Treat Saturday as holiday_ setting is enabled), and Italian holidays are always skipped.

For recurring tasks, Praetor generates dates up to the project end date even when processing a historical range. Later dates are skipped unless the role has `timesheets.expired_projects.create`. Recurrences linked to jobs in **In pausa** or **Terminato** status are always skipped.

### Server-side generation

Recurring entries are materialized on the server via `POST /api/entries/recurring/generate`. The body requires `fromDate` and `toDate` in `YYYY-MM-DD` format; an optional `userId` can be supplied (it requires the competence-center management link or the `timesheets.tracker_all.create` permission for the target user).

```json
{
  "fromDate": "2026-01-01",
  "toDate": "2026-01-14"
}
```

The endpoint is idempotent and safe for overlapping generation requests: re-running it with the same window does not create duplicates, since existing `(date, project, task)` tuples are skipped. The response reports `generatedCount`, `skippedExistingCount`, and the list of created entries.

To prevent accidentally huge generations, the server caps the window at 366 days per call.

The required permission is `timesheets.recurring.create`.

### Cleaning up generated entries

Bulk cleanup of recurring entries uses `DELETE /api/entries` with `projectId`, `task`, and, when needed, `futureOnly` or `placeholderOnly`. A role with only `timesheets.recurring.delete` can delete placeholder entries generated from recurrences only: the server always applies `placeholderOnly=true` in that case. Deleting real non-placeholder entries requires `timesheets.tracker.delete` in the assigned scope, or `timesheets.tracker_all.delete` for full scope.
