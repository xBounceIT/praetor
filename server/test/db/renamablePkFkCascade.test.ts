import { describe, expect, test } from 'bun:test';
import { listSchemaFiles, readSchemaFile } from '../helpers/schemaFiles.ts';

// Every PK that supports renaming via a repo `rename()` function must have all incoming FKs
// declared with `onUpdate: 'cascade'`. Without that, the rename will fail mid-transaction
// when a child row's FK can't follow the parent id change.

type RenamablePk = {
  /** Drizzle table identifier as it appears in `.references(() => <table>.id)`. */
  tableIdentifier: string;
  /** Minimum FK count expected — pinned so a regression in the discovery regex fails loudly. */
  minimumFks: number;
};

// Update this list when adding a new repo `rename()` function.
const RENAMABLE_PKS: readonly RenamablePk[] = [
  // clientOffersRepo.rename — FKs from customer_offer_items, offer_versions, projects,
  // sales (linked_offer_id).
  { tableIdentifier: 'customerOffers', minimumFks: 4 },
  // clientQuotesRepo.rename — FKs from quote_items, quote_versions, customer_offers
  // (linked_quote_id), sales (linked_quote_id).
  { tableIdentifier: 'quotes', minimumFks: 4 },
  // invoicesRepo.renameDraft — FK from invoice_items.
  { tableIdentifier: 'invoices', minimumFks: 1 },
  // clientsOrdersRepo.rename — FKs from sale_items, invoices, sales_versions, projects.order_id.
  { tableIdentifier: 'sales', minimumFks: 4 },
  // supplierOrdersRepo.rename — FKs from supplier_sale_items, supplier_order_versions,
  // supplier_invoices (linked_sale_id).
  { tableIdentifier: 'supplierSales', minimumFks: 3 },
  // supplierQuotesRepo.rename — FKs from supplier_quote_items, supplier_quote_attachments,
  // supplier_quote_versions, supplier_sales (linked_quote_id).
  { tableIdentifier: 'supplierQuotes', minimumFks: 4 },
  // supplierInvoicesRepo.rename — FK from supplier_invoice_items.
  { tableIdentifier: 'supplierInvoices', minimumFks: 1 },
];

// Drizzle accepts a bare `.references(() => table.id)` with no second arg (defaulting to
// NO ACTION on update). The options object is intentionally optional in the capture group
// so such an FK still surfaces here — the per-FK assertion will fail because an empty
// options block can't contain `onUpdate: 'cascade'`.
//
// Limitation: the lazy `[\s\S]*?` capture stops at the first `}`. If a future Drizzle
// FK option ever introduces a nested object (e.g. `{ onDelete: 'cascade', meta: { x: 1 } }`),
// this regex would truncate at the inner `}` and miss `onUpdate` after it. None of the
// current Drizzle FK options nest, so keep options blocks flat or upgrade this matcher.
const referenceRegex = (tableIdentifier: string) =>
  new RegExp(
    `\\.references\\(\\s*\\(\\s*\\)\\s*=>\\s*${tableIdentifier}\\.id\\s*(?:,\\s*\\{([\\s\\S]*?)\\})?\\s*\\)`,
    'g',
  );

const schemaFiles = listSchemaFiles();

for (const { tableIdentifier, minimumFks } of RENAMABLE_PKS) {
  describe(`every FK to ${tableIdentifier}.id declares onUpdate: cascade`, () => {
    const fks = schemaFiles.flatMap((file) => {
      const content = readSchemaFile(file);
      return [...content.matchAll(referenceRegex(tableIdentifier))].map((match, index) => ({
        file,
        index,
        optionsBlock: match[1] ?? '',
      }));
    });

    test(`discovers at least ${minimumFks} FK(s)`, () => {
      expect(fks.length).toBeGreaterThanOrEqual(minimumFks);
    });

    test.each(fks)(`FK #$index in $file declares onUpdate: cascade`, ({ optionsBlock }) => {
      expect(optionsBlock).toMatch(/onUpdate:\s*'cascade'/);
    });
  });
}
