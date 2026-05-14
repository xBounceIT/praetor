---
title: Sales and accounting
description: Workflows for quotes, offers, orders, customer invoices, and supplier documents.
sidebar:
  order: 4
---

## Customer quotes and offers

Quotes and offers include products, quantities, prices, discounts, and terms. Use the catalog to start from consistent data and always check totals, margins, and validity before sending a document.

When a document is accepted, continue by creating the linked order or next document instead of manually entering the same rows again.

## Supplier quotes

Supplier quotes help compare purchase costs and conditions. Link rows to the correct products when possible so data remains traceable in later workflows.

## Orders

Customer and supplier orders consolidate operational information. Before confirming, check the record, rows, discounts, payment terms, and links to previous documents.

## Invoices

Customer and supplier invoices should match actual orders and deliveries. Check taxable amounts, VAT, totals, and references to the linked document.

After an invoice leaves draft status it becomes read-only: it cannot be moved back to draft or deleted. Delete only draft invoices that were created by mistake, before issuing them.

The amount paid cannot exceed the invoice total. When an invoice is set to **paid**, the amount paid must cover at least the full total; otherwise Praetor rejects the save so aging, balances, and reports stay consistent.

### Per-line VAT (IVA)

Each customer-invoice line carries its own VAT rate (percent). New lines default to 22% (the standard Italian rate), but you can edit it to reflect reduced rates (10%, 5%, 4%) or exempt lines (0%). The summary panel shows the taxable subtotal, the total VAT, and the grand total (taxable + VAT). Invoices created before this feature was added load with 0% VAT, so their grand total remains unchanged.

If a document comes from an order or offer, use the automatic link to preserve traceability.
