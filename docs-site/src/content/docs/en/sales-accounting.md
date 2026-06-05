---
title: Sales and accounting
description: Workflows for quotes, offers, orders, customer invoices, and supplier documents.
sidebar:
  order: 5
---

## Customer quotes and offers

Quotes and offers include products, quantities, prices, discounts, and terms. Use the catalog to start from consistent data and always check totals, margins, and validity before sending a document.

Each quote line includes a **Duration** column (in months), placed between **Quantity** and **Cost**: it sets how many months the service runs. Duration acts as a multiplier alongside quantity, so both the line's **Total cost** and **Revenue** are computed as *unit value × Quantity × Duration (months)*. For one-off items leave **Duration = 1** so totals stay identical to the previous behavior.

**Duration** flows through the whole document chain: when you convert a quote into an offer and then into a sales order, the lines keep the months you set, so the derived document's totals match the quote. **Customer invoices** also carry the Duration column on their lines and multiply the taxable amount (and therefore VAT and total) by the months entered; on invoices the duration is set manually, since invoice lines are not copied automatically from an order.

The quote list shows code, insertion date, client, subtotal, discount percentage, absolute discount, discounted total, margin, MOL, payment terms, due date, and status so the main values can be checked without opening each record.

In offer summaries, the **Discount** row always shows the equivalent percentage in parentheses, even when the global discount is entered as a fixed amount. The discount amount remains visible in currency on the right.

In the **Customer Offers** list, the visible date is the **Delivery Date**: it is set when an offer moves to sent status and no longer represents the technical record creation date. The table also shows subtotal, discount percent, absolute discount, discounted total, margin, MOL, and payment terms so offers can be compared without opening each record.

When a document is accepted, continue by creating the linked order or next document instead of manually entering the same rows again.

Customer offers in **Accepted** or **Denied** status can be moved back to **Draft** from the row actions menu only by Top Manager or admin users. Praetor requires confirmation, lets the user enter a reason, and records the change in history/audit; the action is unavailable once a sale order has already been created from the offer.

## Supplier quotes

Supplier quotes help compare purchase costs and conditions. Link rows to the correct products when possible so data remains traceable in later workflows.

## Orders

Customer and supplier orders consolidate operational information. Before confirming, check the record, rows, discounts, payment terms, and links to previous documents.

A sale order created from an accepted offer starts as a **Draft** and stays fully editable (client, rows, discounts, notes, and payment terms) while it is a draft. It becomes read-only only after it is **Confirmed** or **Denied**.

Rows that automatically generated a **supplier order** (marked with the *Supplier order* badge) stay locked even in draft: they cannot be removed, nor can their product or quantity change, so the linked procurement order never falls out of sync. You can still update their sale price, add other rows, and edit the header fields.

## Invoices

Customer and supplier invoices should match actual orders and deliveries. Check taxable amounts, VAT, totals, and references to the linked document.

After an invoice leaves draft status it becomes read-only: it cannot be moved back to draft or deleted. Delete only draft invoices that were created by mistake, before issuing them.

The amount paid cannot exceed the invoice total. When an invoice is set to **paid**, the amount paid must cover at least the full total; otherwise Praetor rejects the save so aging, balances, and reports stay consistent.

Praetor rounds taxable amounts, VAT, costs, and totals to two currency decimals using commercial half-cent rounding: values such as 1.005 become 1.01.

### Per-line VAT (IVA)

Each customer-invoice line carries its own VAT rate (percent). New lines default to 22% (the standard Italian rate), but you can edit it to reflect reduced rates (10%, 5%, 4%) or exempt lines (0%). The summary panel shows the taxable subtotal, the total VAT, and the grand total (taxable + VAT). Invoices created before this feature was added load with 0% VAT, so their grand total remains unchanged.

If a document comes from an order or offer, use the automatic link to preserve traceability.
