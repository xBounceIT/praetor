import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Product, Supplier, SupplierSaleOrder } from '../../../types';
import { render } from '../../helpers/render';

// Stable `t`/`i18n` references: opening the edit modal mounts SupplierOrderVersionsPanel, whose
// `reload` puts `t` in a useCallback dep array. A fresh `t` per render would make that effect
// re-fire forever, so mirror real react-i18next with a stable identity.
const t = (key: string) => key;
const i18n = { language: 'en', changeLanguage: () => {} };
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t, i18n }),
  Trans: ({ children }: { children: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

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

// Opening the edit modal mounts SupplierOrderVersionsPanel, which fetches version history on
// mount. Stub the API so the view renders without a real network call.
mock.module('../../../services/api/supplierOrders', () => ({
  supplierOrdersApi: {
    listVersions: () => Promise.resolve([]),
    getVersion: () => Promise.reject(new Error('not used')),
    restoreVersion: () => Promise.reject(new Error('not used')),
  },
}));

// Modal locks body scroll while open; reset it between tests.
afterEach(() => {
  document.body.style.overflow = '';
});

const SupplierOrdersView = (await import('../../../components/accounting/SupplierOrdersView'))
  .default;

const suppliers = [
  { id: 'sup-1', name: 'SupplierX' },
  { id: 'sup-2', name: 'SupplierY' },
] as unknown as Supplier[];

const makeOrder = (id: string, supplierId: string, supplierName: string): SupplierSaleOrder => ({
  id,
  supplierId,
  supplierName,
  items: [],
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  createdAt: Date.UTC(2026, 3, 24),
  updatedAt: Date.UTC(2026, 3, 24),
});

const orders = [makeOrder('SO-1', 'sup-1', 'SupplierX'), makeOrder('SO-2', 'sup-2', 'SupplierY')];

const baseProps = {
  suppliers,
  products: [] as Product[],
  orderIdsWithInvoices: new Set<string>(),
  onUpdateOrder: mock(() => Promise.resolve()),
  onDeleteOrder: mock(() => Promise.resolve()),
  currency: 'EUR',
};

describe('<SupplierOrdersView /> deep-link filter', () => {
  test('orderFilterId pre-filters the list to the single referenced order', () => {
    render(<SupplierOrdersView orders={orders} orderFilterId="SO-1" {...baseProps} />);

    expect(screen.getByText('SO-1')).toBeInTheDocument();
    expect(screen.queryByText('SO-2')).toBeNull();
  });

  test('without a filter the full list renders', () => {
    render(<SupplierOrdersView orders={orders} {...baseProps} />);

    expect(screen.getByText('SO-1')).toBeInTheDocument();
    expect(screen.getByText('SO-2')).toBeInTheDocument();
  });

  test('orderFilterId (own id) takes precedence over quoteFilterId (linked quote)', () => {
    // The per-line client-order shortcut targets a specific order by id, so the own-id
    // filter must win even if a stale quote filter is still in state.
    render(
      <SupplierOrdersView
        orders={orders}
        orderFilterId="SO-2"
        quoteFilterId="some-quote"
        {...baseProps}
      />,
    );

    expect(screen.getByText('SO-2')).toBeInTheDocument();
    expect(screen.queryByText('SO-1')).toBeNull();
  });
});

const baseOrder: SupplierSaleOrder = {
  id: 'dm_ss_01',
  linkedQuoteId: 'dm_sq_11',
  supplierId: 'sup-1',
  supplierName: 'TechSource Distribution',
  items: [
    {
      id: 'item-1',
      orderId: 'dm_ss_01',
      productId: 'product-1',
      productName: 'Firewall appliance',
      quantity: 2,
      unitPrice: 1920,
    },
  ],
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  createdAt: Date.UTC(2026, 3, 24),
  updatedAt: Date.UTC(2026, 3, 24),
};

const renderView = (ordersToRender: SupplierSaleOrder[]) =>
  render(
    <SupplierOrdersView
      orders={ordersToRender}
      suppliers={suppliers}
      products={[]}
      orderIdsWithInvoices={new Set<string>()}
      onUpdateOrder={mock(() => Promise.resolve())}
      onDeleteOrder={mock(() => Promise.resolve())}
      currency="EUR"
    />,
  );

describe('<SupplierOrdersView /> supplier-quote column', () => {
  test('renders the linked supplier quote in its own sortable, filterable column', () => {
    renderView([baseOrder]);

    const quoteHeader = screen.getByText('accounting:supplierOrders.linkedQuote');
    const headerCell = quoteHeader.closest('th');
    expect(headerCell).not.toBeNull();
    // Default column behaviour: sortable (sort icon) and filterable (filter button).
    expect(headerCell?.querySelector('svg')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'table.filters accounting:supplierOrders.linkedQuote',
      }),
    ).toBeInTheDocument();
  });

  test('shows the quote id in a dedicated cell, not stacked under the supplier name', () => {
    renderView([baseOrder]);

    const supplierCell = screen.getByText('TechSource Distribution').closest('td');
    const quoteCell = screen.getByText('dm_sq_11').closest('td');

    expect(supplierCell).not.toBeNull();
    expect(quoteCell).not.toBeNull();
    // The quote now lives in its own column, so it must not be the same cell as the supplier name.
    expect(quoteCell).not.toBe(supplierCell);
    expect(within(supplierCell as HTMLElement).queryByText('dm_sq_11')).toBeNull();
  });

  test('orders the quote column between the supplier and total columns', () => {
    renderView([baseOrder]);

    const headerTexts = screen.getAllByRole('columnheader').map((th) => th.textContent ?? '');
    const supplierIdx = headerTexts.findIndex((text) =>
      text.includes('accounting:supplierOrders.supplier'),
    );
    const quoteIdx = headerTexts.findIndex((text) =>
      text.includes('accounting:supplierOrders.linkedQuote'),
    );
    const totalIdx = headerTexts.findIndex((text) =>
      text.includes('accounting:supplierOrders.total'),
    );

    expect(supplierIdx).toBeGreaterThanOrEqual(0);
    expect(supplierIdx).toBeLessThan(quoteIdx);
    expect(quoteIdx).toBeLessThan(totalIdx);
  });

  test('falls back to the no-quote-link placeholder when an order has no linked quote', () => {
    const orphanOrder: SupplierSaleOrder = {
      ...baseOrder,
      id: 'dm_ss_02',
      linkedQuoteId: undefined,
    };
    renderView([orphanOrder]);

    expect(screen.getByText('accounting:supplierOrders.noQuoteLink')).toBeInTheDocument();
  });
});

describe('<SupplierOrdersView /> item pricing columns', () => {
  test('matches the supplier-quote pricing chain and keeps duration visible', async () => {
    renderView([
      {
        ...baseOrder,
        items: [{ ...baseOrder.items[0], unitPrice: 2_400, discount: 20, durationMonths: 12 }],
      },
    ]);

    await act(async () => {
      fireEvent.click(screen.getByText('dm_ss_01'));
      await Promise.resolve();
    });

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent ?? '');
    expect(headers).toEqual([
      'crm:quotes.productsServices',
      'sales:supplierQuotes.listPrice',
      'sales:supplierQuotes.discountToUs',
      'sales:supplierQuotes.unitCost',
      'sales:supplierQuotes.qty',
      'accounting:supplierOrders.durationColumn',
      'common:labels.total',
      'accounting:supplierOrders.notes',
      'common:labels.actions',
    ]);
  });

  test('caps discount to us at 100 percent', async () => {
    renderView([{ ...baseOrder, items: [{ ...baseOrder.items[0], discount: 20 }] }]);
    await act(async () => {
      fireEvent.click(screen.getByText('dm_ss_01'));
      await Promise.resolve();
    });

    const discountInput = screen.getByLabelText('sales:supplierQuotes.discountToUs');
    await act(async () => {
      fireEvent.focus(discountInput);
      fireEvent.change(discountInput, { target: { value: '120' } });
    });
    expect(discountInput).toHaveValue('100');
  });

  test('rounds unit cost before quantity multiplies the line total', async () => {
    renderView([
      {
        ...baseOrder,
        items: [
          {
            ...baseOrder.items[0],
            quantity: 100,
            unitPrice: 10.01,
            discount: 10,
            durationMonths: 1,
          },
        ],
      },
    ]);

    await act(async () => {
      fireEvent.click(screen.getByText('dm_ss_01'));
      await Promise.resolve();
    });

    expect(screen.getByText('9,01')).toBeInTheDocument();
    expect(screen.getAllByText('901,00 EUR').length).toBeGreaterThan(0);
  });
});
