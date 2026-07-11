import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Client, ClientOffer, Product, SupplierQuote } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { LineDeleteConfirmStub } from '../../helpers/lineItemDeleteConfirm';
import { render } from '../../helpers/render';
import { rowDeleteButtons } from '../../helpers/rowDeleteButtons';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

installI18nMock({ includeInterpolatedValues: true });

mock.module('../../../components/sales/OfferVersionsPanel', () => ({
  default: () => null,
}));

// Other suites globally stub DeleteConfirmModal (Bun's mock.module is process-wide and
// last-write-wins), so pin the shared deterministic stub against this file's binding.
mock.module('../../../components/shared/DeleteConfirmModal', () => ({
  default: LineDeleteConfirmStub,
}));

const ClientOffersView = (await import('../../../components/sales/ClientOffersView')).default;

const clients: Client[] = [
  { id: 'c-1', name: 'Acme Corp' },
  { id: 'c-2', name: 'Globex Industries' },
];

const products: Product[] = [];
const supplierQuotes: SupplierQuote[] = [];

const buildOffer = (overrides: Partial<ClientOffer>): ClientOffer => ({
  id: 'O-base',
  linkedQuoteId: '',
  clientId: 'c-1',
  clientName: 'Acme Corp',
  items: [
    {
      id: 'item-1',
      offerId: overrides.id ?? 'O-base',
      productId: 'p-1',
      productName: 'Widget',
      quantity: 1,
      unitPrice: 100,
      productCost: 50,
      productMolPercentage: 50,
      unitType: 'unit',
    },
  ],
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  deliveryDate: null,
  expirationDate: '2099-12-31',
  notes: '',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

const acmeDraft = buildOffer({ id: 'O-ACME-DRAFT', clientId: 'c-1', clientName: 'Acme Corp' });
const globexSent = buildOffer({
  id: 'O-GLOBEX-SENT',
  clientId: 'c-2',
  clientName: 'Globex Industries',
  status: 'sent',
  deliveryDate: '2026-05-14',
  discount: 10,
  items: [
    {
      id: 'item-2',
      offerId: 'O-GLOBEX-SENT',
      productId: 'p-2',
      productName: 'Service',
      quantity: 2,
      unitPrice: 100,
      productCost: 60,
      productMolPercentage: 40,
      unitType: 'unit',
    },
  ],
  paymentTerms: '30gg',
});
const terminalAccepted = buildOffer({
  id: 'O-ACME-ACCEPTED',
  status: 'accepted',
});
const terminalDenied = buildOffer({
  id: 'O-ACME-DENIED',
  status: 'denied',
});

const baseProps = {
  offers: [acmeDraft, globexSent],
  clients,
  products,
  supplierQuotes,
  offerIdsWithOrders: new Set<string>(),
  onAddOffer: () => {},
  onUpdateOffer: () => {},
  onDeleteOffer: () => {},
  currency: 'EUR',
};

const tinySubtotalItem: ClientOffer['items'][number] = {
  id: 'tiny-item',
  offerId: 'O-base',
  productId: 'p-1',
  productName: 'Tiny Widget',
  quantity: 1,
  unitPrice: 0.03,
  productCost: 0,
  productMolPercentage: 0,
  unitType: 'unit',
};

afterEach(() => {
  document.body.style.overflow = '';
});

describe('<ClientOffersView /> list', () => {
  test('renders issue 461 offer-list columns in the requested order', () => {
    render(<ClientOffersView {...baseProps} />);
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers.slice(0, 11)).toEqual([
      'sales:clientOffers.offerColumn',
      'sales:clientOffers.deliveryDateColumn',
      'sales:clientOffers.clientColumn',
      'sales:clientOffers.subtotal',
      'sales:clientOffers.discountPercentColumn',
      'common:labels.discount',
      'sales:clientOffers.discountedTotalColumn',
      'sales:clientOffers.margin',
      'sales:clientOffers.molColumn',
      'sales:clientOffers.paymentTermsColumn',
      'sales:clientOffers.statusColumn',
    ]);
  });

  test('renders delivery date, MOL, and payment terms in offer rows', () => {
    render(<ClientOffersView {...baseProps} />);
    expect(screen.getByText('5/14/2026')).toBeInTheDocument();
    // MOL column shows the margin percentage with two decimals (issue #780).
    expect(screen.getByText('33,33%')).toBeInTheDocument();
    expect(screen.getByText('crm:paymentTerms.30gg')).toBeInTheDocument();
  });

  test('scales offer-row totals by a line item duration (issue #757)', () => {
    const durationOffer = buildOffer({
      id: 'O-DURATION',
      items: [
        {
          id: 'dur-item',
          offerId: 'O-DURATION',
          productId: 'p-1',
          productName: 'Service',
          quantity: 2,
          unitPrice: 100,
          productCost: 60,
          productMolPercentage: 40,
          // Duration applies only to non-unit lines (hours/days), so this fixture is hours-based.
          unitType: 'hours',
          durationMonths: 3,
        },
      ],
    });
    render(<ClientOffersView {...baseProps} offers={[durationOffer]} />);
    // Subtotal (revenue) = 100 × 2 × 3 = 600 (would be 200 without duration).
    expect(screen.getAllByText('600,00 EUR').length).toBeGreaterThan(0);
    // Margin = 600 − (60 × 2 × 3 = 360) = 240, which only holds when both scale by duration.
    expect(screen.getAllByText('240,00 EUR').length).toBeGreaterThan(0);
  });

  test('a years duration prices off the canonical months, matching the months equivalent (issue #757)', () => {
    // durationUnit is display-only; pricing always uses the canonical durationMonths (24). So
    // "2 years" (24 months) must total the same as a 24-month line.
    const yearsOffer = buildOffer({
      id: 'O-YEARS',
      items: [
        {
          id: 'years-item',
          offerId: 'O-YEARS',
          productId: 'p-1',
          productName: 'Service',
          quantity: 2,
          unitPrice: 100,
          productCost: 60,
          productMolPercentage: 40,
          // Duration applies only to non-unit lines (hours/days), so this fixture is hours-based.
          unitType: 'hours',
          durationMonths: 24,
          durationUnit: 'years',
        },
      ],
    });
    render(<ClientOffersView {...baseProps} offers={[yearsOffer]} />);
    // Subtotal (revenue) = 100 × 2 × 24 = 4800.
    expect(screen.getAllByText('4.800,00 EUR').length).toBeGreaterThan(0);
    // Margin = 4800 − (60 × 2 × 24 = 2880) = 1920.
    expect(screen.getAllByText('1.920,00 EUR').length).toBeGreaterThan(0);
  });

  test('renders fixed discounts as equivalent percentages in offer rows', () => {
    const fixedDiscountOffer = buildOffer({
      id: 'O-FIXED-DISCOUNT',
      discount: 15,
      discountType: 'currency',
    });

    render(<ClientOffersView {...baseProps} offers={[fixedDiscountOffer]} />);

    expect(screen.getByText('15%')).toBeInTheDocument();
    expect(screen.queryByText('15 EUR')).not.toBeInTheDocument();
    expect(screen.getByText('-15,00 EUR')).toBeInTheDocument();
  });

  test('sorts the global discount column by equivalent percentage', async () => {
    const user = userEvent.setup();
    const percentageDiscountOffer = buildOffer({
      id: 'O-PERCENT-10',
      discount: 10,
      discountType: 'percentage',
    });
    const fixedDiscountOffer = buildOffer({
      id: 'O-FIXED-5',
      discount: 10,
      discountType: 'currency',
      items: [
        {
          id: 'item-fixed',
          offerId: 'O-FIXED-5',
          productId: 'p-fixed',
          productName: 'Fixed discount service',
          quantity: 2,
          unitPrice: 100,
          productCost: 60,
          productMolPercentage: 40,
          unitType: 'unit',
        },
      ],
    });
    const zeroDiscountOffer = buildOffer({
      id: 'O-ZERO',
      discount: 0,
      discountType: 'percentage',
    });

    render(
      <ClientOffersView
        {...baseProps}
        offers={[zeroDiscountOffer, fixedDiscountOffer, percentageDiscountOffer]}
      />,
    );

    const sortButton = screen.getByRole('button', {
      name: 'sales:clientOffers.discountPercentColumn',
    });
    expect(sortButton).toBeEnabled();
    await user.click(sortButton);

    await waitFor(() => {
      const rows = screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent ?? '');
      expect(rows[0]).toContain('O-PERCENT-10');
      expect(rows[1]).toContain('O-FIXED-5');
      expect(rows[2]).toContain('O-ZERO');
    });
  });

  test('renders every offer passed in (no external search/status filter)', () => {
    render(<ClientOffersView {...baseProps} />);
    expect(screen.getByText('O-ACME-DRAFT')).toBeInTheDocument();
    expect(screen.getByText('O-GLOBEX-SENT')).toBeInTheDocument();
  });

  test('does not render the external search input or status filter', () => {
    render(<ClientOffersView {...baseProps} />);
    expect(
      screen.queryByPlaceholderText('sales:clientOffers.searchPlaceholder'),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('sales:clientOffers.filterByStatus')).not.toBeInTheDocument();
  });

  test('column status filter shows localized labels, not raw status keys', () => {
    render(<ClientOffersView {...baseProps} />);
    const statusFilterTrigger = screen.getByLabelText(
      `table.filters sales:clientOffers.statusColumn`,
    );
    fireEvent.click(statusFilterTrigger);
    expect(screen.getByText('sales:clientOffers.statusDraft')).toBeInTheDocument();
    expect(screen.getByText('sales:clientOffers.statusSent')).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'sent' })).not.toBeInTheDocument();
  });
});

describe('<ClientOffersView /> terminal status revert action', () => {
  test('hides terminal revert when caller is not privileged', () => {
    render(<ClientOffersView {...baseProps} offers={[terminalAccepted, terminalDenied]} />);

    expect(
      screen.queryByRole('button', { name: 'sales:clientOffers.revertToDraft' }),
    ).not.toBeInTheDocument();
  });

  test('hides terminal revert for accepted offers that already have a linked order', () => {
    render(
      <ClientOffersView
        {...baseProps}
        offers={[terminalAccepted]}
        offerIdsWithOrders={new Set([terminalAccepted.id])}
        canRevertTerminalStatus
        onRevertOfferToDraft={() => {}}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'sales:clientOffers.revertToDraft' }),
    ).not.toBeInTheDocument();
  });

  test('confirms terminal revert with an optional audit reason', async () => {
    const user = userEvent.setup();
    const onRevertOfferToDraft = mock(() => Promise.resolve());
    render(
      <ClientOffersView
        {...baseProps}
        offers={[terminalAccepted]}
        canRevertTerminalStatus
        onRevertOfferToDraft={onRevertOfferToDraft}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));
    await user.click(await screen.findByTestId('client-offer-revert-O-ACME-ACCEPTED'));
    await user.type(screen.getByLabelText('sales:clientOffers.revertReasonLabel'), 'wrong status');
    await user.click(
      screen.getByRole('button', { name: 'sales:clientOffers.confirmRevertToDraft' }),
    );

    await waitFor(() =>
      expect(onRevertOfferToDraft).toHaveBeenCalledWith('O-ACME-ACCEPTED', 'wrong status'),
    );
  });
});

describe('<ClientOffersView /> sent status revert action', () => {
  test('reverts a valid sent offer to draft through the normal update callback', async () => {
    const user = userEvent.setup();
    const onUpdateOffer = mock(() => Promise.resolve());
    render(<ClientOffersView {...baseProps} offers={[globexSent]} onUpdateOffer={onUpdateOffer} />);

    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));
    await user.click(
      await screen.findByRole('button', { name: 'sales:clientOffers.revertToDraft' }),
    );

    await waitFor(() =>
      expect(onUpdateOffer).toHaveBeenCalledWith('O-GLOBEX-SENT', { status: 'draft' }),
    );
  });
});

describe('<ClientOffersView /> discount summary', () => {
  test('labels a fixed global discount with the equivalent percentage', () => {
    const fixedDiscountOffer = buildOffer({
      id: 'O-FIXED-DISCOUNT',
      discount: 15,
      discountType: 'currency',
    });

    render(<ClientOffersView {...baseProps} offers={[fixedDiscountOffer]} />);

    fireEvent.click(screen.getByText('O-FIXED-DISCOUNT'));

    expect(screen.getByText('sales:clientOffers.editOffer')).toBeInTheDocument();
    expect(screen.getByText('sales:clientOffers.discountAmount (15%)')).toBeInTheDocument();
    expect(screen.getAllByText('-15,00 EUR').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('sales:clientOffers.discountAmount (15 EUR)'),
    ).not.toBeInTheDocument();
  });

  test('keeps the entered percentage label when the rounded discount amount differs', () => {
    const percentageDiscountOffer = buildOffer({
      id: 'O-PERCENT-DISCOUNT',
      discount: 50,
      discountType: 'percentage',
      items: [tinySubtotalItem],
    });

    render(<ClientOffersView {...baseProps} offers={[percentageDiscountOffer]} />);

    fireEvent.click(screen.getByText('O-PERCENT-DISCOUNT'));

    expect(screen.getByText('sales:clientOffers.discountAmount (50%)')).toBeInTheDocument();
    expect(
      screen.queryByText('sales:clientOffers.discountAmount (66,67%)'),
    ).not.toBeInTheDocument();
  });
});

describe('<ClientOffersView /> source-quote banner', () => {
  test('shows the source quote with a primary "view quote" action for a linked offer', async () => {
    const user = userEvent.setup();
    const onViewQuote = mock(() => {});
    const linkedOffer = buildOffer({ id: 'O-LINKED', linkedQuoteId: 'Q0001' });

    render(<ClientOffersView {...baseProps} offers={[linkedOffer]} onViewQuote={onViewQuote} />);

    // Clicking the row opens the edit dialog that hosts the source-quote banner.
    fireEvent.click(screen.getByText('O-LINKED'));

    expect(screen.getByText('sales:clientOffers.sourceQuote')).toBeInTheDocument();
    expect(screen.getByText('Q0001')).toBeInTheDocument();

    // The "view quote" control must now be a primary shadcn button (data-variant
    // "default"), not the old text link (variant="link").
    const viewButton = screen.getByRole('button', { name: 'sales:clientOffers.viewQuote' });
    expect(viewButton.getAttribute('data-variant')).toBe('default');
    expect(viewButton.getAttribute('data-variant')).not.toBe('link');

    await user.click(viewButton);
    expect(onViewQuote).toHaveBeenCalledWith('Q0001');
  });
});

describe('<ClientOffersView /> quick-view shortcuts', () => {
  const linkedProducts: Product[] = [
    {
      id: 'prod-off',
      name: 'Solar Panel',
      productCode: 'SP-100',
      costo: 50,
      molPercentage: 20,
      costUnit: 'unit',
      type: 'supply',
    },
  ];
  const linkedSupplierQuote: SupplierQuote = {
    id: 'SQ-OFF',
    supplierId: 'sup-1',
    supplierName: 'Acme Supplies',
    items: [
      {
        id: 'sqi-off',
        quoteId: 'SQ-OFF',
        productId: 'prod-off',
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
  const linkedOffer = buildOffer({
    id: 'O-SHORTCUT',
    items: [
      {
        id: 'item-link',
        offerId: 'O-SHORTCUT',
        productId: 'prod-off',
        productName: 'Solar Panel',
        quantity: 1,
        unitPrice: 100,
        productCost: 60,
        productMolPercentage: 40,
        unitType: 'unit',
        supplierQuoteId: 'SQ-OFF',
        supplierQuoteItemId: 'sqi-off',
      },
    ],
  });

  test('opens the referenced supplier quote and product on their pre-filtered pages', () => {
    render(
      <ClientOffersView
        {...baseProps}
        offers={[linkedOffer]}
        products={linkedProducts}
        supplierQuotes={[linkedSupplierQuote]}
      />,
    );
    // Clicking the row opens the edit dialog that hosts the line-item shortcuts.
    fireEvent.click(screen.getByText('O-SHORTCUT'));

    const supplierLinks = screen.getAllByRole('link', {
      name: 'sales:clientQuotes.openSupplierQuoteInNewTab',
    });
    expect(supplierLinks.length).toBeGreaterThan(0);
    for (const link of supplierLinks) {
      expect(link).toHaveAttribute('href', '#/sales/supplier-quotes?filterId=SQ-OFF');
      expect(link).toHaveAttribute('target', '_blank');
    }

    const productLinks = screen.getAllByRole('link', {
      name: 'sales:clientQuotes.openProductInNewTab',
    });
    expect(productLinks.length).toBeGreaterThan(0);
    for (const link of productLinks) {
      expect(link).toHaveAttribute('href', '#/catalog/internal-listing?filterId=prod-off');
      expect(link).toHaveAttribute('target', '_blank');
    }

    // The desktop grid floats its shortcut above the field (the `floating` variant);
    // both selectors render so at least one of each is the absolute-positioned copy.
    expect(supplierLinks.some((link) => link.className.includes('absolute'))).toBe(true);
    expect(productLinks.some((link) => link.className.includes('absolute'))).toBe(true);
  });

  test('hides each shortcut when the user cannot access the referenced view', () => {
    render(
      <ClientOffersView
        {...baseProps}
        offers={[linkedOffer]}
        products={linkedProducts}
        supplierQuotes={[linkedSupplierQuote]}
        canViewSupplierQuotes={false}
        canViewInternalListing={false}
      />,
    );
    fireEvent.click(screen.getByText('O-SHORTCUT'));

    // No access → hidden entirely (no active link and no disabled placeholder).
    expect(
      screen.queryAllByRole('link', { name: 'sales:clientQuotes.openSupplierQuoteInNewTab' }),
    ).toHaveLength(0);
    expect(
      screen.queryAllByRole('link', { name: 'sales:clientQuotes.openProductInNewTab' }),
    ).toHaveLength(0);
    expect(
      screen.queryAllByRole('button', {
        name: 'sales:clientQuotes.supplierQuoteShortcutUnavailable',
      }),
    ).toHaveLength(0);
    expect(
      screen.queryAllByRole('button', { name: 'sales:clientQuotes.productShortcutUnavailable' }),
    ).toHaveLength(0);
  });

  test('keeps the shortcut visible but disabled when the line references nothing', () => {
    // Base offer line: productId 'p-1' (not in the empty products list) and no
    // supplier-quote link → both shortcuts render disabled, never as active links.
    render(<ClientOffersView {...baseProps} offers={[acmeDraft]} />);
    fireEvent.click(screen.getByText('O-ACME-DRAFT'));

    expect(
      screen.queryAllByRole('link', { name: 'sales:clientQuotes.openProductInNewTab' }),
    ).toHaveLength(0);
    expect(
      screen.getAllByRole('button', { name: 'sales:clientQuotes.productShortcutUnavailable' })
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('button', {
        name: 'sales:clientQuotes.supplierQuoteShortcutUnavailable',
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe('<ClientOffersView /> dark-mode banners (issue #768)', () => {
  test('dialog warning banners avoid light-only amber classes', async () => {
    const source = await readComponentSource('sales/ClientOffersView.tsx');
    // Read-only + version-preview banners use translucent amber plus an explicit dark-mode
    // text color, matching the dark-mode-compatible accounting orders banners.
    expectSourceContainsAll(source, [
      'border border-amber-500/30 bg-amber-500/10',
      'dark:text-amber-300',
    ]);
    // The old light-only banner backgrounds (a pale cream slab on the dark dialog) are gone.
    expectSourceOmitsAll(source, [
      'border border-amber-200 bg-amber-50',
      'border border-amber-300 bg-amber-50',
    ]);
  });
});

describe('<ClientOffersView /> supplier-quote item labels', () => {
  test('an existing line keeps its label when the accepted supplier quote is past-dated', () => {
    // The picker hides past-dated accepted quotes from NEW sourcing (intentional, #154), but an
    // existing line's display label must resolve across ALL supplier quotes — the link is intact
    // and the server-side sourcing gate still accepts the item.
    const pastDatedAccepted: SupplierQuote = {
      id: 'SQ-OLD',
      supplierId: 'sup-1',
      supplierName: 'Acme Supplies',
      items: [
        {
          id: 'sqi-old',
          quoteId: 'SQ-OLD',
          productId: 'p-1',
          productName: 'Widget',
          quantity: 1,
          listPrice: 60,
          discountPercent: 0,
          unitPrice: 60,
          unitType: 'unit',
        },
      ],
      paymentTerms: 'immediate',
      status: 'accepted',
      expirationDate: '2000-01-01',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    const offer = buildOffer({
      id: 'O-OLD-SOURCE',
      items: [
        {
          id: 'item-old',
          offerId: 'O-OLD-SOURCE',
          productId: 'p-1',
          productName: 'Widget',
          quantity: 1,
          unitPrice: 100,
          productCost: 50,
          productMolPercentage: 50,
          unitType: 'unit',
          supplierQuoteId: 'SQ-OLD',
          supplierQuoteItemId: 'sqi-old',
        },
      ],
    });

    render(
      <ClientOffersView {...baseProps} offers={[offer]} supplierQuotes={[pastDatedAccepted]} />,
    );
    fireEvent.click(screen.getByText('O-OLD-SOURCE'));

    expect(screen.getAllByText('Acme Supplies · Widget (60,00)').length).toBeGreaterThan(0);
  });
});

describe('<ClientOffersView /> supplier-data sync affordances (#779)', () => {
  test('shows the stale-data button and pulls the latest supplier values on click', async () => {
    const supplierQuote: SupplierQuote = {
      id: 'SQ-LIVE',
      supplierId: 'sup-1',
      supplierName: 'Acme Supplies',
      items: [
        {
          id: 'sqi-live',
          quoteId: 'SQ-LIVE',
          productId: 'p-1',
          productName: 'Widget',
          // Current supplier values differ from the line's snapshot below → stale.
          quantity: 4,
          listPrice: 80,
          discountPercent: 0,
          unitPrice: 80,
          unitType: 'hours',
        },
      ],
      paymentTerms: 'immediate',
      status: 'draft',
      expirationDate: '2999-12-31',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    const staleOffer = buildOffer({
      id: 'O-STALE',
      items: [
        {
          id: 'item-stale',
          offerId: 'O-STALE',
          productId: 'p-1',
          productName: 'Widget',
          quantity: 2,
          unitPrice: 100,
          productCost: 60,
          productMolPercentage: null,
          unitType: 'hours',
          supplierQuoteId: 'SQ-LIVE',
          supplierQuoteItemId: 'sqi-live',
          supplierQuoteUnitPrice: 60,
        },
      ],
    });

    render(
      <ClientOffersView {...baseProps} offers={[staleOffer]} supplierQuotes={[supplierQuote]} />,
    );
    fireEvent.click(screen.getByText('O-STALE'));

    // Rendered once per layout (mobile + desktop) — both share the same line state.
    const refreshButtons = await screen.findAllByRole('button', {
      name: 'sales:clientQuotes.staleSupplierData',
    });
    expect(refreshButtons.length).toBeGreaterThan(0);
    fireEvent.click(refreshButtons[0]);

    // Quantity + cost pulled from the supplier item; the affordance disappears once in sync.
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'sales:clientQuotes.staleSupplierData' }),
      ).toBeNull();
    });
  });
});

describe('<ClientOffersView /> MOL precision (issue #780)', () => {
  test('MOL line input keeps two decimals instead of rounding to one', async () => {
    const twoDecimalMolOffer = buildOffer({
      id: 'O-MOL',
      items: [
        {
          id: 'item-mol',
          offerId: 'O-MOL',
          productId: 'p-1',
          productName: 'Widget',
          quantity: 1,
          unitPrice: 100,
          productCost: 50,
          productMolPercentage: 12.34,
          unitType: 'unit',
        },
      ],
    });

    render(<ClientOffersView {...baseProps} offers={[twoDecimalMolOffer]} />);
    fireEvent.click(screen.getByText('O-MOL'));
    await screen.findByRole('dialog');

    // formatDecimals={2}: the MOL inputs (mobile + desktop layouts) show 12,34, not the
    // pre-fix rounded 12,3 that silently dropped the second decimal.
    expect(screen.queryAllByDisplayValue('12,34').length).toBeGreaterThan(0);
    expect(screen.queryAllByDisplayValue('12,3')).toHaveLength(0);
  });
});

describe('<ClientOffersView /> line discounts', () => {
  test('defaults added lines to 0% and includes zero in the payload', async () => {
    const onUpdateOffer = mock((_id: string, _updates: Partial<ClientOffer>) => Promise.resolve());
    render(<ClientOffersView {...baseProps} offers={[acmeDraft]} onUpdateOffer={onUpdateOffer} />);

    fireEvent.click(screen.getByText('O-ACME-DRAFT'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'sales:clientOffers.addItem' }));

    const lineDiscountInputs = within(dialog)
      .getAllByRole('textbox', { name: 'common:labels.discount' })
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
    expect(lineDiscountInputs.length).toBeGreaterThan(1);
    expect(lineDiscountInputs.every((input) => input.value === '0,00')).toBe(true);

    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.update' }));
    await waitFor(() => expect(onUpdateOffer).toHaveBeenCalledTimes(1));
    expect(onUpdateOffer.mock.calls[0][1].items?.map((item) => item.discount)).toEqual([0, 0]);
  });

  test('edits a supplier-linked line discount, shows net values, and submits it', async () => {
    const onUpdateOffer = mock((_id: string, _updates: Partial<ClientOffer>) => Promise.resolve());
    const supplierLinkedOffer = buildOffer({
      id: 'O-SUPPLIER-LINE-DISCOUNT',
      items: [
        {
          ...acmeDraft.items[0],
          offerId: 'O-SUPPLIER-LINE-DISCOUNT',
          supplierQuoteId: 'SQ-1',
          supplierQuoteItemId: 'SQI-1',
          supplierQuoteUnitPrice: 50,
        },
      ],
    });
    render(
      <ClientOffersView
        {...baseProps}
        offers={[supplierLinkedOffer]}
        onUpdateOffer={onUpdateOffer}
      />,
    );

    fireEvent.click(screen.getByText('O-SUPPLIER-LINE-DISCOUNT'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('common:labels.discount').length).toBeGreaterThan(0);

    const lineDiscountInputs = within(dialog)
      .getAllByRole('textbox', { name: 'common:labels.discount' })
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
    expect(lineDiscountInputs.length).toBeGreaterThan(0);
    fireEvent.change(lineDiscountInputs[0], { target: { value: '150' } });
    expect(lineDiscountInputs[0]).toHaveValue('100,00');
    fireEvent.change(lineDiscountInputs[0], { target: { value: '10' } });
    expect(within(dialog).getAllByText('90,00 EUR').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('40,00 EUR').length).toBeGreaterThan(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.update' }));
    await waitFor(() => expect(onUpdateOffer).toHaveBeenCalledTimes(1));
    expect(onUpdateOffer.mock.calls[0][1].items?.[0].discount).toBe(10);
  });

  test('keeps the line discount visible but disabled on terminal offers', async () => {
    render(<ClientOffersView {...baseProps} offers={[terminalAccepted]} />);
    fireEvent.click(screen.getByText('O-ACME-ACCEPTED'));
    const dialog = await screen.findByRole('dialog');

    const lineDiscountInputs = within(dialog)
      .getAllByRole('textbox', { name: 'common:labels.discount' })
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
    expect(lineDiscountInputs.length).toBeGreaterThan(0);
    expect(lineDiscountInputs.every((input) => input.disabled)).toBe(true);
  });
});

describe('<ClientOffersView /> line-item delete confirmation', () => {
  const openEditor = async () => {
    render(<ClientOffersView {...baseProps} offers={[acmeDraft]} />);
    fireEvent.click(screen.getByText('O-ACME-DRAFT'));
    return screen.findByRole('dialog');
  };

  test('confirms before removing a product line and removes it only after confirming', async () => {
    const dialog = await openEditor();
    const rowDeletes = rowDeleteButtons(dialog);
    expect(rowDeletes.length).toBeGreaterThan(0);

    fireEvent.click(rowDeletes[0]);
    const confirmUi = await screen.findByTestId('line-delete-confirm');
    expect(within(confirmUi).getByTestId('line-delete-title')).toHaveTextContent(
      'sales:clientOffers.removeProductTitle',
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

    fireEvent.click(rowDeletes[0]);
    fireEvent.click(await screen.findByTestId('line-delete-cancel'));

    await waitFor(() => {
      expect(screen.queryByTestId('line-delete-confirm')).not.toBeInTheDocument();
    });
    expect(rowDeleteButtons(dialog)).toHaveLength(rowDeletes.length);
  });
});

describe('<ClientOffersView /> expired-offer handling (issue #779)', () => {
  const expiredOffer = (over: Partial<ClientOffer> = {}): ClientOffer =>
    buildOffer({
      id: 'O-EXPIRED',
      status: 'sent',
      // The server marks an expired offer via effectiveStatus; the view trusts it (it
      // short-circuits the date math) so the row/modal go into the expired
      // read-only-except-date mode. The default prefilled date is FUTURE so the extend-submit
      // passes its past-date validation.
      effectiveStatus: 'expired',
      expirationDate: '2999-12-31',
      ...over,
    });

  test('the status badge renders the translated expired label', () => {
    render(
      <ClientOffersView
        {...baseProps}
        offers={[buildOffer({ id: 'O-PAST', status: 'sent', expirationDate: '2000-01-01' })]}
      />,
    );
    // No effectiveStatus on the fixture → exercises the shared-model fallback derivation too.
    expect(screen.getAllByText('sales:clientOffers.statusExpired').length).toBeGreaterThan(0);
  });

  test('status action buttons are disabled on an expired sent offer', async () => {
    // Row actions live behind the StandardTable overflow menu ("table.rowActions").
    const user = userEvent.setup();
    const onUpdateOffer = mock(() => Promise.resolve());
    render(
      <ClientOffersView
        {...baseProps}
        offers={[buildOffer({ id: 'O-PAST', status: 'sent', expirationDate: '2000-01-01' })]}
        onUpdateOffer={onUpdateOffer}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));

    // Scaduto freezes transitions; the server would 409 — the UI must not offer a dead end.
    const acceptIcon = document.querySelector('.fa-check');
    expect(acceptIcon).not.toBeNull();
    expect(acceptIcon?.closest('button')).toBeDisabled();
    const denyIcon = document.querySelector('.fa-xmark');
    expect(denyIcon).not.toBeNull();
    expect(denyIcon?.closest('button')).toBeDisabled();
    const revertButton = screen.getByRole('button', {
      name: 'sales:clientOffers.revertToDraft',
    });
    expect(revertButton).toBeDisabled();
    await user.click(revertButton);
    expect(onUpdateOffer).not.toHaveBeenCalled();
  });

  test('submitting an expired offer extends ONLY the expiration date', async () => {
    const onUpdateOffer = mock((_id: string, _updates: Partial<ClientOffer>) => Promise.resolve());
    render(
      <ClientOffersView {...baseProps} offers={[expiredOffer()]} onUpdateOffer={onUpdateOffer} />,
    );

    // Expired rows stay openable — the modal is where the expiration gets extended (#779).
    fireEvent.click(screen.getByText('O-EXPIRED'));
    const submit = await screen.findByRole('button', { name: 'common:buttons.update' });
    expect(submit).toBeEnabled();
    const form = submit.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => expect(onUpdateOffer).toHaveBeenCalledTimes(1));
    const [id, payload] = onUpdateOffer.mock.calls[0];
    expect(id).toBe('O-EXPIRED');
    // Only the expiration date is sent — the form is otherwise read-only and the server
    // rejects content edits on an expired offer.
    expect(Object.keys(payload as object)).toEqual(['expirationDate']);
  });

  test('submitting with a still-past expiration date is rejected client-side', async () => {
    const onUpdateOffer = mock((_id: string, _updates: Partial<ClientOffer>) => Promise.resolve());
    render(
      <ClientOffersView
        {...baseProps}
        offers={[expiredOffer({ expirationDate: '2000-01-01' })]}
        onUpdateOffer={onUpdateOffer}
      />,
    );

    fireEvent.click(screen.getByText('O-EXPIRED'));
    const submit = await screen.findByRole('button', { name: 'common:buttons.update' });
    const form = submit.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    // The still-past date cannot revalidate the offer — rejected with a toast, no API call.
    expect(onUpdateOffer).not.toHaveBeenCalled();
  });

  test('the delete action is disabled on an expired draft offer', async () => {
    const user = userEvent.setup();
    render(
      <ClientOffersView
        {...baseProps}
        offers={[buildOffer({ id: 'O-PAST', status: 'draft', expirationDate: '2000-01-01' })]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));

    // Mirrors the quotes view: expired documents cannot be deleted, only revalidated.
    const trashIcon = document.querySelector('.fa-trash-can');
    expect(trashIcon).not.toBeNull();
    expect(trashIcon?.closest('button')).toBeDisabled();
  });

  test('the status filter offers an Expired option that isolates expired rows', async () => {
    const user = userEvent.setup();
    render(
      <ClientOffersView
        {...baseProps}
        offers={[
          buildOffer({ id: 'O-PAST', status: 'sent', expirationDate: '2000-01-01' }),
          buildOffer({ id: 'O-VALID', status: 'sent', expirationDate: '2999-12-31' }),
        ]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'table.filters sales:clientOffers.statusColumn' }),
    );
    // The filter is built from the DERIVED status, so expired rows get their own option
    // instead of hiding under the stored Sent value (#779).
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'sales:clientOffers.statusExpired' }),
    );

    expect(screen.getByText('O-PAST')).toBeInTheDocument();
    expect(screen.queryByText('O-VALID')).toBeNull();
  });

  test('a valid sent offer stays fully read-only — no submit button, date field disabled', async () => {
    render(
      <ClientOffersView
        {...baseProps}
        offers={[buildOffer({ id: 'O-SENT', status: 'sent', expirationDate: '2999-12-31' })]}
      />,
    );

    fireEvent.click(screen.getByText('O-SENT'));
    await screen.findByRole('button', { name: 'common:buttons.cancel' });
    // The extend-only submit path is for EXPIRED offers; exposing it on valid sent offers let a
    // no-op "Update" click write needless version snapshots and audit rows.
    expect(screen.queryByRole('button', { name: 'common:buttons.update' })).toBeNull();
    expect(document.getElementById('client-offer-expiration-date')).toBeDisabled();
  });
});
