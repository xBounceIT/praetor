import { describe, expect, mock, test } from 'bun:test';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Product, Supplier, SupplierSaleOrder } from '../../../types';
import { render } from '../../helpers/render';

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
