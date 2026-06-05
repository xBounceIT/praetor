import { describe, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

// The green "Fornitore" cost badge was replaced by a shadcn tooltip (the shared
// SupplierQuoteCostHint icon) shown next to the cost field on linked lines. The
// icon — not the input — is the tooltip trigger on purpose: wrapping the cost
// input in a Radix TooltipTrigger collapses the cell in the editor grid.
const REMOVED_BADGE_MARKERS = [
  'sales:clientQuotes.supplierQuoteBadge',
  'bg-emerald-600 text-white text-[8px]',
  // The cost field must not be wrapped in / carry the tooltip itself.
  'title={\n',
] as const;

describe('supplier-quote cost hint', () => {
  test.each([
    ['client quotes', 'sales/ClientQuotesView.tsx'],
    ['client offers', 'sales/ClientOffersView.tsx'],
  ])('%s shows the cost hint on linked lines', async (_name, path) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      "import SupplierQuoteCostHint from '../shared/SupplierQuoteCostHint';",
      '{isLinkedToSupplierQuote && <SupplierQuoteCostHint />}',
    ]);
    expectSourceOmitsAll(source, REMOVED_BADGE_MARKERS);
  });

  test('client orders shows the cost hint and keeps the supplier-order badge', async () => {
    const source = await readComponentSource('accounting/ClientsOrdersView.tsx');

    expectSourceContainsAll(source, [
      "import SupplierQuoteCostHint from '../shared/SupplierQuoteCostHint';",
      '{item.supplierQuoteItemId && <SupplierQuoteCostHint />}',
      "t('accounting:clientsOrders.supplierOrderBadge'",
    ]);
    expectSourceOmitsAll(source, ['sales:clientQuotes.supplierQuoteBadge', 'bg-emerald-600']);
  });
});
