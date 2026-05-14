import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Client, ClientOffer, Product, SupplierQuote } from '../../types';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock({ includeInterpolatedValues: true });

mock.module('../../components/sales/OfferVersionsPanel', () => ({
  default: () => null,
}));

const ClientOffersView = (await import('../../components/sales/ClientOffersView')).default;

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

describe('<ClientOffersView /> filter controls', () => {
  test('renders both offers when no filter is applied', () => {
    render(<ClientOffersView {...baseProps} />);
    expect(screen.getByText('O-ACME-DRAFT')).toBeInTheDocument();
    expect(screen.getByText('O-GLOBEX-SENT')).toBeInTheDocument();
  });

  test('typing in the search input hides non-matching offers (by client name)', () => {
    render(<ClientOffersView {...baseProps} />);
    const searchInput = screen.getByPlaceholderText('sales:clientOffers.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'Acme' } });
    expect(screen.getByText('O-ACME-DRAFT')).toBeInTheDocument();
    expect(screen.queryByText('O-GLOBEX-SENT')).not.toBeInTheDocument();
  });

  test('typing in the search input hides non-matching offers (by offer code)', () => {
    render(<ClientOffersView {...baseProps} />);
    const searchInput = screen.getByPlaceholderText('sales:clientOffers.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'globex' } });
    expect(screen.queryByText('O-ACME-DRAFT')).not.toBeInTheDocument();
    expect(screen.getByText('O-GLOBEX-SENT')).toBeInTheDocument();
  });

  const pickStatusOption = (statusKey: string) => {
    const trigger = screen.getByLabelText('sales:clientOffers.filterByStatus');
    fireEvent.click(trigger);
    const options = screen.getAllByRole('option');
    const match = options.find((node) => node.textContent === statusKey);
    if (!match) {
      throw new Error(
        `Could not find option ${statusKey}; saw: ${options.map((o) => o.textContent).join(', ')}`,
      );
    }
    fireEvent.click(match);
  };

  test('selecting a status filter shows only offers with that status', () => {
    render(<ClientOffersView {...baseProps} />);
    pickStatusOption('sales:clientOffers.statusSent');
    expect(screen.queryByText('O-ACME-DRAFT')).not.toBeInTheDocument();
    expect(screen.getByText('O-GLOBEX-SENT')).toBeInTheDocument();
  });

  test('switching status back to "all" restores both rows', () => {
    render(<ClientOffersView {...baseProps} />);
    pickStatusOption('sales:clientOffers.statusSent');
    expect(screen.queryByText('O-ACME-DRAFT')).not.toBeInTheDocument();
    pickStatusOption('sales:clientOffers.allStatuses');
    expect(screen.getByText('O-ACME-DRAFT')).toBeInTheDocument();
    expect(screen.getByText('O-GLOBEX-SENT')).toBeInTheDocument();
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
