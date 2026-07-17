---
title: Time reports
description: How to filter, group, save, and export time entries.
sidebar:
  order: 6
---

The **Reporting > Report** page builds tables from Time Tracker entries. The current month is selected by default.

## Filters and fields

Choose a relative period (today, yesterday, current/previous week, month, or year) or a custom range. You can filter by one client, one project, one task, and text contained in notes. Client, project, and task controls are searchable and include an option that leaves the corresponding filter unrestricted. Start and end dates are inclusive.

Client, project, and task filters include both items assigned to users in the visible report scope and values found in their historical entries. You can therefore select an assigned item before its first time entry while retaining access to data for items that are no longer assigned. If a project is moved to another client, its historical client-project pair remains available under the original client.

Date is always shown. You can add or remove user, client, project, task, duration, note, and cost. Cost is available only with `reports.cost.view` and uses the historical hourly cost stored on each entry.

## Users and visibility

The `reports.time_report.view` permission allows reports for your own time. The user selector appears with `reports.time_report_all.view`:

- managers and top managers can select themselves and users they manage;
- users who also have `timesheets.tracker_all.view` can select every non-administrator;
- the server always validates scope.

The administrator role cannot use this page. Custom roles can be granted either permission explicitly.

## Grouping and totals

Select up to three distinct, ordered grouping levels from date, user, client, project, and task. Results include details, hierarchical subtotals, and a grand total. **Totals only** removes detail rows and is enabled only when at least one grouping exists.

Duration uses `H:MM`; cost uses the configured currency. When a table result exceeds its limit, Praetor displays a warning while the count and grand total still cover every matching entry.

The pencil action appears on detail rows only when the user has effective Timesheet read and update permissions. Saving an edit regenerates the current report.

## Personal favorites

Enter a name and select **Save** to store the configuration. Names must be unique among your own report favorites. Selecting a favorite fills the form without running it automatically.

Relative periods are recalculated when the favorite is applied; custom ranges retain their absolute dates. If a user or entity is no longer visible, Praetor removes that filter and displays a warning. The cost field is also removed when its permission is no longer available. Report favorites are personal and cannot be shared.

## CSV export

**Export** uses the last configuration that was actually generated, not pending form changes. The CSV contains details, subtotals, and the grand total, but no UI actions. It uses UTF-8 with BOM and protects cells against spreadsheet formula injection.
A complete export is limited to 50,000 entries. Above that threshold the server returns an explicit error; narrow the dates or filters and try again.
