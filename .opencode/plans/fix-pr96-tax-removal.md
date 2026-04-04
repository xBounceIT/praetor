# Plan: Fix PR 96 — remove pricing tax logic

## Problem
PR 96 removes tax fields from types, UI components, and server routes, but the normalizers still reference removed tax fields. This will cause TypeScript compilation failures.

## Fixes Required

### 1. Fix `services/api/normalizers.ts` (HIGH PRIORITY - blocks build)

Remove the following tax-related normalization lines:

**Line 111 - `normalizeProduct`:**
```typescript
// REMOVE: taxRate: Number(p.taxRate || 0),
```

**Lines 120-123 - `normalizeQuoteItem`:**
```typescript
// REMOVE:
//   productTaxRate:
//     item.productTaxRate === undefined || item.productTaxRate === null
//       ? 0
//       : Number(item.productTaxRate),
```

**Lines 168-171 - `normalizeClientOfferItem`:**
```typescript
// REMOVE:
//   productTaxRate:
//     item.productTaxRate === undefined || item.productTaxRate === null
//       ? 0
//       : Number(item.productTaxRate),
```

**Lines 216-219 - `normalizeClientsOrderItem`:**
```typescript
// REMOVE:
//   productTaxRate:
//     item.productTaxRate === undefined || item.productTaxRate === null
//       ? 0
//       : Number(item.productTaxRate),
```

**Line 279 - `normalizeInvoiceItem`:**
```typescript
// REMOVE: taxRate: Number(item.taxRate || 0),
```

**Line 286 - `normalizeInvoice`:**
```typescript
// REMOVE: taxAmount: roundToTwoDecimals(Number(i.taxAmount ?? 0)),
```

**Lines 312-315 - `normalizeSupplierSaleOrderItem`:**
```typescript
// REMOVE:
//   productTaxRate:
//     item.productTaxRate === undefined || item.productTaxRate === null
//       ? 0
//       : Number(item.productTaxRate),
```

**Line 330 - `normalizeSupplierInvoiceItem`:**
```typescript
// REMOVE: taxRate: Number(item.taxRate || 0),
```

**Line 337 - `normalizeSupplierInvoice`:**
```typescript
// REMOVE: taxAmount: roundToTwoDecimals(Number(invoice.taxAmount ?? 0)),
```

### 2. Fix `types.ts` - Remove tax fields from types

**`Product` interface (line 194):**
```typescript
// REMOVE: taxRate: number;
```

**`QuoteItem` interface (line 225):**
```typescript
// REMOVE: productTaxRate?: number;
```

**`ClientOfferItem` interface (line 277):**
```typescript
// REMOVE: productTaxRate?: number;
```

**`ClientsOrderItem` interface (line 326):**
```typescript
// REMOVE: productTaxRate?: number;
```

**`InvoiceItem` interface (line 464):**
```typescript
// REMOVE: taxRate: number;
```

**`Invoice` interface (line 478):**
```typescript
// REMOVE: taxAmount: number;
```

**`SupplierSaleOrderItem` interface (line 547):**
```typescript
// REMOVE: productTaxRate?: number;
```

**`SupplierInvoiceItem` interface (line 584):**
```typescript
// REMOVE: taxRate: number;
```

**`SupplierInvoice` interface (line 598):**
```typescript
// REMOVE: taxAmount: number;
```

### 3. Apply PR 96 changes

Since the PR branch can't be checked out (worktree conflict), the PR diff needs to be applied manually. The diff covers:

- `App.tsx` - Remove tax-related fields from invoice creation
- `components/accounting/ClientsInvoicesView.tsx` - Remove tax UI and calculations
- `components/accounting/ClientsOrdersView.tsx` - Remove tax UI and calculations
- `components/accounting/SupplierInvoicesView.tsx` - Remove tax UI and calculations
- `components/accounting/SupplierOrdersView.tsx` - Remove tax UI and calculations
- `components/catalog/ExternalListingView.tsx` - Remove tax UI and calculations
- `components/catalog/InternalListingView.tsx` - Remove tax UI and calculations
- `components/sales/ClientOffersView.tsx` - Remove tax UI and calculations
- `components/sales/ClientQuotesView.tsx` - Remove tax UI and calculations
- `components/sales/SupplierQuotesView.tsx` - Remove tax UI and calculations
- `server/routes/*.ts` - Remove tax from server validation and queries
- `server/db/schema.sql` - Note: tax columns still exist as dead columns
- `docs/` - Regenerated docs

### 4. DB Migration (optional but recommended)

Create a migration to:
1. Drop `tax_rate` columns from: `products`, `quote_items`, `sale_items`, `invoice_items`, `supplier_invoice_items`, `supplier_sale_items`
2. Drop `tax_amount` columns from: `invoices`, `supplier_invoices`
3. Update existing invoice totals to equal subtotal (remove tax component)

### Verification Steps

```bash
# Frontend typecheck
bun run build

# Server typecheck
cd server && bun run build

# Lint
bun run lint

# Generate docs
bun run docs
```
