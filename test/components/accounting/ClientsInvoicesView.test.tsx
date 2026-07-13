import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Client, Invoice, Product } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { LineDeleteConfirmStub } from '../../helpers/lineItemDeleteConfirm';
import { render } from '../../helpers/render';
import { openRowDeleteButton, rowDeleteButtons } from '../../helpers/rowDeleteButtons';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

installI18nMock();

// Other suites globally stub DeleteConfirmModal (Bun's mock.module is process-wide and
// last-write-wins), so pin the shared deterministic stub against this file's binding.
mock.module('../../../components/shared/DeleteConfirmModal', () => ({
  default: LineDeleteConfirmStub,
}));

const ClientsInvoicesView = (await import('../../../components/accounting/ClientsInvoicesView'))
  .default;

const clients: Client[] = [{ id: 'client-1', name: 'Helios Energy Services' }];

// Two invoices with the same canonical duration (24 months) but different display units.
// The years invoice must show the duration as `2` while computing the same taxable line total
// (24 months) as the months invoice — proving `durationUnit` is display-only (issue #757).
const buildInvoice = (id: string, durationUnit: 'months' | 'years'): Invoice => ({
  id,
  clientId: 'client-1',
  clientName: 'Helios Energy Services',
  issueDate: '2026-01-01',
  dueDate: '2026-02-01',
  status: 'draft',
  subtotal: 0,
  taxTotal: 0,
  total: 0,
  amountPaid: 0,
  notes: '',
  items: [
    {
      id: 'item-1',
      invoiceId: id,
      description: 'Consulting',
      // Duration applies only to non-unit lines, so this fixture is hours-based to exercise it.
      unitOfMeasure: 'hours',
      // Quantity 3 (not 2) so the duration display value (2 for years) is unambiguous in the inputs.
      quantity: 3,
      unitPrice: 100,
      discount: 0,
      taxRate: 0,
      // Same canonical 24 months for both variants; only the display unit differs.
      durationMonths: 24,
      durationUnit,
    },
  ],
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
});

const openEditModal = async (invoice: Invoice) => {
  render(
    <ClientsInvoicesView
      invoices={[invoice]}
      clients={clients}
      products={[]}
      onAddInvoice={mock(() => {})}
      onUpdateInvoice={mock(() => {})}
      onDeleteInvoice={mock(() => {})}
      currency="EUR"
    />,
  );
  fireEvent.click(screen.getByText('Helios Energy Services').closest('tr') as HTMLElement);
  return screen.findByRole('dialog');
};

const hasInputWithValue = (dialog: HTMLElement, value: string) =>
  within(dialog)
    .getAllByRole('textbox')
    .some((el) => el instanceof HTMLInputElement && el.value === value);

describe('<ClientsInvoicesView /> duration unit (issue #757)', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  // Taxable line total = quantity 3 × unitPrice 100 × durationMonths 24 × (1 - 0 discount) = 7200.00.
  // With taxRate 0 the rendered line total equals the taxable amount, regardless of display unit.
  const TAXABLE_LINE_TOTAL = '7.200,00 EUR';

  test('a months item shows the duration as 24 (the raw months) and folds 24 months into the taxable line total', async () => {
    const dialog = await openEditModal(buildInvoice('INV-MONTHS', 'months'));

    expect(hasInputWithValue(dialog, '24')).toBe(true);
    expect(within(dialog).getAllByText(TAXABLE_LINE_TOTAL).length).toBeGreaterThan(0);
  });

  test('a years item shows the duration as 2 (24 months / 12) yet computes the same 24-month taxable line total', async () => {
    const dialog = await openEditModal(buildInvoice('INV-YEARS', 'years'));

    // Display unit is years, so the input shows 2 instead of the canonical 24 months...
    expect(hasInputWithValue(dialog, '2')).toBe(true);
    expect(hasInputWithValue(dialog, '24')).toBe(false);
    // ...but pricing still multiplies by durationMonths (24), so the taxable total is unchanged.
    expect(within(dialog).getAllByText(TAXABLE_LINE_TOTAL).length).toBeGreaterThan(0);
  });

  test('normalizes a blank years duration to the canonical month unit before saving', async () => {
    const onUpdateInvoice = mock((_id: string, _data: Partial<Invoice>) => {});
    const invoice = buildInvoice('INV-BLANK-DURATION', 'months');
    render(
      <ClientsInvoicesView
        invoices={[invoice]}
        clients={clients}
        products={[]}
        onAddInvoice={mock(() => {})}
        onUpdateInvoice={onUpdateInvoice}
        onDeleteInvoice={mock(() => {})}
        currency="EUR"
      />,
    );
    fireEvent.click(screen.getByText('Helios Energy Services').closest('tr') as HTMLElement);
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByDisplayValue('24'), { target: { value: '' } });
    const durationUnitButton = within(dialog)
      .getAllByText('sales:clientQuotes.months')
      .map((element) => element.closest('button'))
      .find(Boolean);
    if (!durationUnitButton) throw new Error('Duration unit button not found');
    fireEvent.click(durationUnitButton);
    const yearsOption = (await screen.findAllByText('sales:clientQuotes.years'))
      .map((element) => element.closest('[data-slot="select-item"]'))
      .find(Boolean);
    if (!yearsOption) throw new Error('Years duration option not found');
    fireEvent.click(yearsOption);
    fireEvent.submit(
      within(dialog).getByText('common:buttons.save').closest('form') as HTMLFormElement,
    );

    expect(onUpdateInvoice).toHaveBeenCalledTimes(1);
    const submittedInvoice = onUpdateInvoice.mock.calls[0]?.[1];
    expect(submittedInvoice?.items?.[0]).toEqual(
      expect.objectContaining({ durationMonths: undefined, durationUnit: 'months' }),
    );
  });
});

describe('<ClientsInvoicesView /> paginated item validation', () => {
  test.each([
    ['description', { description: '' }, 'common:validation.required'],
    ['quantity', { quantity: undefined }, 'common:validation.positiveQuantityRequired'],
    ['unit price', { unitPrice: undefined }, 'common:validation.unitPriceRequired'],
  ])('rejects an invalid %s on an unmounted page', async (_field, invalidValues, errorKey) => {
    const onUpdateInvoice = mock(() => {});
    const invoice = buildInvoice('INV-PAGINATED', 'months');
    invoice.items = Array.from({ length: 6 }, (_, index) => ({
      ...invoice.items[0],
      id: `item-${index + 1}`,
      description: `Consulting ${index + 1}`,
    }));
    Object.assign(invoice.items[5], invalidValues);

    render(
      <ClientsInvoicesView
        invoices={[invoice]}
        clients={clients}
        products={[]}
        onAddInvoice={mock(() => {})}
        onUpdateInvoice={onUpdateInvoice}
        onDeleteInvoice={mock(() => {})}
        currency="EUR"
      />,
    );
    fireEvent.click(screen.getByText('Helios Energy Services').closest('tr') as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getAllByRole('textbox', { name: 'common:labels.description' }),
    ).toHaveLength(5);

    fireEvent.submit(
      within(dialog).getByText('common:buttons.save').closest('form') as HTMLFormElement,
    );

    expect(onUpdateInvoice).not.toHaveBeenCalled();
    expect(within(dialog).getByText(errorKey)).toBeInTheDocument();
  });
});

describe('ClientsInvoicesView modal styling', () => {
  test('edit modal uses the shared shadcn modal layout and form primitives', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      "import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';",
      "import { Input } from '@/components/ui/input';",
      "import { Textarea } from '@/components/ui/textarea';",
      '<ModalContent size="full"',
      '<ModalHeader>',
      '<ModalBody className="flex-1 space-y-5">',
      '<ModalFooter>',
      'id="client-invoice-client"',
      'id="client-invoice-notes"',
      "summary', { defaultValue: 'Summary' })",
      '<DeleteConfirmModal',
    ]);
    expectSourceOmitsAll(source, [
      'rounded-2xl bg-white',
      'shadow-lg shadow-zinc-200',
      '<textarea',
    ]);
  });

  test('notes section header matches other modal section headers', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      '<h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">',
      '<span className="size-1.5 rounded-full bg-primary"></span>',
      '<FieldLabel htmlFor="client-invoice-notes" className="sr-only">',
      'id="client-invoice-notes"',
    ]);
  });

  test('invoice number field previews the issue-date document code when blank', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "useDocumentCodePreview('client_invoice'",
      'date: formData.issueDate',
      'clientInvoiceCodePreview ??',
      'autoCodePreviewDescription',
    ]);
  });

  test('renders invoice items through the shared StandardTable', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "import StandardTable, { type Column } from '../shared/StandardTable';",
      'const columns: Column<InvoiceItem>[]',
      '<StandardTable<InvoiceItem>',
      'persistenceKey="accounting.clientInvoices.items"',
      'createLineItemIndexResolver(controller.formData.items)',
    ]);
    expectSourceOmitsAll(source, ['<DocumentLineItemsScrollArea']);
  });

  test('item rows render unit, currency, and percentage beside inputs instead of headers', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "header: controller.t('common:labels.price')",
      "header: controller.t('common:labels.discount')",
      '/',
      'suffix={controller.currency}',
      '<span className="shrink-0 text-xs font-medium text-muted-foreground">',
      'const InvoiceItemNumberField',
      'suffix="%"',
      '%',
    ]);
    expectSourceOmitsAll(source, [
      "{t('common:labels.price')} ({currency})",
      "{t('common:labels.discount')}%",
    ]);
  });

  test('right-aligns numeric invoice editors like the other document item tables', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "'h-9 max-w-[5rem] flex-none text-right font-medium'",
      'className="flex h-9 items-center justify-end gap-1"',
      'className={CLIENT_INVOICE_ITEM_NUMBER_INPUT_CLASSNAME}',
      'placeholder="0,00"',
      'placeholder="0"',
    ]);
    expectSourceOmitsAll(source, ['className="flex items-center justify-center gap-1"']);
  });

  test('exposes a Durata column with a months/years unit selector and folds duration into the taxable line amount (issue #757)', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      // The Durata column header + per-row duration input wired through the shared value parser.
      "header: controller.t('sales:clientQuotes.durationColumn', { defaultValue: 'Duration' })",
      "'durationMonths',",
      'parseDurationValueToMonths(value, unit)',
      // The input shows the display value in the chosen unit, with a months/years selector.
      'getDurationInputValue(item)',
      '<DurationUnitSelector',
      // The taxable amount (and therefore subtotal/tax/total) multiplies by the line duration
      // via the shared clamp helper, which always works in canonical months.
      'getEffectiveDurationMonths(item)',
    ]);
    // The old months-only parser is gone now that the unit is selectable.
    expectSourceOmitsAll(source, ['parseDurationMonthsInput']);
  });
});

describe('<ClientsInvoicesView /> product quick-view shortcut', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  const productsWithLink: Product[] = [
    {
      id: 'product-1',
      name: 'Consulting',
      productCode: 'C-1',
      costo: 50,
      molPercentage: 20,
      costUnit: 'unit',
      type: 'supply',
    },
  ];

  const invoiceWithProduct: Invoice = {
    id: 'INV-LINK',
    clientId: 'client-1',
    clientName: 'Helios Energy Services',
    issueDate: '2026-01-01',
    dueDate: '2026-02-01',
    status: 'draft',
    subtotal: 0,
    taxTotal: 0,
    total: 0,
    amountPaid: 0,
    notes: '',
    items: [
      {
        id: 'item-1',
        invoiceId: 'INV-LINK',
        productId: 'product-1',
        description: 'Consulting',
        unitOfMeasure: 'unit',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        taxRate: 0,
      },
    ],
    createdAt: Date.UTC(2026, 0, 1),
    updatedAt: Date.UTC(2026, 0, 1),
  };

  const open = (extraProps: Record<string, unknown> = {}) => {
    render(
      <ClientsInvoicesView
        invoices={[invoiceWithProduct]}
        clients={clients}
        products={productsWithLink}
        onAddInvoice={mock(() => {})}
        onUpdateInvoice={mock(() => {})}
        onDeleteInvoice={mock(() => {})}
        currency="EUR"
        {...extraProps}
      />,
    );
    fireEvent.click(screen.getByText('Helios Energy Services').closest('tr') as HTMLElement);
    return screen.findByRole('dialog');
  };

  test('opens the referenced product on its pre-filtered page', async () => {
    const dialog = await open();
    const productLinks = within(dialog).getAllByRole('link', {
      name: 'sales:clientQuotes.openProductInNewTab',
    });
    expect(productLinks.length).toBeGreaterThan(0);
    for (const link of productLinks) {
      expect(link).toHaveAttribute('href', '#/catalog/internal-listing?filterId=product-1');
      expect(link).toHaveAttribute('target', '_blank');
    }
    // StandardTable cells have no floating-field gutter, so the shortcut stays inline.
    expect(productLinks.some((link) => link.className.includes('lg:absolute'))).toBe(false);
  });

  test('hides the product shortcut entirely without internal-listing access', async () => {
    const dialog = await open({ canViewInternalListing: false });
    expect(
      within(dialog).queryAllByRole('link', { name: 'sales:clientQuotes.openProductInNewTab' }),
    ).toHaveLength(0);
    expect(
      within(dialog).queryAllByRole('button', {
        name: 'sales:clientQuotes.productShortcutUnavailable',
      }),
    ).toHaveLength(0);
  });

  test('keeps the shortcut visible but disabled when the product is not loaded', async () => {
    // Same invoice line (productId 'product-1') but the product list is empty → the
    // shortcut has nothing to open and renders disabled rather than as a link.
    const dialog = await open({ products: [] });
    expect(
      within(dialog).queryAllByRole('link', { name: 'sales:clientQuotes.openProductInNewTab' }),
    ).toHaveLength(0);
    expect(
      within(dialog).getAllByRole('button', {
        name: 'sales:clientQuotes.productShortcutUnavailable',
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe('<ClientsInvoicesView /> line-item delete confirmation', () => {
  const openEditor = async () => {
    render(
      <ClientsInvoicesView
        invoices={[buildInvoice('INV-DEL', 'months')]}
        clients={clients}
        products={[]}
        onAddInvoice={mock(() => {})}
        onUpdateInvoice={mock(() => {})}
        onDeleteInvoice={mock(() => {})}
        currency="EUR"
      />,
    );
    fireEvent.click(screen.getByText('Helios Energy Services').closest('tr') as HTMLElement);
    return screen.findByRole('dialog');
  };

  test('confirms before removing a product line and removes it only after confirming', async () => {
    const dialog = await openEditor();
    const rowDeletes = rowDeleteButtons(dialog);
    expect(rowDeletes.length).toBeGreaterThan(0);

    // Clicking the trash icon must NOT remove the row immediately — it opens a confirmation.
    fireEvent.click(await openRowDeleteButton(dialog));
    const confirmUi = await screen.findByTestId('line-delete-confirm');
    expect(within(confirmUi).getByTestId('line-delete-title')).toHaveTextContent(
      'accounting:clientsInvoices.removeProductTitle',
    );
    expect(rowDeleteButtons(dialog)).toHaveLength(rowDeletes.length);

    fireEvent.click(within(confirmUi).getByTestId('line-delete-confirm-btn'));
    await waitFor(() => {
      expect(rowDeleteButtons(dialog)).toHaveLength(0);
    });
  });

  test('keeps the product line when the confirmation is dismissed', async () => {
    const dialog = await openEditor();
    const rowDeletes = rowDeleteButtons(dialog);

    fireEvent.click(await openRowDeleteButton(dialog));
    fireEvent.click(await screen.findByTestId('line-delete-cancel'));

    await waitFor(() => {
      expect(screen.queryByTestId('line-delete-confirm')).not.toBeInTheDocument();
    });
    expect(rowDeleteButtons(dialog)).toHaveLength(rowDeletes.length);
  });
});

describe('<ClientsInvoicesView /> new line identity', () => {
  test('shows placeholders instead of numeric defaults on a new invoice line', async () => {
    render(
      <ClientsInvoicesView
        invoices={[]}
        clients={clients}
        products={[]}
        onAddInvoice={mock(() => {})}
        onUpdateInvoice={mock(() => {})}
        onDeleteInvoice={mock(() => {})}
        currency="EUR"
      />,
    );
    fireEvent.click(screen.getByText('accounting:clientsInvoices.addInvoice'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByText('accounting:clientsInvoices.addItem'));

    await waitFor(() => {
      const decimalInputs = within(dialog).getAllByPlaceholderText('0,00') as HTMLInputElement[];
      expect(decimalInputs.length).toBeGreaterThanOrEqual(3);
      expect(decimalInputs.every((input) => input.value === '')).toBe(true);
      expect(within(dialog).getByPlaceholderText('0')).toHaveValue('');
      expect(within(dialog).getByPlaceholderText('22,00')).toHaveValue('');
    });
  });

  test('keeps the existing subtotal when a blank line is added', async () => {
    const dialog = await openEditModal(buildInvoice('INV-BLANK-LINE', 'months'));
    fireEvent.click(within(dialog).getByText('accounting:clientsInvoices.addItem'));

    const subtotalLabel = within(dialog).getByText('accounting:clientsInvoices.subtotal');
    expect(subtotalLabel.nextElementSibling).toHaveTextContent('7.200,00 EUR');
  });

  test('keeps rapidly-added rows independently editable when the clock value is unchanged', async () => {
    const dateNowSpy = spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      render(
        <ClientsInvoicesView
          invoices={[]}
          clients={clients}
          products={[]}
          onAddInvoice={mock(() => {})}
          onUpdateInvoice={mock(() => {})}
          onDeleteInvoice={mock(() => {})}
          currency="EUR"
        />,
      );
      fireEvent.click(screen.getByText('accounting:clientsInvoices.addInvoice'));
      const dialog = await screen.findByRole('dialog');
      const addItemButton = within(dialog).getByText('accounting:clientsInvoices.addItem');

      fireEvent.click(addItemButton);
      fireEvent.click(addItemButton);

      const descriptionInputs = await waitFor(() => {
        const inputs = within(dialog).getAllByPlaceholderText(
          'accounting:clientsInvoices.descriptionPlaceholder',
        ) as HTMLInputElement[];
        expect(inputs).toHaveLength(2);
        return inputs;
      });
      fireEvent.change(descriptionInputs[1], { target: { value: 'Second line' } });

      expect(descriptionInputs[0].value).toBe('');
      expect(descriptionInputs[1].value).toBe('Second line');
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});
