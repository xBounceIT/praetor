import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { screen } from '@testing-library/react';
import type { Client, Quote } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

mock.module('sonner', () => ({
  toast: {
    error: () => {},
    success: () => {},
    info: () => {},
    warning: () => {},
    message: () => {},
  },
  Toaster: () => null,
}));

const ClientQuotesView = (await import('../../../components/sales/ClientQuotesView')).default;

const clients: Client[] = [{ id: 'client-1', name: 'Helios Energy Services' }];

const quotes: Quote[] = [
  {
    id: 'Q-001',
    clientId: 'client-1',
    clientName: 'Helios Energy Services',
    items: [
      {
        id: 'item-1',
        quoteId: 'Q-001',
        productId: 'product-1',
        productName: 'Consulting',
        quantity: 2,
        unitPrice: 100,
        productCost: 60,
        productMolPercentage: 40,
      },
    ],
    paymentTerms: '30gg',
    discount: 10,
    discountType: 'percentage',
    status: 'draft',
    expirationDate: '2026-06-30',
    createdAt: Date.UTC(2026, 4, 14),
    updatedAt: Date.UTC(2026, 4, 14),
  },
  {
    id: 'Q-002',
    clientId: 'client-1',
    clientName: 'Helios Energy Services',
    items: [
      {
        id: 'item-2',
        quoteId: 'Q-002',
        productId: 'product-1',
        productName: 'Consulting',
        quantity: 2,
        unitPrice: 100,
        productCost: 60,
        productMolPercentage: 40,
      },
    ],
    paymentTerms: '30gg',
    discount: 25,
    discountType: 'currency',
    status: 'draft',
    expirationDate: '2026-06-30',
    createdAt: Date.UTC(2026, 4, 14),
    updatedAt: Date.UTC(2026, 4, 14),
  },
];

describe('<ClientQuotesView />', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('renders the quote list columns in the requested order with MOL next to margin', () => {
    const { container } = render(
      <ClientQuotesView
        quotes={quotes}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    const headerLabels = Array.from(container.querySelectorAll('[data-column-header-label]')).map(
      (header) => header.textContent?.trim(),
    );

    expect(headerLabels).toEqual([
      'sales:clientQuotes.quoteCodeColumn',
      'crm:clients.tableHeaders.insertDate',
      'sales:clientQuotes.clientColumn',
      'sales:clientQuotes.subtotal',
      'sales:clientQuotes.discountPercentColumn',
      'common:labels.discount',
      'sales:clientQuotes.discountedTotalColumn',
      'sales:clientQuotes.marginLabel',
      'sales:clientQuotes.molLabel',
      'sales:clientQuotes.paymentTermsColumn',
      'sales:clientQuotes.expirationColumn',
      'sales:clientQuotes.statusColumn',
      'sales:clientQuotes.actionsColumn',
    ]);
    expect(screen.getByText('33.3%')).toBeInTheDocument();
    expect(screen.getByText('12.5%')).toBeInTheDocument();
  });
});
