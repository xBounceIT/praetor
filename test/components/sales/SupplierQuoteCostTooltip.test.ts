import { describe, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

// The green "Fornitore" cost badge was replaced by a hover hint on the cost
// field. It is a native `title` for now: wrapping the cost input in a Radix
// TooltipTrigger collapses the cell in the editor grid, so the field stays a
// plain element until that is solved.
const REMOVED_BADGE_MARKERS = [
  'sales:clientQuotes.supplierQuoteBadge',
  'bg-emerald-600 text-white text-[8px]',
] as const;

const COST_TOOLTIP_KEY = "t('sales:clientQuotes.supplierQuoteCostTooltip')";

describe('supplier-quote cost hint', () => {
  test.each([
    ['client quotes', 'sales/ClientQuotesView.tsx'],
    ['client offers', 'sales/ClientOffersView.tsx'],
  ])('%s shows the cost hint when the line is linked to a supplier quote', async (_name, path) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, ['title={', `isLinkedToSupplierQuote\n`, COST_TOOLTIP_KEY]);
    expectSourceOmitsAll(source, REMOVED_BADGE_MARKERS);
  });

  test('client orders shows the cost hint and keeps the supplier-order badge', async () => {
    const source = await readComponentSource('accounting/ClientsOrdersView.tsx');

    expectSourceContainsAll(source, [
      'title={',
      COST_TOOLTIP_KEY,
      "t('accounting:clientsOrders.supplierOrderBadge'",
    ]);
    expectSourceOmitsAll(source, ['sales:clientQuotes.supplierQuoteBadge', 'bg-emerald-600']);
  });
});
