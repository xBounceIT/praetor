import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
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

  test('exposes a Durata column and per-row duration input in the create dialog (issue #757)', () => {
    render(
      <ClientQuotesView
        quotes={[]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'sales:clientQuotes.createNewQuote' }));
    fireEvent.click(screen.getByText('sales:clientQuotes.addProduct'));

    // The Durata column header renders once a line item exists...
    expect(screen.getAllByText('sales:clientQuotes.durationColumn').length).toBeGreaterThan(0);
    // ...and the row carries a duration input defaulting to 1 month (one-off).
    const durationInputs = screen
      .getAllByPlaceholderText('sales:clientQuotes.durationColumn')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs[0].value).toBe('1');
  });

  test('scales line totals by a line item duration in the quote list (issue #757)', () => {
    const durationQuote: Quote = {
      id: 'Q-DUR',
      clientId: 'client-1',
      clientName: 'Helios Energy Services',
      items: [
        {
          id: 'item-dur',
          quoteId: 'Q-DUR',
          productId: 'product-1',
          productName: 'Consulting',
          quantity: 2,
          unitPrice: 100,
          productCost: 60,
          productMolPercentage: 40,
          durationMonths: 3,
        },
      ],
      paymentTerms: '30gg',
      discount: 0,
      discountType: 'percentage',
      status: 'draft',
      expirationDate: '2026-06-30',
      createdAt: Date.UTC(2026, 4, 14),
      updatedAt: Date.UTC(2026, 4, 14),
    };

    render(
      <ClientQuotesView
        quotes={[durationQuote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    // Subtotal (revenue) = unitPrice 100 × quantity 2 × durationMonths 3 = 600.00
    // (without the duration multiplier it would be 200.00).
    expect(screen.getAllByText('600.00 EUR').length).toBeGreaterThan(0);
    // Margin = revenue 600 − cost (60 × 2 × 3 = 360) = 240.00, which only holds when BOTH
    // revenue and cost are scaled by duration.
    expect(screen.getAllByText('240.00 EUR').length).toBeGreaterThan(0);
  });
});
