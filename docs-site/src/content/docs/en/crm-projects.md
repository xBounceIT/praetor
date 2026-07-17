---
title: CRM, catalog, and projects
description: Managing customers, suppliers, products, jobs, tasks, and competence centers.
sidebar:
  order: 3
---

## Customers and suppliers

CRM records store the data used in commercial and accounting workflows. Keep names, contacts, addresses, and tax details updated before creating offers, orders, or invoices.

Avoid duplicates: before creating a new record, search for the customer or supplier first.

In master-data tables, contact references are available in dedicated columns. Supplier rows show contact person, email, and phone separately, like the customer list, so each value can be sorted, filtered, and read without opening the record.

Customer and supplier records can contain multiple contacts, each with a required name and optional role, email, and phone. The first contact is the primary contact and supplies the contact-person, email, and phone columns in the directory; when it is removed, the next contact becomes primary. The contact list may also be left empty.

### Creating multiple clients and suppliers

The arrow beside **Add New Client** opens two actions for users who can create clients:

- **Add Multiple Clients** opens a horizontal table. Enter one client per row, add or remove rows, and submit the batch. Valid rows are created immediately; invalid rows stay in the dialog with errors shown in the relevant cells.
- **Import from Excel** downloads `praetor-clients-import.xlsx`, where you fill the highlighted cells and import up to 500 clients. The template includes instructions and dropdowns for typed fields. Sector, employee count, revenue, and office-count options are read from the CRM every time you download, so recent changes are included immediately.

The client template requires `clientCode`, `name`, and `fiscalCode`; it also provides `type`, `contactName`, `contactRole`, `email`, `phone`, `website`, `addressCountry`, `addressState`, `addressCap`, `addressProvince`, `addressCivicNumber`, `addressLine`, `atecoCode`, `sector`, `numberOfEmployees`, `revenue`, `officeCountRange`, and `description`. Do not change column names or order, sheets, or the protected structure. Only Praetor-generated XLSX templates up to 5 MiB are accepted. Valid rows are created even when other rows fail; after a partial result, **Import clients** retries only failed records. A typed value removed from the CRM after the template was downloaded is reported as invalid during import.

The arrow beside **Add New Supplier** offers the same workflows:

- **Add Multiple Suppliers** opens the table for entering and correcting a batch.
- **Import from Excel** downloads `praetor-suppliers-import.xlsx` and applies the same limits and structural checks as the client template.

Each supplier requires `supplierCode`, `name`, and `vatNumber`. The template identifies the primary-contact group with **Contact Name**, **Contact Role**, **Contact Email**, and **Contact Phone**, corresponding to `contactName`, `contactRole`, `email`, and `phone`; `address`, `taxCode`, `paymentTerms`, and `notes` are also optional. If role, email, or phone is entered, the contact name is also required; the import creates one primary contact per row. Additional contacts can be added later from the supplier record. Supplier codes must be unique case-insensitively.

Client and supplier quotes require the **Communication Channel** field to record how the quote was communicated or negotiated. The same channel is visible in the quote tables. The options are shared by both quote modules: users with quote-management permissions can use the gear **Manage** button above the field to add, rename, or remove available channels and choose an icon from the provided set. Email, Phone, and WhatsApp are default values with their own icons and cannot be modified or deleted. Custom channels already used by existing quotes cannot be deleted.

### Protected deletion

A customer or supplier cannot be deleted while any related financial document (quote, offer, order, invoice) still references it. The delete request is rejected and the document is not lost: remove or cancel the linked documents first, then delete the record. This guardrail exists because an issued accounting document must remain traceable even if the counterparty record is no longer needed.

## Internal catalog

The catalog contains products, categories, units, and pricing logic. Catalog data feeds quotes, offers, and accounting documents.

In the create or edit product form, the **Manage** button above the **Type**, **Category**, and **Subcategory** fields opens the corresponding list of values. From there you can add or rename a value and delete it when existing links do not protect it.

Update the listing when costs, margins, or sales conditions change so new documents start from reliable data.

## Jobs and tasks

Jobs connect customers, tasks, and time entries. The module remains named **Projects**, but its operational pages are **Jobs** and **Resales**. Inside **Jobs**, use the **Jobs** and **Tasks** tabs to switch between the jobs archive and task management; the archive also shows each job's start and end dates.

For each job and task, you can set the billing type (retainer or time and materials) and the billing frequency (monthly or one-time) independently — both billing types support either frequency. If tasks use a billing type that differs from the job, the job is shown as mixed.

Use estimated monthly effort to plan recurring load and task duration as a generic multiplier. Total effort is calculated automatically as monthly effort × duration and is used to track progress against the overall expected hours. Task total revenue is calculated the same way: revenue × duration.

The **Add Job** action opens a focused dialog with only what's needed to create a job: client order, client, name, dates, optional offer, type, status, billing, optional revenue, and a draft tasks table. After submission, users with advanced-data access are taken to the job detail page; other roles remain in the archive.

The jobs archive remains available through the **Projects** permission (`projects.manage.view`). Clicking a row and opening the **job detail page** additionally requires **Advanced project data** (`projects.details.view`), granted to Managers and Top Managers by default. Without it, the table keeps all operational columns but rows are not interactive, and the linked order, offer, revenue, and internal detail fields are withheld from API responses. The detail page replaces the legacy edit dialog and is laid out in two areas:

- The top section lays out the job fields horizontally (client order, client, name, description, dates, offer, type, status, billing, revenue, disabled toggle) next to the inline-editable job tasks table.
- Below, the **job dashboard** shows KPIs (total hours, total cost, team size, budget used %) and four charts: hours by user (broken down by task), hours by task (logged hours against the available effort), cost vs revenue, and monthly activity. Charts populate as time is logged against the job; before any entries exist, each chart shows an empty state. The page also surfaces a notice when (a) the job has more than 5,000 entries (only the most recent are loaded), (b) your role limits which users' entries you can see (totals reflect just your scope), or (c) you don't have permission to view time entries at all.

Next to the job dashboard heading are two buttons, **Edit** and **Views**. **Edit** turns the whole dashboard — every KPI stat card, the job timeline, and all four charts — into a free-form layout you can rearrange. Drag a card by its header to move it anywhere on the 12-column grid, drag its right edge, bottom edge, or corner to resize it, and use the eye button on a card to hide it (or restore a hidden one). You can also move the focused card with the arrow keys, and resize it by holding **Shift** with the arrow keys. Cards float up to fill the gaps left behind. When you're done, keep the arrangement for this job or save it as a reusable view. Editing a job's dashboard creates a **per-job layout** that affects only that job. The **Views** menu lets you apply one of your saved views, choose **Use global default** (drop this job's custom layout so it follows the shared default again), or choose **Set as global default** (make the current arrangement the baseline for every job that doesn't have its own layout).

**Named saved views** are stored on the server and owned by whoever creates them: they stay available from any device and can be shared. From the **Views** menu the owner can **share** a view with specific users, granting each one **read** access (apply only) or **write** access (edit, rename, and re-save it — and the change then applies to everyone the view is shared with). Only the owner can **delete** a view or manage its sharing; shared views show the author's initials in a small avatar (hover to see their full name) alongside your access level. Read recipients can still **duplicate** the view into their own editable copy. Edits made by write recipients propagate to others the next time they load or apply the view, not in real time. The **per-job layout** and your **personal global default**, by contrast, stay stored locally in your browser and private to each user. On narrow screens the cards stack in a single column and drag-and-drop editing is unavailable.

When creating or editing a job you can fill in:

- **Job start date** and **Job end date** — define the planned window. Both are required (at creation and on every subsequent save from the detail page) so jobs always carry a planning window; the end date must not precede the start date.
- **Client order** — links the job to a confirmed customer order. This field is required at creation and when saving from the detail page; choosing an order sets the job's client from that order and locks it.
- **Offer reference** — links the job to an accepted offer when you need to track its commercial origin. This field is optional and can stay empty.
- **Type** — classifies the job as **Active** (Attivo) or **Passive** (Passivo). It is a required field (with the same `*` marker as Client and Job Name): the job can't be created until you pick a value, and the selected type is shown in the jobs archive and on the detail page. Jobs that already existed before this field was introduced default to **Active**, but the **first time** one is edited from the detail page you must explicitly confirm the type: the selector starts empty and the save is blocked until you choose a value, so the choice isn't silently left at the default.
- **Status** — tracks the job lifecycle and is visible as a column in the jobs archive. The values are **Da fare** (planned job, time entries allowed), **In corso** (active job, time entries allowed), **In pausa** (paused job, time entries blocked), and **Terminato** (closed job, time entries blocked). The selector, information summary, and badges use consistent media-player icons: a Stop square for **Da fare**, Play for **In corso**, Pause for **In pausa**, and a checkmark for **Terminato**. The form shows an information icon next to the **Status** label with a short hover/focus summary. New jobs start as **Da fare**; existing jobs are initialized as **In corso**. **In pausa** and **Terminato** do not disable the job record: it remains visible in management for history and reopening by changing status.
- **Job revenue** — resolved with this precedence: (1) if the activities have a per-row revenue, the job revenue is the read-only sum of activity total revenues (`revenue × duration`); (2) otherwise you can enter it manually. The linked order total is not imported automatically as job revenue.

When a job ends, move its status to **Terminato** to block new time entries, then check that tasks are consistent and that no pending entries remain.

### Resales

The **Resales** entry in the Projects module manages economic resale operations separately from operational tasks, timesheets, and user assignments. The page is split into **Resales** and **Activities** tabs: the first tab shows the resales list with start and end dates, while Activities becomes available after selecting a resale and contains the economic summary plus resale activities. When creating a resale, you must select a **client order**, exactly one **supplier order** linked to that client order, set the required **start date** and **resale due date**, and add at least one **resale activity** in the initial activities table: the system accepts the supplier order only when at least one client-order line references it.

Each resale shows **Resale revenue** as the sum of the revenues entered on its activities. The official **Resale cost** is imported from the supplier order total and is not edited manually. The create form shows both values as read-only fields while you fill in the activities. Resale activities are entered manually and include activity name, billing frequency (monthly, quarterly, annual, or one-time), category, cost, revenue, released status, independent due date, and notes.

Activity costs remain editable: when the sum of activity costs does not match the supplier order total, the view shows a **variance**. The variance is an operational warning and does not block saving, so you can reconcile the activity costs progressively.

Resale categories are a dedicated catalog seeded with **Hardware**, **Sottoscrizione**, and **Licenza**. You manage them from the **Resale Categories** button in the Resales view or from the **Category** control inside the create-resale form, matching the internal-listing product category flow; a category used by activities cannot be deleted.

Access is controlled by separate **Resales** permissions (`projects.resales.view/create/update/delete`), granted to the Manager and Top Manager profiles by default.

### Job rules

The **Job rules** section on the detail page lets you create automatic controls for a job. A rule compares one or more job fields (revenue, logged hours, days until deadline, billing, or status; cost fields require the **Cost reports** permission) against thresholds, values, or compatible fields and can combine conditions with **AND** or **OR**. The status field uses the same lifecycle values as the job: **Da fare**, **In corso**, **In pausa**, and **Terminato**. When the rule becomes true, it can run one or more actions: send notifications to selected assigned users or roles, and send a JSON event to one of the webhook targets enabled by administrators. The webhook payload includes the job, rule, and available metrics; cost metrics are included only when the rule condition uses cost fields. The section is shown and edited through the **Project Rules** permission (`projects.rules`), granted to Managers and Top Managers by default. Actions fire only on the transition from not met to met, so they are not duplicated while the rule remains true. Re-enabling a rule or changing its condition prepares it to run again on the next scheduled check.

### Assigning users

The **Assign Users** command manages who is assigned to a job or one of its activities. Access to this dialog is governed by the **Project Assignments** permission: the **View** action lets a role open the assignments of any job or activity regardless of its own membership, while **Update** lets it edit them. Managers and Top Managers hold both by default, so they can manage assignments even when they are not members of the job or activity.

## Competence centers

Competence centers connect people, costs, and assignments. They support HR analysis and economic job control.

Only users with the right permissions should change costs, assignments, or historical data.
