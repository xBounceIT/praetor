import { describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

installI18nMock();

const ValidatedNumberInput = (await import('../../../components/shared/ValidatedNumberInput'))
  .default;
const { Tooltip, TooltipContent, TooltipTrigger } = await import('../../../components/ui/tooltip');

// Mirrors the cost-cell markup the views render when a line is linked to a
// supplier quote: a shadcn Tooltip wrapping the (disabled) cost input.
const renderCostCell = (linked: boolean) =>
  render(
    <Tooltip disabled={!linked}>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1 w-full">
          <ValidatedNumberInput value={965} formatDecimals={2} onValueChange={() => {}} disabled />
          <span className="text-[9px] font-semibold text-zinc-400 shrink-0">EUR</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Cost from supplier quote</TooltipContent>
    </Tooltip>,
  );

// The standalone green "Fornitore" cost badge was replaced by the shadcn tooltip.
const REMOVED_BADGE_MARKERS = [
  'sales:clientQuotes.supplierQuoteBadge',
  'bg-emerald-600 text-white text-[8px]',
] as const;

describe('supplier-quote cost tooltip', () => {
  test('keeps the cost field visible and shows the tooltip on hover when linked', async () => {
    renderCostCell(true);

    // The cost field stays rendered (the regression removed it entirely).
    const costField = screen.getByDisplayValue('965.00');
    expect(costField).toBeInTheDocument();

    await userEvent.hover(costField.closest('[data-slot="tooltip-trigger"]') as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Cost from supplier quote');
  });

  test('keeps the cost field visible but shows no tooltip when not linked', async () => {
    renderCostCell(false);

    const costField = screen.getByDisplayValue('965.00');
    expect(costField).toBeInTheDocument();

    await userEvent.hover(costField.closest('[data-slot="tooltip-trigger"]') as HTMLElement);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test.each([
    ['client quotes', 'sales/ClientQuotesView.tsx'],
    ['client offers', 'sales/ClientOffersView.tsx'],
  ])('%s wires the shadcn cost tooltip and drops the old badge', async (_name, path) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      '<Tooltip disabled={!isLinkedToSupplierQuote}>',
      "{t('sales:clientQuotes.supplierQuoteCostTooltip')}",
    ]);
    expectSourceOmitsAll(source, REMOVED_BADGE_MARKERS);
  });

  test('client orders wires the shadcn cost tooltip and keeps the supplier-order badge', async () => {
    const source = await readComponentSource('accounting/ClientsOrdersView.tsx');

    expectSourceContainsAll(source, [
      '<Tooltip disabled={!item.supplierQuoteItemId}>',
      "{t('sales:clientQuotes.supplierQuoteCostTooltip')}",
      // The separate blue "supplier order" badge stays.
      "t('accounting:clientsOrders.supplierOrderBadge'",
    ]);
    expectSourceOmitsAll(source, ['sales:clientQuotes.supplierQuoteBadge', 'bg-emerald-600']);
  });
});
