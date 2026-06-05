import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Client, ClientOffer, Product, SupplierQuote } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock({ includeInterpolatedValues: true });

mock.module('../../../components/sales/OfferVersionsPanel', () => ({
  default: () => null,
}));

const ClientOffersView = (await import('../../../components/sales/ClientOffersView')).default;

const clients: Client[] = [
  { id: 'c-1', name: 'Acme Corp' },
  { id: 'c-2', name: 'Globex Industries' },
];

const products: Product[] = [];
const supplierQuotes: SupplierQuote[] = [];

const buildOffer = (overrides: Partial<ClientOffer>): ClientOffer => ({
  id: 'O-base',
  linkedQuoteId: '',
  clientId: 'c-1',
  clientName: 'Acme Corp',
  items: [
    {
      id: 'item-1',
      offerId: overrides.id ?? 'O-base',
      productId: 'p-1',
      productName: 'Widget',
      quantity: 1,
      unitPrice: 100,
      productCost: 50,
      productMolPercentage: 50,
      unitType: 'unit',
    },
  ],
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  deliveryDate: null,
  expirationDate: '2099-12-31',
  notes: '',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

const acmeDraft = buildOffer({ id: 'O-ACME-DRAFT', clientId: 'c-1', clientName: 'Acme Corp' });
const globexSent = buildOffer({
  id: 'O-GLOBEX-SENT',
  clientId: 'c-2',
  clientName: 'Globex Industries',
  status: 'sent',
  deliveryDate: '2026-05-14',
  discount: 10,
  items: [
    {
      id: 'item-2',
      offerId: 'O-GLOBEX-SENT',
      productId: 'p-2',
      productName: 'Service',
      quantity: 2,
      unitPrice: 100,
      productCost: 60,
      productMolPercentage: 40,
      unitType: 'unit',
    },
  ],
  paymentTerms: '30gg',
});
const terminalAccepted = buildOffer({
  id: 'O-ACME-ACCEPTED',
  status: 'accepted',
});
const terminalDenied = buildOffer({
  id: 'O-ACME-DENIED',
  status: 'denied',
});

const baseProps = {
  offers: [acmeDraft, globexSent],
  clients,
  products,
  supplierQuotes,
  offerIdsWithOrders: new Set<string>(),
  onAddOffer: () => {},
  onUpdateOffer: () => {},
  onDeleteOffer: () => {},
  currency: 'EUR',
};

const tinySubtotalItem: ClientOffer['items'][number] = {
  id: 'tiny-item',
  offerId: 'O-base',
  productId: 'p-1',
  productName: 'Tiny Widget',
  quantity: 1,
  unitPrice: 0.03,
  productCost: 0,
  productMolPercentage: 0,
  unitType: 'unit',
};

afterEach(() => {
  document.body.style.overflow = '';
});

describe('<ClientOffersView /> list', () => {
  test('renders issue 461 offer-list columns in the requested order', () => {
    render(<ClientOffersView {...baseProps} />);
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers.slice(0, 11)).toEqual([
      'sales:clientOffers.offerColumn',
      'sales:clientOffers.deliveryDateColumn',
      'sales:clientOffers.clientColumn',
      'sales:clientOffers.subtotal',
      'sales:clientOffers.discountPercentColumn',
      'common:labels.discount',
      'sales:clientOffers.discountedTotalColumn',
      'sales:clientOffers.margin',
      'sales:clientOffers.molColumn',
      'sales:clientOffers.paymentTermsColumn',
      'sales:clientOffers.statusColumn',
    ]);
  });

  test('renders delivery date, MOL, and payment terms in offer rows', () => {
    render(<ClientOffersView {...baseProps} />);
    expect(screen.getByText('5/14/2026')).toBeInTheDocument();
    expect(screen.getByText('33.3%')).toBeInTheDocument();
    expect(screen.getByText('crm:paymentTerms.30gg')).toBeInTheDocument();
  });

  test('scales offer-row totals by a line item duration (issue #757)', () => {
    const durationOffer = buildOffer({
      id: 'O-DURATION',
      items: [
        {
          id: 'dur-item',
          offerId: 'O-DURATION',
          productId: 'p-1',
          productName: 'Service',
          quantity: 2,
          unitPrice: 100,
          productCost: 60,
          productMolPercentage: 40,
          unitType: 'unit',
          durationMonths: 3,
        },
      ],
    });
    render(<ClientOffersView {...baseProps} offers={[durationOffer]} />);
    // Subtotal (revenue) = 100 × 2 × 3 = 600 (would be 200 without duration).
    expect(screen.getAllByText('600.00 EUR').length).toBeGreaterThan(0);
    // Margin = 600 − (60 × 2 × 3 = 360) = 240, which only holds when both scale by duration.
    expect(screen.getAllByText('240.00 EUR').length).toBeGreaterThan(0);
  });

  test('renders fixed discounts as equivalent percentages in offer rows', () => {
    const fixedDiscountOffer = buildOffer({
      id: 'O-FIXED-DISCOUNT',
      discount: 15,
      discountType: 'currency',
    });

    render(<ClientOffersView {...baseProps} offers={[fixedDiscountOffer]} />);

    expect(screen.getByText('15%')).toBeInTheDocument();
    expect(screen.queryByText('15 EUR')).not.toBeInTheDocument();
    expect(screen.getByText('-15.00 EUR')).toBeInTheDocument();
  });

  test('sorts the global discount column by equivalent percentage', async () => {
    const user = userEvent.setup();
    const percentageDiscountOffer = buildOffer({
      id: 'O-PERCENT-10',
      discount: 10,
      discountType: 'percentage',
    });
    const fixedDiscountOffer = buildOffer({
      id: 'O-FIXED-5',
      discount: 10,
      discountType: 'currency',
      items: [
        {
          id: 'item-fixed',
          offerId: 'O-FIXED-5',
          productId: 'p-fixed',
          productName: 'Fixed discount service',
          quantity: 2,
          unitPrice: 100,
          productCost: 60,
          productMolPercentage: 40,
          unitType: 'unit',
        },
      ],
    });
    const zeroDiscountOffer = buildOffer({
      id: 'O-ZERO',
      discount: 0,
      discountType: 'percentage',
    });

    render(
      <ClientOffersView
        {...baseProps}
        offers={[zeroDiscountOffer, fixedDiscountOffer, percentageDiscountOffer]}
      />,
    );

    const sortButton = screen.getByRole('button', {
      name: 'sales:clientOffers.discountPercentColumn',
    });
    expect(sortButton).toBeEnabled();
    await user.click(sortButton);

    await waitFor(() => {
      const rows = screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent ?? '');
      expect(rows[0]).toContain('O-PERCENT-10');
      expect(rows[1]).toContain('O-FIXED-5');
      expect(rows[2]).toContain('O-ZERO');
    });
  });

  test('renders every offer passed in (no external search/status filter)', () => {
    render(<ClientOffersView {...baseProps} />);
    expect(screen.getByText('O-ACME-DRAFT')).toBeInTheDocument();
    expect(screen.getByText('O-GLOBEX-SENT')).toBeInTheDocument();
  });

  test('does not render the external search input or status filter', () => {
    render(<ClientOffersView {...baseProps} />);
    expect(
      screen.queryByPlaceholderText('sales:clientOffers.searchPlaceholder'),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('sales:clientOffers.filterByStatus')).not.toBeInTheDocument();
  });

  test('column status filter shows localized labels, not raw status keys', () => {
    render(<ClientOffersView {...baseProps} />);
    const statusFilterTrigger = screen.getByLabelText(
      `table.filters sales:clientOffers.statusColumn`,
    );
    fireEvent.click(statusFilterTrigger);
    expect(screen.getByText('sales:clientOffers.statusDraft')).toBeInTheDocument();
    expect(screen.getByText('sales:clientOffers.statusSent')).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'sent' })).not.toBeInTheDocument();
  });
});

describe('<ClientOffersView /> terminal status revert action', () => {
  test('hides terminal revert when caller is not privileged', () => {
    render(<ClientOffersView {...baseProps} offers={[terminalAccepted, terminalDenied]} />);

    expect(
      screen.queryByRole('button', { name: 'sales:clientOffers.revertToDraft' }),
    ).not.toBeInTheDocument();
  });

  test('hides terminal revert for accepted offers that already have a linked order', () => {
    render(
      <ClientOffersView
        {...baseProps}
        offers={[terminalAccepted]}
        offerIdsWithOrders={new Set([terminalAccepted.id])}
        canRevertTerminalStatus
        onRevertOfferToDraft={() => {}}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'sales:clientOffers.revertToDraft' }),
    ).not.toBeInTheDocument();
  });

  test('confirms terminal revert with an optional audit reason', async () => {
    const user = userEvent.setup();
    const onRevertOfferToDraft = mock(() => Promise.resolve());
    render(
      <ClientOffersView
        {...baseProps}
        offers={[terminalAccepted]}
        canRevertTerminalStatus
        onRevertOfferToDraft={onRevertOfferToDraft}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));
    await user.click(await screen.findByTestId('client-offer-revert-O-ACME-ACCEPTED'));
    await user.type(screen.getByLabelText('sales:clientOffers.revertReasonLabel'), 'wrong status');
    await user.click(
      screen.getByRole('button', { name: 'sales:clientOffers.confirmRevertToDraft' }),
    );

    await waitFor(() =>
      expect(onRevertOfferToDraft).toHaveBeenCalledWith('O-ACME-ACCEPTED', 'wrong status'),
    );
  });
});

describe('<ClientOffersView /> discount summary', () => {
  test('labels a fixed global discount with the equivalent percentage', () => {
    const fixedDiscountOffer = buildOffer({
      id: 'O-FIXED-DISCOUNT',
      discount: 15,
      discountType: 'currency',
    });

    render(<ClientOffersView {...baseProps} offers={[fixedDiscountOffer]} />);

    fireEvent.click(screen.getByText('O-FIXED-DISCOUNT'));

    expect(screen.getByText('sales:clientOffers.editOffer')).toBeInTheDocument();
    expect(screen.getByText('sales:clientOffers.discountAmount (15%)')).toBeInTheDocument();
    expect(screen.getAllByText('-15.00 EUR').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('sales:clientOffers.discountAmount (15 EUR)'),
    ).not.toBeInTheDocument();
  });

  test('keeps the entered percentage label when the rounded discount amount differs', () => {
    const percentageDiscountOffer = buildOffer({
      id: 'O-PERCENT-DISCOUNT',
      discount: 50,
      discountType: 'percentage',
      items: [tinySubtotalItem],
    });

    render(<ClientOffersView {...baseProps} offers={[percentageDiscountOffer]} />);

    fireEvent.click(screen.getByText('O-PERCENT-DISCOUNT'));

    expect(screen.getByText('sales:clientOffers.discountAmount (50%)')).toBeInTheDocument();
    expect(
      screen.queryByText('sales:clientOffers.discountAmount (66.67%)'),
    ).not.toBeInTheDocument();
  });
});

describe('<ClientOffersView /> source-quote banner', () => {
  test('shows the source quote with a primary "view quote" action for a linked offer', async () => {
    const user = userEvent.setup();
    const onViewQuote = mock(() => {});
    const linkedOffer = buildOffer({ id: 'O-LINKED', linkedQuoteId: 'Q0001' });

    render(<ClientOffersView {...baseProps} offers={[linkedOffer]} onViewQuote={onViewQuote} />);

    // Clicking the row opens the edit dialog that hosts the source-quote banner.
    fireEvent.click(screen.getByText('O-LINKED'));

    expect(screen.getByText('sales:clientOffers.sourceQuote')).toBeInTheDocument();
    expect(screen.getByText('Q0001')).toBeInTheDocument();

    // The "view quote" control must now be a primary shadcn button (data-variant
    // "default"), not the old text link (variant="link").
    const viewButton = screen.getByRole('button', { name: 'sales:clientOffers.viewQuote' });
    expect(viewButton.getAttribute('data-variant')).toBe('default');
    expect(viewButton.getAttribute('data-variant')).not.toBe('link');

    await user.click(viewButton);
    expect(onViewQuote).toHaveBeenCalledWith('Q0001');
  });
});
