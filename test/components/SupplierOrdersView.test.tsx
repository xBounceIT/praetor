import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import type { Product, Supplier, SupplierSaleOrder } from '../../types';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock();

const SupplierOrdersView = (await import('../../components/accounting/SupplierOrdersView')).default;

const supplier: Supplier = { id: 's-1', name: 'Acme Supplies' };
const products: Product[] = [];

const buildOrder = (overrides: Partial<SupplierSaleOrder>): SupplierSaleOrder => ({
  id: 'SO-base',
  supplierId: 's-1',
  supplierName: 'Acme Supplies',
  items: [
    {
      id: 'ssi-1',
      orderId: overrides.id ?? 'SO-base',
      productId: '',
      productName: 'Managed service',
      quantity: 2,
      unitPrice: 100,
      discount: 0,
      // Carried over from the supplier quote — multiplies the line total.
      durationMonths: 3,
      durationUnit: 'months',
    },
  ],
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

const baseProps = {
  suppliers: [supplier],
  products,
  orderIdsWithInvoices: new Set<string>(),
  onUpdateOrder: () => {},
  onDeleteOrder: () => {},
  currency: 'EUR',
};

afterEach(() => {
  document.body.style.overflow = '';
});

describe('<SupplierOrdersView /> line item duration (issue #776)', () => {
  test('scales the order total by the line duration', () => {
    const order = buildOrder({ id: 'SO-DUR', status: 'draft' });
    render(<SupplierOrdersView {...baseProps} orders={[order]} />);
    // Total column = unitPrice 100 × quantity 2 × durationMonths 3 = 600.00
    // (without the duration multiplier it would be 200.00).
    expect(screen.getAllByText('600.00 EUR').length).toBeGreaterThan(0);
    expect(screen.queryByText('200.00 EUR')).not.toBeInTheDocument();
  });

  test('renders the Durata column and an editable duration in the edit dialog', () => {
    const order = buildOrder({ id: 'SO-DUR-EDIT', status: 'draft' });
    render(<SupplierOrdersView {...baseProps} orders={[order]} />);
    fireEvent.click(screen.getByText('SO-DUR-EDIT'));
    // The Durata column header renders once items exist...
    expect(screen.getAllByText('accounting:supplierOrders.durationColumn').length).toBeGreaterThan(
      0,
    );
    // ...and the row carries a duration input reflecting the stored value (3 months).
    const durationInputs = screen
      .getAllByPlaceholderText('accounting:supplierOrders.durationColumn')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs[0].value).toBe('3');
  });

  test('editing the duration updates the submitted multiplier', () => {
    const onUpdateOrder = mock((_id: string, _updates: Partial<SupplierSaleOrder>) => {});
    const order = buildOrder({ id: 'SO-DUR-SUBMIT', status: 'draft' });
    render(<SupplierOrdersView {...baseProps} orders={[order]} onUpdateOrder={onUpdateOrder} />);
    fireEvent.click(screen.getByText('SO-DUR-SUBMIT'));

    const durationInputs = screen
      .getAllByPlaceholderText('accounting:supplierOrders.durationColumn')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    fireEvent.change(durationInputs[0], { target: { value: '4' } });

    fireEvent.click(screen.getByText('common:buttons.update'));

    expect(onUpdateOrder).toHaveBeenCalledTimes(1);
    const updates = onUpdateOrder.mock.calls[0]?.[1] as Partial<SupplierSaleOrder>;
    expect(updates.items?.[0]?.durationMonths).toBe(4);
    expect(updates.items?.[0]?.durationUnit).toBe('months');
  });
});
