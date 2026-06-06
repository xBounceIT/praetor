import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Client, ClientsOrder } from '../../../types';
import { render } from '../../helpers/render';
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

// Opening the edit modal mounts OrderVersionsPanel, which fetches version history on mount.
// Stub the API so the modal renders without a real network call.
mock.module('../../../services/api/clientsOrders', () => ({
  clientsOrdersApi: {
    listVersions: () => Promise.resolve([]),
    getVersion: () => Promise.reject(new Error('not used')),
    restoreVersion: () => Promise.reject(new Error('not used')),
  },
}));

// Modal locks body scroll while open; reset it between tests.
afterEach(() => {
  document.body.style.overflow = '';
});

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
    expect(screen.getAllByText('600.00 EUR').length).toBeGreaterThan(0);
    // Margin = 600 − (60 × 2 × 3 = 360) = 240, only correct when both scale by duration.
    expect(screen.getAllByText('240.00 EUR').length).toBeGreaterThan(0);
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
    expect(screen.getAllByText('4800.00 EUR').length).toBeGreaterThan(0);
    // Margin = 4800 − (60 × 2 × 24 = 2880) = 1920.
    expect(screen.getAllByText('1920.00 EUR').length).toBeGreaterThan(0);
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

  test('product rows align modal controls to the native shadcn control height', async () => {
    const source = await readComponentSource('accounting/ClientsOrdersView.tsx');

    expectSourceContainsAll(source, [
      'className="flex items-start gap-2 lg:items-center"',
      'className="grid flex-1 grid-cols-1 gap-2 lg:grid-cols-14 lg:items-center"',
      'className="min-w-0 space-y-1 lg:col-span-2 lg:space-y-0"',
      'className="flex h-9 items-center rounded-md border border-border bg-background px-3"',
      'className="flex h-9 items-center gap-1"',
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
  ) => {
    render(
      <ClientsOrdersView
        orders={[order]}
        clients={clients}
        products={[]}
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

  test('a confirmed order linked to an offer stays read-only', async () => {
    const { dialog } = await openModal(confirmedLinkedOrder);

    expect(isDisabled(dialog.querySelector('#client-order-client'))).toBe(true);
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
    const { dialog } = await openModal(supplierBackedDraft);

    // The product is fixed by the source supplier quote and removing the line would orphan the
    // auto-created supplier order — both controls are locked (so the user can't reach an
    // edit path the backend always rejects with 409) even though the draft is editable.
    expect(
      isDisabled(within(dialog).getByRole('button', { name: 'sales:clientQuotes.selectProduct' })),
    ).toBe(true);
    expect(isDisabled(within(dialog).getByRole('button', { name: 'common:buttons.delete' }))).toBe(
      true,
    );
  });

  test('product selector and remove button stay enabled for a non-supplier draft line', async () => {
    const { dialog } = await openModal(draftLinkedOrder);

    expect(
      isDisabled(within(dialog).getByRole('button', { name: 'sales:clientQuotes.selectProduct' })),
    ).toBe(false);
    expect(isDisabled(within(dialog).getByRole('button', { name: 'common:buttons.delete' }))).toBe(
      false,
    );
  });
});
