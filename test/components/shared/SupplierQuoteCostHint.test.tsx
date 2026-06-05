import { describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const SupplierQuoteCostHint = (await import('../../../components/shared/SupplierQuoteCostHint'))
  .default;

describe('<SupplierQuoteCostHint />', () => {
  test('renders an icon trigger and shows the supplier-quote tooltip on hover', async () => {
    render(<SupplierQuoteCostHint />);

    const trigger = document.querySelector('[data-slot="tooltip-trigger"]') as HTMLElement;
    expect(trigger).toBeInTheDocument();

    await userEvent.hover(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'clientQuotes.supplierQuoteCostTooltip',
    );
  });
});
