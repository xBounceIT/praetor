import { describe, expect, test } from 'bun:test';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const CostSummaryPanel = (await import('../../../components/shared/CostSummaryPanel')).default;

describe('<CostSummaryPanel />', () => {
  test('renders fallback "0.00" for NaN subtotal/total without throwing', () => {
    const { container } = render(
      <CostSummaryPanel
        currency="EUR"
        subtotal={Number.NaN}
        total={Number.NaN}
        subtotalLabel="Subtotal"
        totalLabel="Total"
      />,
    );
    // Neither value should leak the string "NaN" into the DOM.
    expect(container.textContent).not.toContain('NaN');
    // Two amount fields (subtotal, total) → at least two "0.00" placeholders.
    const matches = container.textContent?.match(/0\.00/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('renders "0.00" for undefined-shaped numeric values (cast)', () => {
    // The contract says number, but defensive consumers can still hit this if
    // they cast `undefined` through `as unknown as number`.
    const { container } = render(
      <CostSummaryPanel
        currency="EUR"
        subtotal={undefined as unknown as number}
        total={undefined as unknown as number}
        subtotalLabel="Subtotal"
        totalLabel="Total"
      />,
    );
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('undefined');
  });

  test('renders finite values normally and is unaffected by the guard', () => {
    const { container } = render(
      <CostSummaryPanel
        currency="EUR"
        subtotal={100.5}
        total={120.75}
        subtotalLabel="Subtotal"
        totalLabel="Total"
        discountRow={{ label: 'Discount', amount: 5.25 }}
        margin={{ label: 'Margin', amount: 30.5 }}
        balanceDue={{ label: 'Balance', amount: 90.25 }}
      />,
    );
    expect(container.textContent).toContain('100.50');
    expect(container.textContent).toContain('120.75');
    expect(container.textContent).toContain('5.25');
    expect(container.textContent).toContain('30.50');
    expect(container.textContent).toContain('90.25');
  });

  test('NaN values in optional rows (margin, balance) also fall back to 0.00', () => {
    // discountRow is gated on `amount > 0`, so NaN there silently drops the row.
    // margin and balanceDue always render — they are the rows that need the guard.
    const { container } = render(
      <CostSummaryPanel
        currency="EUR"
        subtotal={50}
        total={50}
        subtotalLabel="Subtotal"
        totalLabel="Total"
        margin={{ label: 'Margin', amount: Number.NaN }}
        balanceDue={{ label: 'Balance', amount: Number.NaN }}
      />,
    );
    expect(container.textContent).not.toContain('NaN');
  });
});
