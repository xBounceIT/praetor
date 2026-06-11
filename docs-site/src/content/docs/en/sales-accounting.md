---
title: Sales and accounting
description: Workflows for quotes, offers, orders, customer invoices, and supplier documents.
sidebar:
  order: 5
---

## Customer quotes and offers

Quotes and offers include products, quantities, prices, discounts, and terms. Use the catalog to start from consistent data and always check totals, margins, and validity before sending a document.

Each quote line includes a **Duration** column, placed between **Quantity** and **Cost**: it sets how long the service runs. A selector next to the value lets you pick the unit — **Months** or **Years** (1 year = 12 months) — using the same *value / unit* format as quantity. Duration acts as a multiplier alongside quantity, so both the line's **Total cost** and **Revenue** are computed as *unit value × Quantity × Duration (in months)*. For one-off items leave **Duration = 1 month** so totals stay identical to the previous behavior.

**Duration** flows through the whole document chain: when you convert a quote into an offer and then into a sales order, the lines keep both the value and the unit (months or years) you set, so the derived document's totals match the quote. **Customer invoices** also carry the Duration column on their lines and multiply the taxable amount (and therefore VAT and total) by the corresponding months; on invoices the duration is set manually, since invoice lines are not copied automatically from an order.

Duration applies to **every line**, regardless of the quantity unit (**Hours**, **Days**, or **Unit**): the Duration field is editable with the **Months** / **Years** / **N/A** selector and multiplies the line totals. Selecting **N/A** marks the line as duration-less: the numeric field beside it is disabled and the line totals are not multiplied by duration.

The quote list shows code, insertion date, client, subtotal, discount percentage, absolute discount, discounted total, margin, MOL, payment terms, due date, and status so the main values can be checked without opening each record.

The client quote **Status** follows the **Draft → Sent → Offer → Accepted / Denied** pipeline. The **Expired** status is derived automatically from the **Expiration Date** (once it has passed) and takes precedence over the displayed status; an **Accepted** or **Denied** quote is never shown as Expired. A quote can return to **Draft** only from **Sent** or **Offer**: from Accepted, Denied, or Expired the transition is not allowed. **Accepted** and **Denied** are terminal — once a quote reaches either, its status can no longer change at all (downstream offers and orders may already depend on that final state). You leave Expired only by extending the **Expiration Date** (always editable), not by changing the status manually.

When a client quote moves to **Offer**, Praetor automatically creates the linked **Customer Offer** by copying the quote's lines, discounts, terms, and expiration date. If the linked offer is still **Draft** and has not generated orders, you can move the quote back to **Draft**; that rollback removes the draft offer together with the status change. Once the offer has progressed or has downstream documents, the quote remains read-only.

A client quote is associated with supplier quotes purely through its **product lines** — each line can be sourced from a supplier quote item (there is no separate header field). While any supplier quote a line sources is **Expired**, the client quote shows an indicator and cannot progress to **Sent**, **Offer**, or **Accepted** until you extend that supplier quote's validity.

When creating or editing a **quote** or an **offer**, each **Products / Services** row that references a **Supplier Quote** or a **product** shows a quick-view icon; on **client orders** and **client invoices** the same icon opens the row's linked **product**. Open it to inspect the linked record on its pre-filtered page in a new browser tab, without closing or changing the document in progress. The icon is always shown (so rows stay aligned) when you have permission to access the destination view: if the row has no record to open, it stays visible but disabled, with a tooltip saying so. On the destination page the filter is applied through the column's native filter (**Code**), so it stays visible and you can clear it from the filter menu to return to the full list. Removing a row asks for confirmation first: clicking the trash icon opens a prompt, so an accidental click never drops a product line until you confirm.

In offer summaries, the **Discount** row always shows the equivalent percentage in parentheses, even when the global discount is entered as a fixed amount. The discount amount remains visible in currency on the right.

In the **Customer Offers** list, the visible date is the **Delivery Date**: it is set when an offer moves to sent status and no longer represents the technical record creation date. The table also shows subtotal, discount percent, absolute discount, discounted total, margin, MOL, and payment terms so offers can be compared without opening each record.

When a customer offer is accepted, Praetor automatically creates the linked customer order in **Draft**. Lines linked to derived and accepted supplier quotes also generate the related supplier orders, matching the manual conversion path.

Customer offers in **Accepted** or **Denied** status can be moved back to **Draft** from the row actions menu only by Top Manager or admin users. Praetor requires confirmation, lets the user enter a reason, and records the change in history/audit; the action is unavailable once a sale order has already been created from the offer.

Customer offers follow the same expiration model as quotes: every offer has a mandatory **Expiration Date**, and once it passes a **Draft** or **Sent** offer shows the derived **Expired** status (an **Accepted** or **Denied** offer is never shown as Expired). An expired offer is read-only, cannot change status, and cannot be deleted — the only way out is extending the **Expiration Date**, which becomes editable again in the offer form once the offer expires. Expired documents can be isolated with the **Status** column filter, where **Expired** appears as its own option (on offers and on client quotes alike). When you convert a quote whose date has already passed, the new offer starts with a fresh one-month validity window instead of inheriting the dead date.

## Supplier quotes

Supplier quotes help compare purchase costs and conditions. Link rows to the correct products when possible so data remains traceable in later workflows.

In the **Supplier Information** section of the **New Supplier Quote** dialog you must link a **Customer**: every supplier quote has to be associated with a customer. The field is mandatory — it carries the `*` indicator like **Supplier** and **Quote Code**, and saving is blocked until a customer is selected; the empty *No customer* option no longer exists. The linked customer is visible both in the quote detail and in the **Customer** column of the list.

The supplier quote **Status** is fully derived and can never be changed manually. A supplier quote that no client document sources is always a **Draft** (and that is when its items appear among the per-line options in the client quote form); once a client quote's lines source it, the status follows the most-advanced sourcing document: **Sent** when that client quote is sent, **Offer** once a client offer is created from it, **Accepted**/**Denied** when the quote or its offer reaches a terminal state. **Expired** appears when the supplier quote's **own Expiration Date** passes, or when the sourcing quote/offer expires. The **Expiration Date** stays editable in any status to renew validity.

The **Items** table makes the purchase pricing chain explicit with the **Product**, **List Price**, **Discount to Us (%)**, **Unit Cost**, **Qty**, **Duration**, and **Total** columns. Enter the supplier's list price and the discount percentage they grant you (capped at 0–100%, since a larger discount would push the cost below zero): Praetor derives the **Unit Cost** as `List Price × (1 − Discount to Us / 100)`, while the row **Total** is `Unit Cost × Qty × Duration (in months)`. The Unit Cost field is read-only because it is derived. In the **Summary**, the **Subtotal** sums the list prices (`List Price × Qty × Duration`), the **Discount** row highlights the total discount granted by the suppliers, and the **Total** reports the net cost (`Unit Cost × Qty × Duration`). The Discount row appears only when at least one line has a discount.

The **Duration** column sits after **Qty** and works exactly like the one on [client quotes](#customer-quotes-and-offers): it multiplies the row total by the number of months, with a **Months** / **Years** / **N/A** selector (1 year = 12 months). It applies to **every line**, regardless of the quantity unit (**Hours**, **Days**, or **Unit**). Selecting **N/A** marks the line as duration-less: the numeric field beside it is disabled and the row total is not multiplied by duration. For one-off items leave **Duration = 1 month** (or **N/A**) so totals stay identical to the previous behavior.

Item quantities and costs stay in sync with the client documents that use them, in both directions: editing the quantity or cost of a supplier-sourced line inside a client quote or offer retroactively updates the supplier quote item (the list price is recomputed keeping the **Discount to Us**). Only a genuine edit is pushed — re-saving a document that still holds older values (for example after changing just the notes) never overwrites changes made directly on the supplier quote, and a freshly linked line starts from the supplier quote's current values; if you deliberately change its quantity or cost before the first save — including while creating a brand-new quote or offer — that edit counts as genuine and is pushed onto the supplier quote too. Pushing the change also requires the supplier-quote update permission. Conversely, when a supplier quote is edited directly, the client quote/offer lines that use it show a **Data drifted — sync?** button that pulls the latest values back into the line. Lines sourced from a supplier quote that already generated an order — or whose status is **Accepted**, **Denied**, or **Expired** — stay locked, and a supplier quote whose items are used by client quotes, offers, or orders can no longer be deleted, restored to an earlier version, or have its **Quote Code** changed. Its items stay editable in place — pricing, quantity, notes and other details can change, and the client lines that use them pick the new values up through the **Data drifted — sync?** button — but an item used by a client line cannot be removed or repointed to a different product (the other header fields — payment terms, notes, customer, and the always-editable expiration date — stay editable as well). When a client order is created and a line-sourced supplier quote is not in **Accepted** status (only the supplier quote linked to the client document follows its status), no supplier order is generated for it and the response reports a warning.

You can attach the supplier's files (**xlsx**, **pdf**, or **docx**, up to 10 MB each) in the **Attachments** section. Files can be added straight from the **New Supplier Quote** dialog — they are queued while you fill in the quote and uploaded automatically when you save it — as well as later while the quote is still a draft. Attachments can only be changed on draft quotes with no linked order; once the quote leaves draft or an order is created from it the section becomes read-only and existing files can only be downloaded.

## Orders

Customer and supplier orders consolidate operational information. Before confirming, check the record, rows, discounts, payment terms, and links to previous documents.

A sale order created automatically from an accepted offer starts as a **Draft** and stays fully editable (client, rows, discounts, notes, and payment terms) while it is a draft. It becomes read-only only after it is **Confirmed** or **Denied**.

Rows that automatically generated a **supplier order** (identifiable from the *Supplier order* column) stay locked even in draft: they cannot be removed, nor can their product or quantity change, so the linked procurement order never falls out of sync. You can still update their sale price, add other rows, and edit the header fields. The *Supplier order* column carries the same quick-view icon as the product column: it is always shown (so rows stay aligned), and when the row is linked to a supplier order it opens that order — already filtered — in a new tab, so you can review it without leaving the order you are editing. When there is no linked supplier order the icon stays visible but disabled, with a tooltip saying so.

**Supplier orders** inherit the **Duration** column from the quote: when you create an order from a supplier quote (with the dedicated button or through the automatic conversion) each line keeps the number of months you set and the order **Total** is computed as `Unit Cost × Qty × Duration`, so it matches the quote instead of collapsing the duration to a single month. The duration stays editable, with the **Months** / **Years** / **N/A** selector, while the order is a draft; choosing **N/A** leaves the line out of the duration multiplier.

## Invoices

Customer and supplier invoices should match actual orders and deliveries. Check taxable amounts, VAT, totals, and references to the linked document.

After an invoice leaves draft status it becomes read-only: it cannot be moved back to draft or deleted. Delete only draft invoices that were created by mistake, before issuing them.

The amount paid cannot exceed the invoice total. When an invoice is set to **paid**, the amount paid must cover at least the full total; otherwise Praetor rejects the save so aging, balances, and reports stay consistent.

Both **customer and supplier invoices** carry the **Duration** column on their lines, with the same **Months** / **Years** / **N/A** selector, and multiply the line total by the corresponding months. When you create a **supplier invoice** from a supplier order the duration is carried over so the invoice total matches the order; otherwise it can be edited per line while the invoice is a draft. Selecting **N/A** leaves the line out of the duration multiplier.

Praetor rounds taxable amounts, VAT, costs, and totals to two currency decimals using commercial half-cent rounding: values such as 1.005 become 1.01.

### Per-line VAT (IVA)

Each customer-invoice line carries its own VAT rate (percent). New lines default to 22% (the standard Italian rate), but you can edit it to reflect reduced rates (10%, 5%, 4%) or exempt lines (0%). The summary panel shows the taxable subtotal, the total VAT, and the grand total (taxable + VAT). Invoices created before this feature was added load with 0% VAT, so their grand total remains unchanged.

If a document comes from an order or offer, use the automatic link to preserve traceability.
