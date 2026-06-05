import { describe, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

// The standalone green "Fornitore" cost badge was replaced by a hover tooltip
// (native `title`) that surfaces the same supplier-quote context on the cost
// field. A native title is used on purpose: the edit modal is sensitive to extra
// render machinery (see the modal render-loop issue), so the cost field must stay
// a plain element rather than a Radix tooltip trigger.
const REMOVED_BADGE_MARKERS = [
  'sales:clientQuotes.supplierQuoteBadge',
  'bg-emerald-600 text-white text-[8px]',
] as const;

// The translation key only appears in the cost-field title ternary, so matching
// this exact fragment ties the tooltip text to the title attribute.
const COST_TOOLTIP_TITLE = "? t('sales:clientQuotes.supplierQuoteCostTooltip')";

describe('supplier-quote cost tooltip', () => {
  test.each([
    ['client quotes', 'sales/ClientQuotesView.tsx'],
    ['client offers', 'sales/ClientOffersView.tsx'],
  ])('%s shows the cost tooltip via a native title on the cost field', async (_name, path) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, ['title={', COST_TOOLTIP_TITLE]);
    expectSourceOmitsAll(source, REMOVED_BADGE_MARKERS);
  });

  test('client orders shows the cost tooltip and keeps the supplier-order badge', async () => {
    const source = await readComponentSource('accounting/ClientsOrdersView.tsx');

    expectSourceContainsAll(source, [
      'title={',
      COST_TOOLTIP_TITLE,
      // The separate blue "supplier order" badge stays.
      "t('accounting:clientsOrders.supplierOrderBadge'",
    ]);
    expectSourceOmitsAll(source, ['sales:clientQuotes.supplierQuoteBadge', 'bg-emerald-600']);
  });
});
