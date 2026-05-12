import { afterEach, describe, expect, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Client, ClientOffer, Product, SupplierQuote } from '../../types';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

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
