import { afterEach, describe, expect, mock } from 'bun:test';
import { act, fireEvent, screen } from '@testing-library/react';
import type { Product, Supplier, SupplierInvoice } from '../../types';
import { installI18nMock } from '../helpers/i18n';
import { reactTest as test } from '../helpers/reactTest';
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
      .getAllByPlaceholderText('0')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs[0].value).toBe('3');
  });

  test('editing the duration updates the submitted multiplier', async () => {
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
      .getAllByPlaceholderText('0')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    fireEvent.change(durationInputs[0], { target: { value: '5' } });

    await act(async () => {
      fireEvent.click(screen.getByText('common:buttons.update'));
    });

    expect(onUpdateInvoice).toHaveBeenCalledTimes(1);
    const updates = onUpdateInvoice.mock.calls[0]?.[1] as Partial<SupplierInvoice>;
    expect(updates.items?.[0]?.durationMonths).toBe(5);
    expect(updates.items?.[0]?.durationUnit).toBe('months');
  });

  test('normalizes a blank years duration to the canonical month unit before saving', async () => {
    const onUpdateInvoice = mock((_id: string, _updates: Partial<SupplierInvoice>) => {});
    const invoice = buildInvoice({ id: 'SINV-BLANK-DURATION', status: 'draft' });
    render(
      <SupplierInvoicesView
        {...baseProps}
        invoices={[invoice]}
        onUpdateInvoice={onUpdateInvoice}
      />,
    );
    await act(async () => fireEvent.click(screen.getByText('SINV-BLANK-DURATION')));

    const durationInput = screen
      .getAllByPlaceholderText('0')
      .find((element): element is HTMLInputElement => element instanceof HTMLInputElement);
    if (!durationInput) throw new Error('Duration input not found');
    fireEvent.change(durationInput, { target: { value: '' } });

    const durationUnitButton = screen
      .getAllByText('accounting:supplierInvoices.months')
      .map((element) => element.closest('button'))
      .find(Boolean);
    if (!durationUnitButton) throw new Error('Duration unit button not found');
    await act(async () => fireEvent.click(durationUnitButton));
    const yearsOption = (await screen.findAllByText('accounting:supplierInvoices.years'))
      .map((element) => element.closest('[data-slot="select-item"]'))
      .find(Boolean);
    if (!yearsOption) throw new Error('Years duration option not found');
    await act(async () => fireEvent.click(yearsOption));
    await act(async () => fireEvent.click(screen.getByText('common:buttons.update')));

    expect(onUpdateInvoice).toHaveBeenCalledTimes(1);
    const updates = onUpdateInvoice.mock.calls[0]?.[1];
    expect(updates?.items?.[0]).toEqual(
      expect.objectContaining({
        durationMonths: undefined,
        durationUnit: 'months',
        legacyDiscountRounding: false,
      }),
    );
  });

  test('rounds the line total only after quantity multiplies the precise unit cost', () => {
    const invoice = buildInvoice({
      id: 'SINV-ROUNDING',
      items: [
        {
          id: 'sii-rounding',
          invoiceId: 'SINV-ROUNDING',
          productId: '',
          description: 'Rounded service',
          quantity: 100,
          unitPrice: 10.01,
          discount: 10,
          durationMonths: 1,
          durationUnit: 'months',
        },
      ],
    });

    render(<SupplierInvoicesView {...baseProps} invoices={[invoice]} />);
    fireEvent.click(screen.getByText('SINV-ROUNDING'));

    expect(screen.getAllByText('900,90 EUR').length).toBeGreaterThan(0);
    expect(screen.queryByText('901,00 EUR')).not.toBeInTheDocument();
  });

  test('submits currency-scale totals that match the displayed amount', async () => {
    const onUpdateInvoice = mock((_id: string, _updates: Partial<SupplierInvoice>) => {});
    const invoice = buildInvoice({
      id: 'SINV-DOCUMENT-ROUNDING',
      amountPaid: 4813.13,
      items: [
        {
          id: 'sii-document-rounding',
          invoiceId: 'SINV-DOCUMENT-ROUNDING',
          productId: '',
          description: 'Discounted service',
          quantity: 150,
          unitPrice: 37.75,
          discount: 15,
          durationMonths: 1,
          durationUnit: 'months',
        },
      ],
    });

    render(
      <SupplierInvoicesView
        {...baseProps}
        invoices={[invoice]}
        onUpdateInvoice={onUpdateInvoice}
      />,
    );
    fireEvent.click(screen.getByText('SINV-DOCUMENT-ROUNDING'));

    expect(screen.getAllByText('5.662,50 EUR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-849,37 EUR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4.813,13 EUR').length).toBeGreaterThan(0);
    expect(screen.queryByText('5.662,51 EUR')).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByText('common:buttons.update')));

    const updates = onUpdateInvoice.mock.calls[0]?.[1];
    expect(updates).toEqual(
      expect.objectContaining({ subtotal: 4813.13, total: 4813.13, amountPaid: 4813.13 }),
    );
  });

  test('preserves migrated totals without discarding historical gross price or discount', async () => {
    const onUpdateInvoice = mock((_id: string, _updates: Partial<SupplierInvoice>) => {});
    const invoice = buildInvoice({
      id: 'SINV-LEGACY-ROUNDING',
      amountPaid: 4813.5,
      items: [
        {
          id: 'sii-legacy-rounding',
          invoiceId: 'SINV-LEGACY-ROUNDING',
          productId: '',
          description: 'Historical discounted service',
          quantity: 150,
          unitPrice: 37.75,
          discount: 15,
          legacyDiscountRounding: true,
          durationMonths: 1,
          durationUnit: 'months',
        },
      ],
    });

    render(
      <SupplierInvoicesView
        {...baseProps}
        invoices={[invoice]}
        onUpdateInvoice={onUpdateInvoice}
      />,
    );
    fireEvent.click(screen.getByText('SINV-LEGACY-ROUNDING'));

    expect(screen.getAllByText('5.662,50 EUR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-849,00 EUR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4.813,50 EUR').length).toBeGreaterThan(0);
    await act(async () => fireEvent.click(screen.getByText('common:buttons.update')));

    const updates = onUpdateInvoice.mock.calls[0]?.[1];
    expect(updates).toEqual(
      expect.objectContaining({ subtotal: 4813.5, total: 4813.5, amountPaid: 4813.5 }),
    );
    expect(updates?.items?.[0]).toEqual(
      expect.objectContaining({
        unitPrice: 37.75,
        discount: 15,
        legacyDiscountRounding: true,
      }),
    );
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

  test('right-aligns numeric invoice editors like the other document item tables', async () => {
    const source = await readComponentSource('accounting/SupplierInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "'h-9 max-w-[5rem] flex-none text-right font-medium'",
      'className="flex h-9 items-center justify-end gap-1"',
      'inputClassName = SUPPLIER_INVOICE_ITEM_NUMBER_INPUT_CLASSNAME',
      'placeholder="0,00"',
      'placeholder="0"',
    ]);
    expectSourceOmitsAll(source, ["inputClassName = 'min-w-0 text-center'"]);
  });

  test('keeps the delete action available from the StandardTable row menu', async () => {
    const invoice = buildInvoice({ id: 'SINV-DELETE', status: 'draft' });
    render(<SupplierInvoicesView {...baseProps} invoices={[invoice]} />);
    await act(async () => fireEvent.click(screen.getByText('SINV-DELETE')));

    const dialog = await screen.findByRole('dialog');
    const deleteButton = await openRowDeleteButton(dialog);
    await act(async () => fireEvent.click(deleteButton));

    expect(screen.queryByDisplayValue('Managed service')).not.toBeInTheDocument();
  });
});
