import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, within } from '@testing-library/react';
import type { Client, Invoice, Product } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

installI18nMock();

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
      unitOfMeasure: 'unit',
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
  const TAXABLE_LINE_TOTAL = '7200.00 EUR';

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
});

describe('ClientsInvoicesView modal styling', () => {
  test('edit modal uses the shared shadcn modal layout and form primitives', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      "import { Field, FieldError, FieldLabel } from '@/components/ui/field';",
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

  test('item rows render unit, currency, and percentage beside inputs instead of headers', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      "{t('common:labels.price')}</div>",
      "{t('common:labels.discount')}</div>",
      '/',
      '{currency}',
      '<span className="shrink-0 text-xs font-medium text-muted-foreground">',
      '%',
    ]);
    expectSourceOmitsAll(source, [
      "{t('common:labels.price')} ({currency})",
      "{t('common:labels.discount')}%",
    ]);
  });

  test('exposes a Durata column with a months/years unit selector and folds duration into the taxable line amount (issue #757)', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    expectSourceContainsAll(source, [
      // The Durata column header + per-row duration input wired through the shared value parser.
      "{t('sales:clientQuotes.durationColumn', { defaultValue: 'Duration' })}",
      "'durationMonths',",
      'parseDurationValueToMonths(value, unit)',
      // The input shows the display value in the chosen unit, with a months/years selector.
      'getDurationDisplayValue(item)',
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
