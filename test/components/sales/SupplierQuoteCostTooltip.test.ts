import { describe, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

// The standalone green "Fornitore" cost badge was replaced by a tooltip that
// surfaces the same supplier-quote context on hover over the cost field.
const REMOVED_BADGE_MARKERS = [
  'sales:clientQuotes.supplierQuoteBadge',
  'bg-emerald-600 text-white text-[8px]',
] as const;

describe('supplier-quote cost tooltip', () => {
  test.each([
    ['client quotes', 'sales/ClientQuotesView.tsx'],
    ['client offers', 'sales/ClientOffersView.tsx'],
  ])('%s gates the cost tooltip on the supplier-quote link', async (_name, path) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      '<Tooltip disabled={!isLinkedToSupplierQuote}>',
      "t('sales:clientQuotes.supplierQuoteCostTooltip')",
    ]);
    expectSourceOmitsAll(source, REMOVED_BADGE_MARKERS);
  });

  test('client orders gates the cost tooltip on the linked supplier quote and keeps the supplier-order badge', async () => {
    const source = await readComponentSource('accounting/ClientsOrdersView.tsx');

    expectSourceContainsAll(source, [
      '<Tooltip disabled={!item.supplierQuoteItemId}>',
      "t('sales:clientQuotes.supplierQuoteCostTooltip')",
      // The separate blue "supplier order" badge stays.
      "t('accounting:clientsOrders.supplierOrderBadge'",
    ]);
    expectSourceOmitsAll(source, ['sales:clientQuotes.supplierQuoteBadge', 'bg-emerald-600']);
  });
});
