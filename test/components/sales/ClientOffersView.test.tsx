import { afterEach, describe, expect, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import type { Client, ClientOffer, ClientOfferItem, Product, SupplierQuote } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const ClientOffersView = (await import('../../../components/sales/ClientOffersView')).default;

const buildItem = (overrides: Partial<ClientOfferItem> = {}): ClientOfferItem => ({
  id: 'item-1',
  offerId: 'O-001',
  productId: 'prod-1',
  productName: 'Widget',
  quantity: 1,
  unitPrice: 100,
  productCost: 50,
  productMolPercentage: 50,
  supplierQuoteId: null,
  supplierQuoteItemId: null,
  supplierQuoteSupplierName: null,
  supplierQuoteUnitPrice: null,
  note: '',
  unitType: 'hours',
  ...overrides,
});

const buildOffer = (overrides: Partial<ClientOffer> = {}): ClientOffer => ({
  id: 'O-001',
  linkedQuoteId: '',
  clientId: 'client-1',
  clientName: 'Acme Corp',
  items: [buildItem({ offerId: overrides.id ?? 'O-001' })],
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  expirationDate: '2026-12-31',
  notes: '',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

const client: Client = { id: 'client-1', name: 'Acme Corp' };
const otherClient: Client = { id: 'client-2', name: 'Globex' };

const products: Product[] = [
  {
    id: 'prod-1',
    name: 'Widget',
    productCode: 'WID',
    costo: 50,
    molPercentage: 50,
    costUnit: 'hours',
    type: 'service',
  },
];

const supplierQuotes: SupplierQuote[] = [];

const draft = buildOffer({ id: 'O-DRAFT', clientName: 'Acme Corp', status: 'draft' });
const sent = buildOffer({
  id: 'O-SENT',
  clientName: 'Globex',
  status: 'sent',
  clientId: 'client-2',
});
const accepted = buildOffer({
  id: 'O-ACCEPTED',
  clientName: 'Initech',
  status: 'accepted',
  clientId: 'client-3',
});

const baseProps = {
  offers: [draft, sent, accepted],
  clients: [client, otherClient, { id: 'client-3', name: 'Initech' }],
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

describe('<ClientOffersView /> filters', () => {
  test('renders all offers when search and status filter are empty/all', () => {
    render(<ClientOffersView {...baseProps} />);
    expect(screen.getByText('O-DRAFT')).toBeInTheDocument();
    expect(screen.getByText('O-SENT')).toBeInTheDocument();
    expect(screen.getByText('O-ACCEPTED')).toBeInTheDocument();
  });

  test('renders a search input wired to the search filter', () => {
    render(<ClientOffersView {...baseProps} />);
    const searchInput = screen.getByPlaceholderText('sales:clientOffers.searchPlaceholder');
    expect(searchInput).toBeInTheDocument();
  });

  test('typing in the search box filters by offer code', () => {
    render(<ClientOffersView {...baseProps} />);
    const searchInput = screen.getByPlaceholderText('sales:clientOffers.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'O-DRAFT' } });
    expect(screen.getByText('O-DRAFT')).toBeInTheDocument();
    expect(screen.queryByText('O-SENT')).not.toBeInTheDocument();
    expect(screen.queryByText('O-ACCEPTED')).not.toBeInTheDocument();
  });

  test('typing in the search box filters by client name (case-insensitive)', () => {
    render(<ClientOffersView {...baseProps} />);
    const searchInput = screen.getByPlaceholderText('sales:clientOffers.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'globex' } });
    expect(screen.queryByText('O-DRAFT')).not.toBeInTheDocument();
    expect(screen.getByText('O-SENT')).toBeInTheDocument();
    expect(screen.queryByText('O-ACCEPTED')).not.toBeInTheDocument();
  });

  test('search input value reflects state updates', () => {
    render(<ClientOffersView {...baseProps} />);
    const searchInput = screen.getByPlaceholderText(
      'sales:clientOffers.searchPlaceholder',
    ) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'acme' } });
    expect(searchInput.value).toBe('acme');
  });
});
