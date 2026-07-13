import { afterEach, describe, expect, mock } from 'bun:test';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type {
  Client,
  Product,
  Quote,
  QuoteMutation,
  QuoteVersion,
  QuoteVersionRow,
  SupplierQuote,
} from '../../types';
import { LineDeleteConfirmStub } from '../helpers/lineItemDeleteConfirm';
import { settleComponentTasks, reactTest as test } from '../helpers/reactTest';
import { render } from '../helpers/render';

// Stable `t`/`i18n`: opening the edit modal mounts QuoteVersionsPanel, whose `reload`
// puts `t` in a useCallback dep. A fresh `t` per render would re-fire that effect
// forever, so mirror real react-i18next with a stable identity. Assertions check keys.
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

// QuoteVersionsPanel fetches version history on mount; stub the API so the modal
// renders without a real network call.
const listVersionsMock = mock(async (): Promise<QuoteVersionRow[]> => []);
const getVersionMock = mock(async (): Promise<QuoteVersion> => {
  throw new Error('not used');
});
const restoreVersionMock = mock(async (): Promise<Quote> => {
  throw new Error('not used');
});
mock.module('../../services/api/clientQuotes', () => ({
  clientQuotesApi: {
    listVersions: listVersionsMock,
    getVersion: getVersionMock,
    restoreVersion: restoreVersionMock,
  },
}));

// The quotes table is server-backed (viewKey); stub saved-views so it doesn't hit
// the network during the test.
mock.module('../../services/api/views', () => ({
  viewsApi: {
    list: () => Promise.resolve([]),
    create: () => Promise.reject(new Error('not used')),
    update: () => Promise.reject(new Error('not used')),
    remove: () => Promise.resolve(),
    directory: () => Promise.resolve([]),
    getShares: () => Promise.resolve([]),
    replaceShares: () => Promise.resolve([]),
  },
}));

// The sibling sales/ClientQuotesView test pins a deterministic DeleteConfirmModal stub for
// its line-item deletion tests. Bun's mock.module is process-wide and binds at first import
// of the SUT, so register the same stub here to keep that binding stable no matter which
// quote-view test file Bun evaluates first.
mock.module('../../components/shared/DeleteConfirmModal', () => ({
  default: LineDeleteConfirmStub,
}));

const ClientQuotesView = (await import('../../components/sales/ClientQuotesView')).default;

const product: Product = {
  id: 'prod-1',
  name: 'Solar Panel',
  productCode: 'SP-100',
  costo: 50,
  molPercentage: 20,
  costUnit: 'unit',
  type: 'supply',
};

const client: Client = { id: 'client-1', name: 'Helios Energy' };

const communicationChannels = [
  {
    id: 'qcc_email',
    name: 'Email',
    icon: 'envelope' as const,
    isDefault: true,
    clientQuoteCount: 0,
    supplierQuoteCount: 0,
    totalQuoteCount: 0,
  },
];

const supplierQuote: SupplierQuote = {
  id: 'SQ-1',
  supplierId: 'sup-1',
  supplierName: 'Acme Supplies',
  items: [
    {
      id: 'sqi-1',
      quoteId: 'SQ-1',
      productId: 'prod-1',
      productName: 'Solar Panel',
      quantity: 1,
      listPrice: 60,
      discountPercent: 0,
      unitPrice: 60,
      unitType: 'unit',
    },
  ],
  paymentTerms: 'immediate',
  status: 'accepted',
  expirationDate: '2099-12-31',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const buildQuote = (overrides: Partial<Quote>): Quote => ({
  id: 'Q-1',
  clientId: 'client-1',
  clientName: 'Helios Energy',
  items: [],
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  expirationDate: '2099-12-31',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

const baseProps = {
  clients: [client],
  products: [product],
  supplierQuotes: [supplierQuote],
  onAddQuote: () => {},
  onUpdateQuote: () => {},
  onDeleteQuote: () => {},
  currency: 'EUR',
};

const SUPPLIER_QUOTE_LINK = 'sales:clientQuotes.openSupplierQuoteInNewTab';
const PRODUCT_LINK = 'sales:clientQuotes.openProductInNewTab';
// The shortcut is always rendered (so it reserves a stable slot); when there is
// nothing to open it renders disabled with these tooltips instead of navigating.
const SUPPLIER_QUOTE_DISABLED = 'sales:clientQuotes.supplierQuoteShortcutUnavailable';
const PRODUCT_DISABLED = 'sales:clientQuotes.productShortcutUnavailable';

const openItemActions = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'table.rowActions' }));
  await waitFor(() => {
    expect(document.body.querySelector('[data-standard-table-action-menu="true"]')).not.toBeNull();
  });
};

afterEach(() => {
  // Modal locks body scroll while open; reset between tests.
  document.body.style.overflow = '';
  listVersionsMock.mockReset();
  listVersionsMock.mockResolvedValue([]);
  getVersionMock.mockReset();
  getVersionMock.mockRejectedValue(new Error('not used'));
  restoreVersionMock.mockReset();
  restoreVersionMock.mockRejectedValue(new Error('not used'));
});

describe('<ClientQuotesView /> candidate version previews', () => {
  test('switches the candidate tabs to the historical family and restores the current family', async () => {
    const currentCandidate = {
      id: 'qc-current',
      quoteId: 'Q-HISTORY',
      name: 'Current variant',
      position: 0,
      state: 'active' as const,
      items: [],
      paymentTerms: 'immediate' as const,
      discount: 0,
      discountType: 'percentage' as const,
      expirationDate: '2099-12-31',
      communicationChannelId: 'qcc_email',
      communicationChannelName: 'Email',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    const quote = buildQuote({ id: 'Q-HISTORY', candidates: [currentCandidate] });
    listVersionsMock.mockResolvedValueOnce([
      {
        id: 'qv-1',
        quoteId: 'Q-HISTORY',
        reason: 'update' as const,
        createdByUserId: 'u1',
        createdAt: 1_700_000_001_000,
      },
    ]);
    getVersionMock.mockResolvedValueOnce({
      id: 'qv-1',
      quoteId: 'Q-HISTORY',
      reason: 'update' as const,
      createdByUserId: 'u1',
      createdAt: 1_700_000_001_000,
      snapshot: {
        schemaVersion: 2 as const,
        quote,
        candidates: [
          { ...currentCandidate, id: 'qc-history-a', name: 'Historical A' },
          { ...currentCandidate, id: 'qc-history-b', name: 'Historical B', position: 1 },
        ],
        items: [],
      },
    });

    render(
      <ClientQuotesView
        {...baseProps}
        communicationChannels={communicationChannels}
        quotes={[quote]}
      />,
    );
    fireEvent.click(screen.getByText('Q-HISTORY'));
    const reason = await screen.findByText('clientQuotes.versionHistory.reasonUpdate');
    fireEvent.click(reason.closest('button') as HTMLButtonElement);

    expect(await screen.findByRole('tab', { name: /Historical A/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Historical B/ })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'clientQuotes.versionHistory.backToCurrent' }),
    );
    expect(screen.getByRole('tab', { name: /Current variant/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Historical B/ })).not.toBeInTheDocument();
  });
});

describe('<ClientQuotesView /> per-line quick-view links', () => {
  test('renders deep-link shortcuts to the referenced supplier quote and product', async () => {
    const quote = buildQuote({
      id: 'Q-LINKED',
      items: [
        {
          id: 'qi-1',
          quoteId: 'Q-LINKED',
          productId: 'prod-1',
          productName: 'Solar Panel',
          quantity: 1,
          unitPrice: 80,
          supplierQuoteId: 'SQ-1',
          supplierQuoteItemId: 'sqi-1',
        },
      ],
    });

    render(
      <ClientQuotesView
        {...baseProps}
        communicationChannels={communicationChannels}
        quotes={[quote]}
      />,
    );
    fireEvent.click(screen.getByText('Q-LINKED'));
    await openItemActions();

    // StandardTable exposes the shortcuts from the row action menu.
    const supplierLinks = screen.getAllByRole('link', { name: SUPPLIER_QUOTE_LINK });
    expect(supplierLinks.length).toBeGreaterThan(0);
    for (const link of supplierLinks) {
      expect(link).toHaveAttribute('href', '#/sales/supplier-quotes?filterId=SQ-1');
      expect(link).toHaveAttribute('target', '_blank');
    }

    const productLinks = screen.getAllByRole('link', { name: PRODUCT_LINK });
    expect(productLinks.length).toBeGreaterThan(0);
    for (const link of productLinks) {
      expect(link).toHaveAttribute('href', '#/catalog/internal-listing?filterId=prod-1');
      expect(link).toHaveAttribute('target', '_blank');
    }
  });

  test('hides the supplier-quote shortcut when the user cannot access that view', async () => {
    const quote = buildQuote({
      id: 'Q-NO-SQ-PERM',
      items: [
        {
          id: 'qi-perm-1',
          quoteId: 'Q-NO-SQ-PERM',
          productId: 'prod-1',
          productName: 'Solar Panel',
          quantity: 1,
          unitPrice: 80,
          supplierQuoteId: 'SQ-1',
          supplierQuoteItemId: 'sqi-1',
        },
      ],
    });

    render(<ClientQuotesView {...baseProps} quotes={[quote]} canViewSupplierQuotes={false} />);
    fireEvent.click(screen.getByText('Q-NO-SQ-PERM'));
    await openItemActions();

    // The supplier-quote view is permission-gated: the shortcut is hidden entirely
    // (no link AND no disabled placeholder), while the still-accessible product
    // shortcut remains active.
    expect(screen.queryAllByRole('link', { name: SUPPLIER_QUOTE_LINK })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: SUPPLIER_QUOTE_DISABLED })).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: PRODUCT_LINK }).length).toBeGreaterThan(0);
  });

  test('hides the product shortcut when the user cannot access the listing view', async () => {
    const quote = buildQuote({
      id: 'Q-NO-PROD-PERM',
      items: [
        {
          id: 'qi-perm-2',
          quoteId: 'Q-NO-PROD-PERM',
          productId: 'prod-1',
          productName: 'Solar Panel',
          quantity: 1,
          unitPrice: 80,
          supplierQuoteId: 'SQ-1',
          supplierQuoteItemId: 'sqi-1',
        },
      ],
    });

    render(<ClientQuotesView {...baseProps} quotes={[quote]} canViewInternalListing={false} />);
    fireEvent.click(screen.getByText('Q-NO-PROD-PERM'));
    await openItemActions();

    // No internal-listing access → the product shortcut is hidden entirely.
    expect(screen.queryAllByRole('link', { name: PRODUCT_LINK })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: PRODUCT_DISABLED })).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: SUPPLIER_QUOTE_LINK }).length).toBeGreaterThan(0);
  });

  test('disables (does not hide) the product shortcut when the linked product no longer exists', async () => {
    const quote = buildQuote({
      id: 'Q-STALE-PRODUCT',
      items: [
        {
          id: 'qi-stale-1',
          quoteId: 'Q-STALE-PRODUCT',
          productId: 'deleted-product',
          productName: 'Removed Product',
          quantity: 1,
          unitPrice: 80,
          supplierQuoteId: 'SQ-1',
          supplierQuoteItemId: 'sqi-1',
        },
      ],
    });

    render(
      <ClientQuotesView
        {...baseProps}
        communicationChannels={communicationChannels}
        quotes={[quote]}
      />,
    );
    fireEvent.click(screen.getByText('Q-STALE-PRODUCT'));
    await openItemActions();

    // A stale product id (hard-deleted) would dead-end on the full listing, so the
    // shortcut renders disabled (present but non-navigating) rather than as a link;
    // the still-existing supplier-quote link stays active.
    expect(screen.queryAllByRole('link', { name: PRODUCT_LINK })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: PRODUCT_DISABLED }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: SUPPLIER_QUOTE_LINK }).length).toBeGreaterThan(0);
  });

  test('disables the supplier-quote shortcut when the linked quote no longer exists', async () => {
    const quote = buildQuote({
      id: 'Q-STALE-SQ',
      items: [
        {
          id: 'qi-stale-2',
          quoteId: 'Q-STALE-SQ',
          productId: 'prod-1',
          productName: 'Solar Panel',
          quantity: 1,
          unitPrice: 80,
          supplierQuoteId: 'deleted-sq',
          supplierQuoteItemId: 'sqi-x',
        },
      ],
    });

    render(
      <ClientQuotesView
        {...baseProps}
        communicationChannels={communicationChannels}
        quotes={[quote]}
      />,
    );
    fireEvent.click(screen.getByText('Q-STALE-SQ'));
    await openItemActions();

    expect(screen.queryAllByRole('link', { name: SUPPLIER_QUOTE_LINK })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: SUPPLIER_QUOTE_DISABLED }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByRole('link', { name: PRODUCT_LINK }).length).toBeGreaterThan(0);
  });

  test('disables the supplier-quote shortcut when the row has no supplier quote', async () => {
    const quote = buildQuote({
      id: 'Q-PRODUCT-ONLY',
      items: [
        {
          id: 'qi-2',
          quoteId: 'Q-PRODUCT-ONLY',
          productId: 'prod-1',
          productName: 'Solar Panel',
          quantity: 1,
          unitPrice: 80,
        },
      ],
    });

    render(
      <ClientQuotesView
        {...baseProps}
        communicationChannels={communicationChannels}
        quotes={[quote]}
      />,
    );
    fireEvent.click(screen.getByText('Q-PRODUCT-ONLY'));
    await openItemActions();

    expect(screen.queryAllByRole('link', { name: SUPPLIER_QUOTE_LINK })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: SUPPLIER_QUOTE_DISABLED }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByRole('link', { name: PRODUCT_LINK }).length).toBeGreaterThan(0);
  });

  test('renders both shortcuts disabled (not navigating) for an unreferenced row', async () => {
    const quote = buildQuote({
      id: 'Q-EMPTY',
      items: [
        {
          id: 'qi-3',
          quoteId: 'Q-EMPTY',
          productId: '',
          productName: '',
          quantity: 1,
          unitPrice: 0,
        },
      ],
    });

    render(
      <ClientQuotesView
        {...baseProps}
        communicationChannels={communicationChannels}
        quotes={[quote]}
      />,
    );
    fireEvent.click(screen.getByText('Q-EMPTY'));
    await openItemActions();

    // Nothing to open on either field, but the shortcuts still occupy their slot —
    // both render as disabled placeholders, neither as an active link.
    expect(screen.queryAllByRole('link', { name: SUPPLIER_QUOTE_LINK })).toHaveLength(0);
    expect(screen.queryAllByRole('link', { name: PRODUCT_LINK })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: SUPPLIER_QUOTE_DISABLED }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByRole('button', { name: PRODUCT_DISABLED }).length).toBeGreaterThan(0);
  });
});

describe('<ClientQuotesView /> expired-quote handling (issue #779)', () => {
  const expiredQuote = (over: Partial<Quote> = {}): Quote =>
    buildQuote({
      id: 'Q-EXPIRED',
      status: 'sent',
      // The server marks an expired quote via effectiveStatus; the view trusts it (it short-circuits
      // the date math) so the row/modal go into the expired read-only-except-date mode. The default
      // prefilled date is FUTURE so the extend-submit passes its past-date validation.
      effectiveStatus: 'expired',
      expirationDate: '2999-12-31',
      items: [
        {
          id: 'qi-exp-1',
          quoteId: 'Q-EXPIRED',
          productId: 'prod-1',
          productName: 'Solar Panel',
          quantity: 1,
          unitPrice: 100,
        },
      ],
      ...over,
    });

  test('the restore (back-to-draft) button is disabled on an expired sent quote', async () => {
    // It would otherwise be a 409 dead-end: enabled in the UI, rejected by the server (issue #779).
    // Row actions live behind the StandardTable overflow menu ("table.rowActions").
    const user = userEvent.setup();
    render(<ClientQuotesView {...baseProps} quotes={[expiredQuote()]} />);

    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));

    const restoreIcon = document.querySelector('.fa-rotate-left');
    expect(restoreIcon).not.toBeNull();
    expect(restoreIcon?.closest('button')).toBeDisabled();
  });

  test('submitting an expired quote extends ONLY the expiration date', async () => {
    const onUpdateQuote = mock((_id: string, _updates: QuoteMutation) => Promise.resolve());
    render(
      <ClientQuotesView {...baseProps} quotes={[expiredQuote()]} onUpdateQuote={onUpdateQuote} />,
    );

    // Expired rows must stay openable — the modal is where the expiration gets extended (#779).
    fireEvent.click(screen.getByText('Q-EXPIRED'));
    const submit = (
      await screen.findAllByRole('button', { name: 'sales:clientQuotes.updateQuote' })
    )[0];
    expect(submit).toBeEnabled();
    const form = submit.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => expect(onUpdateQuote).toHaveBeenCalledTimes(1));
    const [id, payload] = onUpdateQuote.mock.calls[0];
    expect(id).toBe('Q-EXPIRED');
    // Only the expiration date is sent — no status/items/discount leak through (the form is
    // otherwise read-only and the server rejects content edits on an expired quote).
    expect(Object.keys(payload as object)).toEqual(['expirationDate']);
    expect((payload as { expirationDate: string }).expirationDate).toBeTruthy();
  });

  test('submitting with a still-past expiration date is rejected client-side', async () => {
    // Revalidation requires a date from today onward — saving the old past date would close the
    // modal while the quote silently stays expired (#779 second-pass review).
    const onUpdateQuote = mock((_id: string, _updates: QuoteMutation) => Promise.resolve());
    render(
      <ClientQuotesView
        {...baseProps}
        quotes={[expiredQuote({ expirationDate: '2000-01-01' })]}
        onUpdateQuote={onUpdateQuote}
      />,
    );

    fireEvent.click(screen.getByText('Q-EXPIRED'));
    const submit = (
      await screen.findAllByRole('button', { name: 'sales:clientQuotes.updateQuote' })
    )[0];
    const form = submit.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    // The guard rejects before any API call; the modal stays open for the user to pick a date.
    expect(onUpdateQuote).not.toHaveBeenCalled();
    const stillOpen = screen.getAllByRole('button', { name: 'sales:clientQuotes.updateQuote' });
    expect(stillOpen.length).toBeGreaterThan(0);
  });
});

describe('<ClientQuotesView /> supplier-quote pricing', () => {
  test('uses the persisted sale price and net supplier cost to show the margin', async () => {
    const discountedSupplierQuote: SupplierQuote = {
      ...supplierQuote,
      status: 'draft',
      items: [
        {
          ...supplierQuote.items[0],
          listPrice: 100,
          discountPercent: 20,
          unitPrice: 80,
        },
      ],
    };
    const quote = buildQuote({
      id: 'Q-LOCAL-MOL',
      items: [
        {
          id: 'qi-local-mol',
          quoteId: 'Q-LOCAL-MOL',
          productId: 'prod-1',
          productName: 'Solar Panel',
          quantity: 1,
          unitType: 'unit',
          // Reproduces the stale list-price value shown in the reported create flow.
          unitPrice: 100,
          productCost: 50,
          productMolPercentage: 0,
          supplierQuoteId: 'SQ-1',
          supplierQuoteItemId: 'sqi-1',
          supplierQuoteSupplierName: 'Acme Supplies',
          supplierQuoteUnitPrice: 80,
        },
      ],
    });

    render(
      <ClientQuotesView
        {...baseProps}
        quotes={[quote]}
        supplierQuotes={[discountedSupplierQuote]}
      />,
    );
    fireEvent.click(screen.getByText('Q-LOCAL-MOL'));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getAllByDisplayValue('0,00').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('20,00 EUR').length).toBeGreaterThan(0);
  });

  test('uses the persisted unit sale price when calculating line totals', async () => {
    const quote = buildQuote({
      id: 'Q-ROUNDED-MOL',
      items: [
        {
          id: 'qi-rounded-mol',
          quoteId: 'Q-ROUNDED-MOL',
          productId: 'prod-1',
          productName: 'Managed Service',
          quantity: 7,
          unitPrice: 1230.77,
          productMolPercentage: 35,
          supplierQuoteId: 'SQ-ROUNDING',
          supplierQuoteItemId: 'sqi-rounding',
          supplierQuoteSupplierName: 'Acme Supplies',
          supplierQuoteUnitPrice: 800,
        },
      ],
    });

    render(<ClientQuotesView {...baseProps} quotes={[quote]} supplierQuotes={[]} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Q-ROUNDED-MOL'));
      await settleComponentTasks();
    });
    const dialog = await screen.findByRole('dialog');
    await screen.findByText('clientQuotes.versionHistory.empty');

    expect(within(dialog).getAllByText('8.615,39 EUR').length).toBeGreaterThan(0);
  });
});

describe('<ClientQuotesView /> supplier-quote item labels', () => {
  test('an existing line keeps its label when the accepted supplier quote is past-dated', async () => {
    // The picker hides past-dated accepted quotes from NEW sourcing (intentional, #154), but an
    // existing line's display label must resolve across ALL supplier quotes — the link is intact
    // and the server-side sourcing gate still accepts the item.
    const pastDatedAccepted: SupplierQuote = {
      ...supplierQuote,
      id: 'SQ-OLD',
      expirationDate: '2000-01-01',
      items: [
        {
          id: 'sqi-old',
          quoteId: 'SQ-OLD',
          productId: 'prod-1',
          productName: 'Solar Panel',
          quantity: 1,
          listPrice: 60,
          discountPercent: 0,
          unitPrice: 60,
          unitType: 'unit',
        },
      ],
    };
    const quote = buildQuote({
      id: 'Q-OLD-SOURCE',
      items: [
        {
          id: 'qi-old-1',
          quoteId: 'Q-OLD-SOURCE',
          productId: 'prod-1',
          productName: 'Solar Panel',
          quantity: 1,
          unitPrice: 80,
          supplierQuoteId: 'SQ-OLD',
          supplierQuoteItemId: 'sqi-old',
        },
      ],
    });

    render(
      <ClientQuotesView {...baseProps} quotes={[quote]} supplierQuotes={[pastDatedAccepted]} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Q-OLD-SOURCE'));
      await settleComponentTasks();
    });

    expect(
      screen.getAllByText('[SQ-OLD] Acme Supplies · Solar Panel (60,00)').length,
    ).toBeGreaterThan(0);
  });
});
describe('<ClientQuotesView /> supplier-quote item availability', () => {
  const sourceableSupplierQuote: SupplierQuote = {
    ...supplierQuote,
    status: 'draft',
    items: [
      supplierQuote.items[0],
      {
        id: 'sqi-2',
        quoteId: 'SQ-1',
        productName: 'Battery',
        quantity: 1,
        listPrice: 40,
        discountPercent: 0,
        unitPrice: 40,
        unitType: 'unit',
      },
    ],
  };
  const emptySupplierLabel = 'sales:clientQuotes.noSupplierQuote';
  const firstSupplierItemLabel = '[SQ-1] Acme Supplies · Solar Panel (60,00)';
  const secondSupplierItemLabel = '[SQ-1] Acme Supplies · Battery (40,00)';

  const getOpenSupplierItem = (label: string) => {
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
    ).find((item) => item.textContent?.includes(label));
    if (!option) throw new Error(`Supplier item option not found: ${label}`);
    return option;
  };

  test('disables used items in other create rows and re-enables them after unlinking', () => {
    render(
      <ClientQuotesView {...baseProps} quotes={[]} supplierQuotes={[sourceableSupplierQuote]} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'sales:clientQuotes.createNewQuote' }));
    fireEvent.click(screen.getByText('sales:clientQuotes.addProduct'));
    fireEvent.click(screen.getByText('sales:clientQuotes.addProduct'));

    const initialPickers = screen.getAllByRole('button', { name: emptySupplierLabel });
    expect(initialPickers).toHaveLength(2);

    fireEvent.click(initialPickers[0]);
    fireEvent.click(getOpenSupplierItem(firstSupplierItemLabel));

    const secondRowPickers = screen.getAllByRole('button', { name: emptySupplierLabel });
    expect(secondRowPickers).toHaveLength(1);
    fireEvent.click(secondRowPickers[0]);

    const usedOption = getOpenSupplierItem(firstSupplierItemLabel);
    expect(usedOption).toHaveAttribute('data-disabled', 'true');
    expect(usedOption).toHaveClass('data-[disabled=true]:opacity-50');

    const unusedOption = getOpenSupplierItem(secondSupplierItemLabel);
    expect(unusedOption).toHaveAttribute('data-disabled', 'false');
    fireEvent.click(unusedOption);

    expect(screen.queryAllByRole('button', { name: emptySupplierLabel })).toHaveLength(0);

    fireEvent.click(screen.getAllByRole('button', { name: firstSupplierItemLabel })[0]);
    fireEvent.click(getOpenSupplierItem(emptySupplierLabel));

    const unlinkedRowPickers = screen.getAllByRole('button', { name: emptySupplierLabel });
    expect(unlinkedRowPickers).toHaveLength(1);
    fireEvent.click(unlinkedRowPickers[0]);

    expect(getOpenSupplierItem(firstSupplierItemLabel)).toHaveAttribute('data-disabled', 'false');
  });

  test('marks items already used by a draft as disabled while editing', async () => {
    const draftQuote = buildQuote({
      id: 'Q-SUPPLIER-AVAILABILITY',
      items: [
        {
          id: 'qi-linked',
          quoteId: 'Q-SUPPLIER-AVAILABILITY',
          productId: 'prod-1',
          productName: 'Solar Panel',
          quantity: 1,
          unitPrice: 80,
          supplierQuoteId: 'SQ-1',
          supplierQuoteItemId: 'sqi-1',
          supplierQuoteSupplierName: 'Acme Supplies',
          supplierQuoteUnitPrice: 60,
        },
        {
          id: 'qi-empty',
          quoteId: 'Q-SUPPLIER-AVAILABILITY',
          productId: 'prod-1',
          productName: 'Solar Panel',
          quantity: 1,
          unitPrice: 80,
        },
      ],
    });

    render(
      <ClientQuotesView
        {...baseProps}
        quotes={[draftQuote]}
        supplierQuotes={[sourceableSupplierQuote]}
      />,
    );

    fireEvent.click(screen.getByText('Q-SUPPLIER-AVAILABILITY'));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getAllByRole('button', { name: emptySupplierLabel })[0]);

    expect(getOpenSupplierItem(firstSupplierItemLabel)).toHaveAttribute('data-disabled', 'true');
    expect(getOpenSupplierItem(secondSupplierItemLabel)).toHaveAttribute('data-disabled', 'false');
  });
});
