import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Client, Product, Quote, SupplierQuote } from '../../types';
import { LineDeleteConfirmStub } from '../helpers/lineItemDeleteConfirm';
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
mock.module('../../services/api/clientQuotes', () => ({
  clientQuotesApi: {
    listVersions: () => Promise.resolve([]),
    getVersion: () => Promise.reject(new Error('not used')),
    restoreVersion: () => Promise.reject(new Error('not used')),
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

afterEach(() => {
  // Modal locks body scroll while open; reset between tests.
  document.body.style.overflow = '';
});

describe('<ClientQuotesView /> per-line quick-view links', () => {
  test('renders deep-link shortcuts to the referenced supplier quote and product', () => {
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

    render(<ClientQuotesView {...baseProps} quotes={[quote]} />);
    fireEvent.click(screen.getByText('Q-LINKED'));

    // Both responsive layouts (mobile + desktop) are in the DOM, so each shortcut
    // renders twice. They must all point at the referenced record's filtered page.
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

    // The desktop shortcut is no longer an inline column-eating button: it floats
    // above its field's top-right corner (absolute), mirroring the "manage" affordance.
    expect(supplierLinks.some((link) => link.className.includes('absolute'))).toBe(true);
    expect(productLinks.some((link) => link.className.includes('absolute'))).toBe(true);
  });

  test('hides the supplier-quote shortcut when the user cannot access that view', () => {
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

    // The supplier-quote view is permission-gated: the shortcut is hidden entirely
    // (no link AND no disabled placeholder), while the still-accessible product
    // shortcut remains active.
    expect(screen.queryAllByRole('link', { name: SUPPLIER_QUOTE_LINK })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: SUPPLIER_QUOTE_DISABLED })).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: PRODUCT_LINK }).length).toBeGreaterThan(0);
  });

  test('hides the product shortcut when the user cannot access the listing view', () => {
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

    // No internal-listing access → the product shortcut is hidden entirely.
    expect(screen.queryAllByRole('link', { name: PRODUCT_LINK })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: PRODUCT_DISABLED })).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: SUPPLIER_QUOTE_LINK }).length).toBeGreaterThan(0);
  });

  test('disables (does not hide) the product shortcut when the linked product no longer exists', () => {
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

    render(<ClientQuotesView {...baseProps} quotes={[quote]} />);
    fireEvent.click(screen.getByText('Q-STALE-PRODUCT'));

    // A stale product id (hard-deleted) would dead-end on the full listing, so the
    // shortcut renders disabled (present but non-navigating) rather than as a link;
    // the still-existing supplier-quote link stays active.
    expect(screen.queryAllByRole('link', { name: PRODUCT_LINK })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: PRODUCT_DISABLED }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: SUPPLIER_QUOTE_LINK }).length).toBeGreaterThan(0);
  });

  test('disables the supplier-quote shortcut when the linked quote no longer exists', () => {
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

    render(<ClientQuotesView {...baseProps} quotes={[quote]} />);
    fireEvent.click(screen.getByText('Q-STALE-SQ'));

    expect(screen.queryAllByRole('link', { name: SUPPLIER_QUOTE_LINK })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: SUPPLIER_QUOTE_DISABLED }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByRole('link', { name: PRODUCT_LINK }).length).toBeGreaterThan(0);
  });

  test('disables the supplier-quote shortcut when the row has no supplier quote', () => {
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

    render(<ClientQuotesView {...baseProps} quotes={[quote]} />);
    fireEvent.click(screen.getByText('Q-PRODUCT-ONLY'));

    expect(screen.queryAllByRole('link', { name: SUPPLIER_QUOTE_LINK })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: SUPPLIER_QUOTE_DISABLED }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByRole('link', { name: PRODUCT_LINK }).length).toBeGreaterThan(0);
  });

  test('renders both shortcuts disabled (not navigating) for an unreferenced row', () => {
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

    render(<ClientQuotesView {...baseProps} quotes={[quote]} />);
    fireEvent.click(screen.getByText('Q-EMPTY'));

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
