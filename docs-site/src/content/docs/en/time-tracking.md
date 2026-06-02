---
title: Time tracking and recurring tasks
description: How to record time, review the week, and manage repeated work.
sidebar:
  order: 2
---

## Tracker

Use the tracker to record time spent on projects and tasks. Each entry should include period, project, task, description, and location when required.

Before saving, verify that dates are correct and that the task belongs to the selected project. This keeps reports, totals, and costs consistent.

Praetor does not allow a second entry for the same user, date, project, and task: `POST /api/entries` returns `409` when that combination already exists. Update the existing entry instead of creating a duplicate.

Single-entry duration is capped at 24 hours: both `POST /api/entries` and `PUT /api/entries/:id` reject any `duration` greater than `24`. Split work across separate dates instead of recording impossibly long durations.

When an entry is edited, Praetor uses the API-returned `version` field to prevent concurrent overwrites. If the same entry was saved elsewhere meanwhile, `PUT /api/entries/:id` returns `409` and the entry must be reloaded before retrying.

## Weekly view

The weekly view helps you quickly review hours across days. Use it to find missing days, duplicates, or entries assigned to the wrong project.

Each existing entry occupies its own row, so any historical duplicate data stays visible and can be edited independently. The "New entry" row at the top is for creating new entries only and follows the duplicate-entry guard.

## RIL

The **RIL** page in Timesheets generates a monthly attendance statement from the selected user's time entries. It is available to users with **timesheets.ril.view**; the migration automatically grants that permission to roles that already had Time Tracker access. You can choose the month and year and, for managed users, the collaborator to review.

Praetor retrieves entries with `GET /api/entries?purpose=ril` using inclusive `fromDate` and `toDate` filters for the full month, then builds an editable draft. Edits made in the RIL table stay local to the page and Excel export; they do not update the underlying time entries. Automatically marked holiday rows are highlighted and read-only; weekend rows are highlighted for quick scanning.

For every valid weekday, Praetor starts the draft with the configured default entrance and exit times, **09:00** and **18:00** by default, even when that day has no tracked entries. **Hours** and **PICAP** are recalculated from the editable entrance and exit values, subtracting the portion of the span that overlaps the configured lunch break starting at **13:00**. Italian holidays that fall Monday through Friday are marked with the configured holiday note code, `F` by default; weekend holidays are not marked. If any entry for the day is not `remote`, the row uses the first Location option configured in RIL global settings; otherwise it uses the second.

In the statement, **Notes** and **Location** use the option lists configured by administrators in RIL global settings. **Code** can be selected from `TR` business trip and `SD` hardship office.

Before export, every valid weekday must have **Start**, **End**, and **Location** filled in. The **Export Excel** button creates a one-sheet `.xlsx` workbook named **Prospetto Presenze** with the RIL columns: Giorno, Entrata, Uscita, Ore, PICAP, Reperib. Telef., Note, Trasferta, Cod, and Commessa. The sheet shows **Dipendente** (employee), **Società** (company), and **MESE** (month) at the top, followed by the day grid and, at the bottom, the code legend (P, P2, M, F, TR, SD) and the monthly totals: **Giorni Lavorati**, **Ore Extra**, **Totale Ore**, **Totale PICAP**, and **Pausa Pranzo**.

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
