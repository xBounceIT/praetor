import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import type { Product, Supplier, SupplierInvoice } from '../../types';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';
import { openRowDeleteButton } from '../helpers/rowDeleteButtons';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from './modalStylingTestUtils';

installI18nMock();

const SupplierInvoicesView = (await import('../../components/accounting/SupplierInvoicesView'))
  .default;

const supplier: Supplier = { id: 's-1', name: 'Acme Supplies' };
const products: Product[] = [];

const buildInvoice = (overrides: Partial<SupplierInvoice>): SupplierInvoice => ({
  id: 'SINV-base',
  supplierId: 's-1',
  supplierName: 'Acme Supplies',
  issueDate: '2026-01-01',
  dueDate: '2026-02-01',
  status: 'draft',
  subtotal: 0,
  total: 0,
  amountPaid: 0,
  notes: '',
  items: [
    {
      id: 'sii-1',
      invoiceId: overrides.id ?? 'SINV-base',
      productId: '',
      description: 'Managed service',
      quantity: 2,
      unitPrice: 100,
      discount: 0,
      // Carried over from the supplier order — multiplies the line total (issue #776/#775).
      durationMonths: 3,
      durationUnit: 'months',
    },
  ],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

const baseProps = {
  suppliers: [supplier],
  products,
  onUpdateInvoice: () => {},
  onDeleteInvoice: () => {},
  currency: 'EUR',
};

afterEach(() => {
  document.body.style.overflow = '';
});

describe('<SupplierInvoicesView /> line item duration (issue #776/#775)', () => {
  test('scales the invoice line total by the duration in the edit dialog', () => {
    const invoice = buildInvoice({ id: 'SINV-DUR', status: 'draft' });
    render(<SupplierInvoicesView {...baseProps} invoices={[invoice]} />);
    fireEvent.click(screen.getByText('SINV-DUR'));
    // Line total = unitPrice 100 × quantity 2 × durationMonths 3 = 600.00
    // (without the duration multiplier it would be 200.00).
    expect(screen.getAllByText('600,00 EUR').length).toBeGreaterThan(0);
    expect(screen.queryByText('200,00 EUR')).not.toBeInTheDocument();
  });

  test('renders the Durata column and an editable duration reflecting the stored value', () => {
    const invoice = buildInvoice({ id: 'SINV-DUR-EDIT', status: 'draft' });
    render(<SupplierInvoicesView {...baseProps} invoices={[invoice]} />);
    fireEvent.click(screen.getByText('SINV-DUR-EDIT'));
    expect(
      screen.getAllByText('accounting:supplierInvoices.durationColumn').length,
    ).toBeGreaterThan(0);
    const durationInputs = screen
      .getAllByPlaceholderText('accounting:supplierInvoices.durationColumn')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs[0].value).toBe('3');
  });

  test('editing the duration updates the submitted multiplier', () => {
    const onUpdateInvoice = mock((_id: string, _updates: Partial<SupplierInvoice>) => {});
    const invoice = buildInvoice({ id: 'SINV-DUR-SUBMIT', status: 'draft' });
    render(
      <SupplierInvoicesView
        {...baseProps}
        invoices={[invoice]}
        onUpdateInvoice={onUpdateInvoice}
      />,
    );
    fireEvent.click(screen.getByText('SINV-DUR-SUBMIT'));

    const durationInputs = screen
      .getAllByPlaceholderText('accounting:supplierInvoices.durationColumn')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    fireEvent.change(durationInputs[0], { target: { value: '5' } });

    fireEvent.click(screen.getByText('common:buttons.update'));

    expect(onUpdateInvoice).toHaveBeenCalledTimes(1);
    const updates = onUpdateInvoice.mock.calls[0]?.[1] as Partial<SupplierInvoice>;
    expect(updates.items?.[0]?.durationMonths).toBe(5);
    expect(updates.items?.[0]?.durationUnit).toBe('months');
  });
});

describe('<SupplierInvoicesView /> line-item table', () => {
  test('renders supplier invoice items through the shared StandardTable', async () => {
    const source = await readComponentSource('accounting/SupplierInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "import StandardTable, { type Column } from '../shared/StandardTable';",
      'const columns: Column<SupplierInvoiceItem>[]',
      '<StandardTable<SupplierInvoiceItem>',
      'persistenceKey="accounting.supplierInvoices.items"',
      'createLineItemIndexResolver(controller.formData.items)',
    ]);
    expectSourceOmitsAll(source, ['<DocumentLineItemsScrollArea']);
  });

  test('keeps the delete action available from the StandardTable row menu', async () => {
    const invoice = buildInvoice({ id: 'SINV-DELETE', status: 'draft' });
    render(<SupplierInvoicesView {...baseProps} invoices={[invoice]} />);
    fireEvent.click(screen.getByText('SINV-DELETE'));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await openRowDeleteButton(dialog));

    expect(screen.queryByDisplayValue('Managed service')).not.toBeInTheDocument();
  });
});
