import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type {
  Client,
  ClientsOrder,
  OrderVersion,
  OrderVersionRow,
  Product,
  SupplierSaleOrder,
} from '../../../types';
import { LineDeleteConfirmStub } from '../../helpers/lineItemDeleteConfirm';
import { render } from '../../helpers/render';
import { openRowDeleteButton, rowDeleteButtons } from '../../helpers/rowDeleteButtons';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

// Stable `t`/`i18n` references: opening the edit modal mounts OrderVersionsPanel, whose
// `reload` puts `t` in a useCallback dep array. The shared installI18nMock helper hands out a
// fresh `t` per render, which makes that effect re-fire forever (the panel's reducer always
// yields a new state). A stable identity mirrors real react-i18next and avoids the loop.
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

let versionRows: OrderVersionRow[] = [];
let versionPreview: OrderVersion | null = null;

// Opening the edit modal mounts OrderVersionsPanel, which fetches version history on mount.
// Stub the API so the modal renders without a real network call.
mock.module('../../../services/api/clientsOrders', () => ({
  clientsOrdersApi: {
    listVersions: () => Promise.resolve(versionRows),
    getVersion: () =>
      versionPreview ? Promise.resolve(versionPreview) : Promise.reject(new Error('not used')),
    restoreVersion: () => Promise.reject(new Error('not used')),
  },
}));

// Modal locks body scroll while open; reset it between tests.
afterEach(() => {
  versionRows = [];
  versionPreview = null;
  document.body.style.overflow = '';
});

// Other suites globally stub DeleteConfirmModal (Bun's mock.module is process-wide and
// last-write-wins), so pin the shared deterministic stub against this file's binding.
mock.module('../../../components/shared/DeleteConfirmModal', () => ({
  default: LineDeleteConfirmStub,
}));

const ClientsOrdersView = (await import('../../../components/accounting/ClientsOrdersView'))
  .default;

const clients: Client[] = [{ id: 'client-1', name: 'Helios Energy Services' }];

const orders: ClientsOrder[] = [
  {
    id: 'dm_so_01',
    clientId: 'client-1',
    clientName: 'Helios Energy Services',
    items: [
      {
        id: 'item-1',
        orderId: 'dm_so_01',
        productId: 'product-1',
        productName: 'Consulting',
        quantity: 2,
        unitPrice: 2000,
        productCost: 1200,
        productMolPercentage: 40,
      },
    ],
    paymentTerms: '30gg',
    discount: 5,
    discountType: 'percentage',
    status: 'draft',
    createdAt: Date.UTC(2026, 3, 24),
    updatedAt: Date.UTC(2026, 3, 24),
  },
];

describe('<ClientsOrdersView />', () => {
  test('pricing amount columns keep sorting but hide StandardTable header filters', () => {
    render(
      <ClientsOrdersView
        orders={orders}
        clients={clients}
        products={[]}
        currency="EUR"
        onUpdateClientsOrder={mock(() => Promise.resolve())}
        onDeleteClientsOrder={mock(() => Promise.resolve())}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'table.filters sales:clientQuotes.globalDiscount' }),
    ).toBeInTheDocument();

    for (const header of [
      'accounting:clientsOrders.subtotal',
      'common:labels.discount',
      'accounting:clientsOrders.margin',
      'sales:clientQuotes.totalCost',
      'accounting:clientsOrders.totalColumn',
    ]) {
      expect(screen.queryByRole('button', { name: `table.filters ${header}` })).toBeNull();
      expect(screen.getByText(header).closest('th')?.querySelector('svg')).toBeInTheDocument();
    }
  });

  test('client column does not render item count below the client name', () => {
    render(
      <ClientsOrdersView
        orders={orders}
        clients={clients}
        products={[]}
        currency="EUR"
        onUpdateClientsOrder={mock(() => Promise.resolve())}
        onDeleteClientsOrder={mock(() => Promise.resolve())}
      />,
    );

    expect(screen.getByText('Helios Energy Services')).toBeInTheDocument();
    expect(screen.queryByText('accounting:clientsOrders.itemsCount')).toBeNull();
  });

  test('only denied rows use the muted table style', () => {
    const confirmedOrder: ClientsOrder = {
      ...orders[0],
      id: 'dm_so_confirmed',
      status: 'confirmed',
    };
    const deniedOrder: ClientsOrder = {
      ...orders[0],
      id: 'dm_so_denied',
      status: 'denied',
    };

    render(
      <ClientsOrdersView
        orders={[confirmedOrder, deniedOrder]}
        clients={clients}
        products={[]}
        currency="EUR"
        onUpdateClientsOrder={mock(() => Promise.resolve())}
        onDeleteClientsOrder={mock(() => Promise.resolve())}
      />,
    );

    const confirmedRow = screen.getByText('dm_so_confirmed').closest('tr');
    const deniedRow = screen.getByText('dm_so_denied').closest('tr');

    expect(confirmedRow?.className).toContain('hover:bg-muted/50');
    expect(confirmedRow?.className).not.toContain('bg-muted text-muted-foreground');
    expect(confirmedRow?.querySelector('.opacity-60')).toBeNull();
    expect(deniedRow?.className).toContain('bg-muted text-muted-foreground');
    expect(deniedRow?.querySelector('.opacity-60')).not.toBeNull();
  });

  test('scales order-row totals by a line item duration (issue #757)', () => {
    const durationOrder: ClientsOrder = {
      id: 'dm_so_dur',
      clientId: 'client-1',
      clientName: 'Helios Energy Services',
      items: [
        {
          id: 'item-dur',
          orderId: 'dm_so_dur',
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
      createdAt: Date.UTC(2026, 3, 24),
      updatedAt: Date.UTC(2026, 3, 24),
    };

    render(
      <ClientsOrdersView
        orders={[durationOrder]}
        clients={clients}
        products={[]}
        currency="EUR"
        onUpdateClientsOrder={mock(() => Promise.resolve())}
        onDeleteClientsOrder={mock(() => Promise.resolve())}
      />,
    );

    // Subtotal (revenue) = 100 × 2 × 3 = 600 (would be 200 without duration).
    expect(screen.getAllByText('600,00 EUR').length).toBeGreaterThan(0);
    // Margin = 600 − (60 × 2 × 3 = 360) = 240, only correct when both scale by duration.
    expect(screen.getAllByText('240,00 EUR').length).toBeGreaterThan(0);
  });

  test('a years duration prices off the canonical months, matching the months equivalent (issue #757)', () => {
    // durationUnit only controls display; pricing always uses the canonical durationMonths (24),
    // so "2 years" (24 months) totals the same as a 24-month line.
    const yearsOrder: ClientsOrder = {
      id: 'dm_so_years',
      clientId: 'client-1',
      clientName: 'Helios Energy Services',
      items: [
        {
          id: 'item-years',
          orderId: 'dm_so_years',
          productId: 'product-1',
          productName: 'Consulting',
          quantity: 2,
          unitPrice: 100,
          productCost: 60,
          productMolPercentage: 40,
          durationMonths: 24,
          durationUnit: 'years',
        },
      ],
      paymentTerms: '30gg',
      discount: 0,
      discountType: 'percentage',
      status: 'draft',
      createdAt: Date.UTC(2026, 3, 24),
      updatedAt: Date.UTC(2026, 3, 24),
    };

    render(
      <ClientsOrdersView
        orders={[yearsOrder]}
        clients={clients}
        products={[]}
        currency="EUR"
        onUpdateClientsOrder={mock(() => Promise.resolve())}
        onDeleteClientsOrder={mock(() => Promise.resolve())}
      />,
    );

    // Subtotal (revenue) = 100 × 2 × 24 = 4800.
    expect(screen.getAllByText('4.800,00 EUR').length).toBeGreaterThan(0);
    // Margin = 4800 − (60 × 2 × 24 = 2880) = 1920.
    expect(screen.getAllByText('1.920,00 EUR').length).toBeGreaterThan(0);
  });

  test('MOL line input keeps two decimals instead of rounding to one (issue #780)', async () => {
    const twoDecimalMolOrder: ClientsOrder = {
      id: 'dm_so_mol',
      clientId: 'client-1',
      clientName: 'Helios Energy Services',
      items: [
        {
          id: 'item-mol',
          orderId: 'dm_so_mol',
          productId: 'product-1',
          productName: 'Consulting',
          quantity: 2,
          unitPrice: 2000,
          productCost: 1200,
          productMolPercentage: 12.34,
        },
      ],
      paymentTerms: '30gg',
      discount: 0,
      discountType: 'percentage',
      status: 'draft',
      createdAt: Date.UTC(2026, 3, 24),
      updatedAt: Date.UTC(2026, 3, 24),
    };

    render(
      <ClientsOrdersView
        orders={[twoDecimalMolOrder]}
        clients={clients}
        products={[]}
        currency="EUR"
        onUpdateClientsOrder={mock(() => Promise.resolve())}
        onDeleteClientsOrder={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByText('Helios Energy Services').closest('tr') as HTMLElement);
    await screen.findByRole('dialog');

    // The MOL input must preserve both decimals (12,34). The pre-fix formatDecimals={1}
    // rounded the displayed value to a single decimal (12,3), silently dropping precision.
    expect(screen.queryAllByDisplayValue('12,34').length).toBeGreaterThan(0);
    expect(screen.queryAllByDisplayValue('12,3')).toHaveLength(0);
  });

  test('edit modal uses the shared shadcn modal layout and form primitives', async () => {
    const source = await readComponentSource('accounting/ClientsOrdersView.tsx');

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      "import { Field, FieldError, FieldLabel } from '@/components/ui/field';",
      "import { Textarea } from '@/components/ui/textarea';",
      '<ModalContent size="full"',
      '<ModalHeader>',
      '<ModalBody className="flex-1 space-y-5">',
      '<ModalFooter>',
      'id="client-order-client"',
      'id="client-order-notes"',
      "summary', { defaultValue: 'Summary' })",
      '<DeleteConfirmModal',
    ]);
    expectSourceOmitsAll(source, [
      'rounded-2xl bg-white',
      'shadow-lg shadow-zinc-200',
      '<textarea',
    ]);
  });

  test('product rows use StandardTable while preserving native control heights', async () => {
    const source = await readComponentSource('accounting/ClientsOrdersView.tsx');

    expectSourceContainsAll(source, [
      '<StandardTable<ClientsOrderItem>',
      'persistenceKey="accounting.clientOrders.items"',
      '<OrderSectionTitle>',
      'onClick={controller.addProductRow}',
      'showColumnSettings={false}',
      'defaultRowsPerPage={5}',
      'minBodyRows={0}',
      'className="min-w-[220px]"',
      "const compactInputClass = 'h-9 max-w-[5rem] flex-none text-center font-medium';",
      'className="flex h-9 items-center justify-center gap-1"',
      'className="flex h-9 items-center justify-end whitespace-nowrap px-3 text-sm font-bold text-foreground"',
    ]);
  });

  test('notes section header matches other modal section headers', async () => {
    const source = await readComponentSource('accounting/ClientsOrdersView.tsx');

    expectSourceContainsAll(source, [
      '<h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">',
      '<span className="size-1.5 rounded-full bg-primary"></span>',
      '<FieldLabel htmlFor="client-order-notes" className="sr-only">',
      'id="client-order-notes"',
    ]);
  });

  test('handleSubmit/handleDelete/handleStatusUpdate await + try/catch + toast', async () => {
    const source = await readComponentSource('accounting/ClientsOrdersView.tsx');

    expectSourceContainsAll(source, [
      "import { toastError } from '../../utils/toast';",
      'const handleSubmit = async (e: React.FormEvent)',
      'await onUpdateClientsOrder(editingOrder.id, payload);',
      'const handleDelete = async () =>',
      'await onDeleteClientsOrder(orderToDelete.id);',
      'const handleStatusUpdate = useCallback(',
      'await onUpdateClientsOrder(id, updates);',
      "t('accounting:clientsOrders.failedToSave')",
      "t('accounting:clientsOrders.failedToDelete')",
      "t('accounting:clientsOrders.failedToUpdateStatus')",
      "void handleStatusUpdate(row.id, { status: 'confirmed' });",
      "void handleStatusUpdate(row.id, { status: 'denied' });",
    ]);
  });
});

describe('<ClientsOrdersView /> draft-from-offer editability', () => {
  const draftLinkedOrder: ClientsOrder = { ...orders[0], id: 'dm_so_02', linkedOfferId: 'off-1' };
  const confirmedLinkedOrder: ClientsOrder = {
    ...orders[0],
    id: 'dm_so_03',
    status: 'confirmed',
    linkedOfferId: 'off-2',
  };

  const openModal = async (
    order: ClientsOrder,
    onUpdate = mock((_id: string, _updates: Partial<ClientsOrder>) => Promise.resolve()),
    productList: Product[] = [],
  ) => {
    render(
      <ClientsOrdersView
        orders={[order]}
        clients={clients}
        products={productList}
        currency="EUR"
        onUpdateClientsOrder={onUpdate}
        onDeleteClientsOrder={mock(() => Promise.resolve())}
      />,
    );
    fireEvent.click(screen.getByText('Helios Energy Services').closest('tr') as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    return { dialog, onUpdate };
  };

  const isDisabled = (el: Element | null) =>
    (el as HTMLButtonElement | HTMLTextAreaElement).disabled;

  test('a draft order linked to an offer renders all fields editable', async () => {
    const { dialog } = await openModal(draftLinkedOrder);

    expect(isDisabled(dialog.querySelector('#client-order-client'))).toBe(false);
    expect(isDisabled(dialog.querySelector('#client-order-notes'))).toBe(false);
    expect(
      isDisabled(within(dialog).getByRole('button', { name: /clientQuotes\.addProduct/ })),
    ).toBe(false);
    expect(
      isDisabled(
        within(dialog).getByRole('button', { name: 'accounting:clientsOrders.updateOrder' }),
      ),
    ).toBe(false);
    // The linked-offer note now says details are editable, not read-only.
    expect(
      within(dialog).getByText('accounting:clientsOrders.offerDetailsEditable'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('accounting:clientsOrders.offerDetailsReadOnly')).toBeNull();
  });

  test('a confirmed order linked to an offer keeps identity locked but content editable', async () => {
    const { dialog } = await openModal(confirmedLinkedOrder);

    expect(isDisabled(dialog.querySelector('#client-order-client'))).toBe(true);
    expect(within(dialog).getByText(confirmedLinkedOrder.id).className).toContain(
      'text-muted-foreground',
    );
    expect(isDisabled(dialog.querySelector('#client-order-notes'))).toBe(false);
    expect(
      isDisabled(within(dialog).getByRole('button', { name: /clientQuotes\.addProduct/ })),
    ).toBe(false);
    expect(
      isDisabled(
        within(dialog).getByRole('button', { name: 'accounting:clientsOrders.updateOrder' }),
      ),
    ).toBe(false);
    expect(
      within(dialog).getByText('accounting:clientsOrders.confirmedIdentityLockedStatus'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('accounting:clientsOrders.readOnlyStatus')).toBeNull();
  });

  test('a denied order linked to an offer stays fully read-only', async () => {
    const deniedLinkedOrder: ClientsOrder = {
      ...confirmedLinkedOrder,
      id: 'dm_so_06',
      status: 'denied',
    };
    const { dialog } = await openModal(deniedLinkedOrder);

    expect(isDisabled(dialog.querySelector('#client-order-client'))).toBe(true);
    expect(within(dialog).getByText(deniedLinkedOrder.id).className).toContain(
      'text-muted-foreground',
    );
    expect(isDisabled(dialog.querySelector('#client-order-notes'))).toBe(true);
    expect(
      isDisabled(within(dialog).getByRole('button', { name: /clientQuotes\.addProduct/ })),
    ).toBe(true);
    expect(
      isDisabled(
        within(dialog).getByRole('button', { name: 'accounting:clientsOrders.updateOrder' }),
      ),
    ).toBe(true);
    expect(within(dialog).getByText('accounting:clientsOrders.readOnlyStatus')).toBeInTheDocument();
    const lineDiscountInputs = within(dialog)
      .getAllByRole('textbox', { name: 'common:labels.discount' })
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
    expect(lineDiscountInputs.length).toBeGreaterThan(0);
    expect(lineDiscountInputs.every((input) => input.disabled)).toBe(true);
  });

  test('a historical version preview stays fully read-only for a confirmed order', async () => {
    versionRows = [
      {
        id: 'ov-1',
        orderId: confirmedLinkedOrder.id,
        reason: 'update',
        createdByUserId: 'u1',
        createdAt: 1,
      },
    ];
    versionPreview = {
      ...versionRows[0],
      snapshot: {
        schemaVersion: 1,
        order: {
          ...confirmedLinkedOrder,
          notes: 'historical note',
        },
        items: confirmedLinkedOrder.items,
      },
    };
    const { dialog } = await openModal(confirmedLinkedOrder);

    fireEvent.click(await screen.findByText('clientsOrders.versionHistory.reasonUpdate'));

    await waitFor(() => expect(isDisabled(dialog.querySelector('#client-order-notes'))).toBe(true));
    expect(
      isDisabled(within(dialog).getByRole('button', { name: /clientQuotes\.addProduct/ })),
    ).toBe(true);
    expect(
      within(dialog).queryByRole('button', { name: 'accounting:clientsOrders.updateOrder' }),
    ).toBeNull();
  });

  test('edits a line discount, shows net values, and submits it', async () => {
    const { dialog, onUpdate } = await openModal(draftLinkedOrder);

    const lineDiscountInputs = within(dialog)
      .getAllByRole('textbox', { name: 'common:labels.discount' })
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
    expect(lineDiscountInputs.length).toBeGreaterThan(0);
    fireEvent.change(lineDiscountInputs[0], { target: { value: '150' } });
    expect(lineDiscountInputs[0]).toHaveValue('100,00');
    fireEvent.change(lineDiscountInputs[0], { target: { value: '25' } });
    expect(within(dialog).getAllByText('3.000,00 EUR').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('600,00 EUR').length).toBeGreaterThan(0);

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'accounting:clientsOrders.updateOrder' }),
    );
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][1].items?.[0].discount).toBe(25);
  });

  test('submitting an edited draft-from-offer order calls onUpdateClientsOrder', async () => {
    const { dialog, onUpdate } = await openModal(draftLinkedOrder);

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'accounting:clientsOrders.updateOrder' }),
    );

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][0]).toBe('dm_so_02');
    const payload = onUpdate.mock.calls[0][1];
    expect(payload.linkedOfferId).toBe('off-1');
    expect(payload.items).toHaveLength(1);
  });

  const consultingProduct: Product = {
    id: 'product-1',
    name: 'Consulting',
    productCode: 'C-1',
    costo: 1200,
    molPercentage: 40,
    costUnit: 'unit',
    type: 'supply',
  };

  test('product selector and remove button are locked for a supplier-order-backed line', async () => {
    const supplierBackedDraft: ClientsOrder = {
      ...draftLinkedOrder,
      id: 'dm_so_04',
      items: [
        {
          ...orders[0].items[0],
          id: 'item-sup',
          supplierQuoteItemId: 'sqi-1',
          supplierSaleId: 'ss-1',
          supplierSaleItemId: 'ssi-1',
        },
      ],
    };
    // product-1 is in the catalog, so the selector renders the selected product but stays locked.
    const { dialog } = await openModal(supplierBackedDraft, undefined, [consultingProduct]);

    // The product is fixed by the source supplier quote and removing the line would orphan the
    // auto-created supplier order — both controls are locked (so the user can't reach an
    // edit path the backend always rejects with 409) even though the draft is editable.
    expect(isDisabled(within(dialog).getByRole('button', { name: /Consulting/ }))).toBe(true);
    expect(isDisabled(await openRowDeleteButton(dialog))).toBe(true);
  });

  test('a product-less supplier line shows its name read-only, not an empty selector (issue #783)', async () => {
    const productLessDraft: ClientsOrder = {
      ...draftLinkedOrder,
      id: 'dm_so_05',
      items: [
        {
          ...orders[0].items[0],
          id: 'item-free',
          // A free-form supplier-quote line with no catalog product (sale_items.product_id null).
          productId: '',
          productName: 'Custom integration from SupplierX',
          supplierQuoteItemId: 'sqi-2',
          supplierSaleId: 'ss-2',
          supplierSaleItemId: 'ssi-2',
        },
      ],
    };
    const { dialog } = await openModal(productLessDraft);

    // Before #783 made product_id nullable orders never had such a line; now the editor must show
    // the supplier-sourced name read-only instead of an empty (and misleading) product dropdown.
    expect(
      within(dialog).getByDisplayValue('Custom integration from SupplierX'),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'sales:clientQuotes.selectProduct' }),
    ).toBeNull();
  });

  test('product selector and remove button stay enabled for a non-supplier draft line', async () => {
    const { dialog } = await openModal(draftLinkedOrder);

    expect(
      isDisabled(within(dialog).getByRole('button', { name: 'sales:clientQuotes.selectProduct' })),
    ).toBe(false);
    expect(isDisabled(await openRowDeleteButton(dialog))).toBe(false);
  });
});

describe('<ClientsOrdersView /> product quick-view shortcut', () => {
  const productsWithLink: Product[] = [
    {
      id: 'product-1',
      name: 'Consulting',
      productCode: 'C-1',
      costo: 1200,
      molPercentage: 40,
      costUnit: 'unit',
      type: 'supply',
    },
  ];

  const openModal = (extraProps: Record<string, unknown> = {}) => {
    render(
      <ClientsOrdersView
        orders={orders}
        clients={clients}
        products={productsWithLink}
        currency="EUR"
        onUpdateClientsOrder={mock(() => Promise.resolve())}
        onDeleteClientsOrder={mock(() => Promise.resolve())}
        {...extraProps}
      />,
    );
    fireEvent.click(screen.getByText('Helios Energy Services').closest('tr') as HTMLElement);
    return screen.findByRole('dialog');
  };

  test('opens the referenced product on its pre-filtered page', async () => {
    const dialog = await openModal();
    const productLinks = within(dialog).getAllByRole('link', {
      name: 'sales:clientQuotes.openProductInNewTab',
    });
    expect(productLinks.length).toBeGreaterThan(0);
    for (const link of productLinks) {
      expect(link).toHaveAttribute('href', '#/catalog/internal-listing?filterId=product-1');
      expect(link).toHaveAttribute('target', '_blank');
    }
    // The shortcut floats above the field on desktop (lg:absolute), matching quotes/offers.
    expect(productLinks.some((link) => link.className.includes('lg:absolute'))).toBe(true);
  });

  test('hides the product shortcut entirely without internal-listing access', async () => {
    const dialog = await openModal({ canViewInternalListing: false });
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
    // Same order line (productId 'product-1') but the product list is empty, so the
    // shortcut has nothing to open and renders disabled rather than as a link.
    const dialog = await openModal({ products: [] });
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

describe('<ClientsOrdersView /> supplier-order quick-view shortcut', () => {
  // A line auto-created behind a supplier quote carries the supplier order it spawned.
  const supplierBackedOrder: ClientsOrder = {
    id: 'dm_so_sup',
    clientId: 'client-1',
    clientName: 'Helios Energy Services',
    items: [
      {
        id: 'item-sup-link',
        orderId: 'dm_so_sup',
        productId: 'product-1',
        productName: 'Consulting',
        quantity: 1,
        unitPrice: 1000,
        productCost: 600,
        supplierSaleId: 'ss-42',
        supplierSaleItemId: 'ssi-42',
        supplierSaleSupplierName: 'SupplierX',
      },
    ],
    paymentTerms: '30gg',
    discount: 0,
    discountType: 'percentage',
    status: 'draft',
    createdAt: Date.UTC(2026, 3, 24),
    updatedAt: Date.UTC(2026, 3, 24),
  };

  // The builder only reads o.id, so a one-field fixture is enough.
  const supplierOrders = [{ id: 'ss-42' }] as unknown as SupplierSaleOrder[];

  const openModal = (extraProps: Record<string, unknown> = {}) => {
    render(
      <ClientsOrdersView
        orders={[supplierBackedOrder]}
        clients={clients}
        products={[]}
        supplierOrders={supplierOrders}
        currency="EUR"
        onUpdateClientsOrder={mock(() => Promise.resolve())}
        onDeleteClientsOrder={mock(() => Promise.resolve())}
        {...extraProps}
      />,
    );
    fireEvent.click(screen.getByText('Helios Energy Services').closest('tr') as HTMLElement);
    return screen.findByRole('dialog');
  };

  test('opens the referenced supplier order on its pre-filtered page', async () => {
    const dialog = await openModal();
    const links = within(dialog).getAllByRole('link', {
      name: 'accounting:clientsOrders.openSupplierOrderInNewTab',
    });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '#/accounting/supplier-orders?filterId=ss-42');
      expect(link).toHaveAttribute('target', '_blank');
    }
    // Floats above the field on desktop (lg:absolute), matching the product shortcut.
    expect(links.some((link) => link.className.includes('lg:absolute'))).toBe(true);
  });

  test('keeps the line discount editable when the line is linked to a supplier order', async () => {
    const dialog = await openModal();
    const lineDiscountInputs = within(dialog)
      .getAllByRole('textbox', { name: 'common:labels.discount' })
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);

    expect(lineDiscountInputs.length).toBeGreaterThan(0);
    expect(lineDiscountInputs.every((input) => !input.disabled)).toBe(true);
  });
  test('hides the supplier-order shortcut entirely without supplier-orders access', async () => {
    const dialog = await openModal({ canViewSupplierOrders: false });
    expect(
      within(dialog).queryAllByRole('link', {
        name: 'accounting:clientsOrders.openSupplierOrderInNewTab',
      }),
    ).toHaveLength(0);
    expect(
      within(dialog).queryAllByRole('button', {
        name: 'accounting:clientsOrders.supplierOrderShortcutUnavailable',
      }),
    ).toHaveLength(0);
  });

  test('keeps the shortcut visible but disabled when the supplier order is not loaded', async () => {
    // The line still references ss-42, but it isn't in the loaded supplier-orders set,
    // so the shortcut has nothing to open and renders disabled rather than as a link.
    const dialog = await openModal({ supplierOrders: [] });
    expect(
      within(dialog).queryAllByRole('link', {
        name: 'accounting:clientsOrders.openSupplierOrderInNewTab',
      }),
    ).toHaveLength(0);
    expect(
      within(dialog).getAllByRole('button', {
        name: 'accounting:clientsOrders.supplierOrderShortcutUnavailable',
      }).length,
    ).toBeGreaterThan(0);
  });

  test('shows the shortcut disabled on a line with no supplier order', async () => {
    // orders[0]'s single line has no supplierSaleId. Like the product/supplier-quote
    // shortcuts, the icon still renders (reserving a stable slot) but disabled, with
    // the "nothing to open" tooltip rather than as a link.
    const dialog = await openModal({ orders: [orders[0]] });
    expect(
      within(dialog).queryAllByRole('link', {
        name: 'accounting:clientsOrders.openSupplierOrderInNewTab',
      }),
    ).toHaveLength(0);
    expect(
      within(dialog).getAllByRole('button', {
        name: 'accounting:clientsOrders.supplierOrderShortcutUnavailable',
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe('<ClientsOrdersView /> line-item delete confirmation', () => {
  const openEditor = async () => {
    render(
      <ClientsOrdersView
        orders={orders}
        clients={clients}
        products={[]}
        currency="EUR"
        onUpdateClientsOrder={mock(() => Promise.resolve())}
        onDeleteClientsOrder={mock(() => Promise.resolve())}
      />,
    );
    fireEvent.click(screen.getByText('Helios Energy Services').closest('tr') as HTMLElement);
    return screen.findByRole('dialog');
  };

  test('confirms before removing a product line and removes it only after confirming', async () => {
    const dialog = await openEditor();
    const rowDeletes = rowDeleteButtons(dialog);
    expect(rowDeletes.length).toBeGreaterThan(0);

    fireEvent.click(await openRowDeleteButton(dialog));
    const confirmUi = await screen.findByTestId('line-delete-confirm');
    expect(within(confirmUi).getByTestId('line-delete-title')).toHaveTextContent(
      'accounting:clientsOrders.removeProductTitle',
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
