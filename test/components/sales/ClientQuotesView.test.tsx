import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../services/api/client';
import type { Client, Quote, SupplierQuote } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { LineDeleteConfirmStub } from '../../helpers/lineItemDeleteConfirm';
import { render } from '../../helpers/render';
import { rowDeleteButtons } from '../../helpers/rowDeleteButtons';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

installI18nMock();

const viewsListMock = mock(async () => []);
const viewsCreateMock = mock(async () => {
  throw new Error('not used');
});
const viewsUpdateMock = mock(async () => {
  throw new Error('not used');
});
const viewsRemoveMock = mock(async () => {});
const viewsDirectoryMock = mock(async () => []);
const viewsGetSharesMock = mock(async () => []);
const viewsReplaceSharesMock = mock(async () => []);
const toastErrorMock = mock((_message: string) => {});
const toastSuccessMock = mock((_message: string) => {});

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

mock.module('../../../services/api/views', () => ({
  viewsApi: {
    list: viewsListMock,
    create: viewsCreateMock,
    update: viewsUpdateMock,
    remove: viewsRemoveMock,
    directory: viewsDirectoryMock,
    getShares: viewsGetSharesMock,
    replaceShares: viewsReplaceSharesMock,
  },
}));

// Other suites globally stub DeleteConfirmModal (Bun's mock.module is process-wide and
// last-write-wins), so pin the shared deterministic stub against this file's binding.
mock.module('../../../components/shared/DeleteConfirmModal', () => ({
  default: LineDeleteConfirmStub,
}));

mock.module('../../../utils/toast', () => ({
  toastError: toastErrorMock,
  toastSuccess: toastSuccessMock,
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    info: () => {},
    warning: () => {},
    message: () => {},
  },
}));

const ClientQuotesView = (await import('../../../components/sales/ClientQuotesView')).default;

const clients: Client[] = [{ id: 'client-1', name: 'Helios Energy Services' }];
const STABLE_FUTURE_EXPIRATION_DATE = '2099-06-30';
const communicationChannels = [
  {
    id: 'qcc_email',
    name: 'Email',
    clientQuoteCount: 0,
    supplierQuoteCount: 0,
    totalQuoteCount: 0,
  },
];

const quotes: Quote[] = [
  {
    id: 'Q-001',
    clientId: 'client-1',
    clientName: 'Helios Energy Services',
    items: [
      {
        id: 'item-1',
        quoteId: 'Q-001',
        productId: 'product-1',
        productName: 'Consulting',
        quantity: 2,
        unitPrice: 100,
        productCost: 60,
        productMolPercentage: 40,
      },
    ],
    paymentTerms: '30gg',
    communicationChannelId: 'qcc_email',
    communicationChannelName: 'Email',
    discount: 10,
    discountType: 'percentage',
    status: 'draft',
    expirationDate: STABLE_FUTURE_EXPIRATION_DATE,
    createdAt: Date.UTC(2026, 4, 14),
    updatedAt: Date.UTC(2026, 4, 14),
  },
  {
    id: 'Q-002',
    clientId: 'client-1',
    clientName: 'Helios Energy Services',
    items: [
      {
        id: 'item-2',
        quoteId: 'Q-002',
        productId: 'product-1',
        productName: 'Consulting',
        quantity: 2,
        unitPrice: 100,
        productCost: 60,
        productMolPercentage: 40,
      },
    ],
    paymentTerms: '30gg',
    communicationChannelId: 'qcc_email',
    communicationChannelName: 'Email',
    discount: 25,
    discountType: 'currency',
    status: 'draft',
    expirationDate: STABLE_FUTURE_EXPIRATION_DATE,
    createdAt: Date.UTC(2026, 4, 14),
    updatedAt: Date.UTC(2026, 4, 14),
  },
];

beforeEach(() => {
  localStorage.clear();
  viewsListMock.mockClear();
  viewsCreateMock.mockClear();
  viewsUpdateMock.mockClear();
  viewsRemoveMock.mockClear();
  viewsDirectoryMock.mockClear();
  viewsGetSharesMock.mockClear();
  viewsReplaceSharesMock.mockClear();
  toastErrorMock.mockClear();
  toastSuccessMock.mockClear();
  viewsListMock.mockImplementation(async () => []);
  viewsDirectoryMock.mockImplementation(async () => []);
  viewsGetSharesMock.mockImplementation(async () => []);
  viewsReplaceSharesMock.mockImplementation(async () => []);
});

afterEach(() => {
  document.body.style.overflow = '';
  document.body.style.pointerEvents = '';
  document.body.removeAttribute('data-scroll-locked');
});

const waitForSavedViewsLoad = async () => {
  await waitFor(() => expect(viewsListMock).toHaveBeenCalled());
};

describe('<ClientQuotesView />', () => {
  test('renders the quote list columns in the requested order with MOL next to margin', () => {
    const { container } = render(
      <ClientQuotesView
        quotes={quotes}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    const headerLabels = Array.from(container.querySelectorAll('[data-column-header-label]')).map(
      (header) => header.textContent?.trim(),
    );

    expect(headerLabels).toEqual([
      'sales:clientQuotes.quoteCodeColumn',
      'crm:clients.tableHeaders.insertDate',
      'sales:clientQuotes.clientColumn',
      'sales:clientQuotes.subtotal',
      'sales:clientQuotes.discountPercentColumn',
      'common:labels.discount',
      'sales:clientQuotes.discountedTotalColumn',
      'sales:clientQuotes.marginLabel',
      'sales:clientQuotes.molLabel',
      'sales:clientQuotes.paymentTermsColumn',
      'sales:communicationChannels.fieldLabel',
      'sales:clientQuotes.expirationColumn',
      'sales:clientQuotes.statusColumn',
      'sales:clientQuotes.actionsColumn',
    ]);
    expect(screen.getAllByText('Email').length).toBeGreaterThan(0);
    // MOL column shows the margin percentage with two decimals (issue #780).
    expect(screen.getByText('33,33%')).toBeInTheDocument();
    expect(screen.getByText('12,5%')).toBeInTheDocument();
  });

  test('formats a fractional percentage discount with a comma', () => {
    render(
      <ClientQuotesView
        quotes={[{ ...quotes[0], id: 'Q-DECIMAL', discount: 10.5 }]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    expect(screen.getByText('10,5%')).toBeInTheDocument();
    expect(screen.queryByText('10.5%')).not.toBeInTheDocument();
  });

  test('exposes a Durata column and per-row duration input in the create dialog (issue #757)', () => {
    render(
      <ClientQuotesView
        quotes={[]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'sales:clientQuotes.createNewQuote' }));
    fireEvent.click(screen.getByText('sales:clientQuotes.addProduct'));

    // The Durata column header renders once a line item exists...
    expect(screen.getAllByText('sales:clientQuotes.durationColumn').length).toBeGreaterThan(0);
    // ...and the row carries a duration input defaulting to 1 month (one-off).
    const durationInputs = screen
      .getAllByPlaceholderText('sales:clientQuotes.durationColumn')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs[0].value).toBe('1');
  });

  test('edits a per-line discount and submits net revenue and margin', async () => {
    const onUpdateQuote = mock((_id: string, _updates: Partial<Quote>) => Promise.resolve());
    const quote = {
      ...quotes[0],
      id: 'Q-LINE-DISCOUNT',
      discount: 0,
      items: [
        {
          ...quotes[0].items[0],
          quoteId: 'Q-LINE-DISCOUNT',
          supplierQuoteId: 'SQ-1',
          supplierQuoteItemId: 'SQI-1',
          supplierQuoteUnitPrice: 60,
          discount: 0,
        },
      ],
    };

    render(
      <ClientQuotesView
        quotes={[quote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        communicationChannels={communicationChannels}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={onUpdateQuote}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByText('Q-LINE-DISCOUNT'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('common:labels.discount').length).toBeGreaterThan(0);

    const lineDiscountInputs = within(dialog)
      .getAllByRole('textbox', { name: 'common:labels.discount' })
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
    expect(lineDiscountInputs.length).toBeGreaterThan(0);
    fireEvent.change(lineDiscountInputs[0], { target: { value: '150' } });
    expect(lineDiscountInputs[0]).toHaveValue('100,00');
    fireEvent.change(lineDiscountInputs[0], { target: { value: '10' } });
    expect(within(dialog).getAllByText('180,00 EUR').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('60,00 EUR').length).toBeGreaterThan(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'sales:clientQuotes.updateQuote' }));
    await waitFor(() => expect(onUpdateQuote).toHaveBeenCalledTimes(1));
    expect(onUpdateQuote.mock.calls[0][1].items?.[0].discount).toBe(10);
  });

  test('inherits duration and its unit when selecting a supplier quote item', () => {
    const supplierQuote: SupplierQuote = {
      id: 'SQ-DURATION',
      supplierId: 'supplier-1',
      supplierName: 'Acme Supplies',
      items: [
        {
          id: 'sqi-duration',
          quoteId: 'SQ-DURATION',
          productName: 'Managed Service',
          quantity: 1,
          listPrice: 120,
          discountPercent: 0,
          unitPrice: 120,
          unitType: 'unit',
          durationMonths: 24,
          durationUnit: 'years',
        },
      ],
      paymentTerms: 'immediate',
      status: 'draft',
      expirationDate: STABLE_FUTURE_EXPIRATION_DATE,
      createdAt: Date.UTC(2026, 4, 14),
      updatedAt: Date.UTC(2026, 4, 14),
    };

    render(
      <ClientQuotesView
        quotes={[]}
        clients={clients}
        products={[]}
        supplierQuotes={[supplierQuote]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'sales:clientQuotes.createNewQuote' }));
    fireEvent.click(screen.getByText('sales:clientQuotes.addProduct'));
    fireEvent.click(
      screen.getAllByRole('button', { name: 'sales:clientQuotes.noSupplierQuote' })[0],
    );
    fireEvent.click(
      screen.getByRole('option', {
        name: /^\[SQ-DURATION\] Acme Supplies · Managed Service/,
      }),
    );

    const durationInputs = screen
      .getAllByPlaceholderText('sales:clientQuotes.durationColumn')
      .filter((element): element is HTMLInputElement => element instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs.every((input) => input.value === '2')).toBe(true);
    expect(screen.getAllByText('sales:clientQuotes.years').length).toBeGreaterThan(0);
  });
  test('defaults a new quote to the first communication channel and shows inline management', () => {
    render(
      <ClientQuotesView
        quotes={[]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        communicationChannels={communicationChannels}
        canManageCommunicationChannels={true}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'sales:clientQuotes.createNewQuote' }));

    expect(screen.getAllByText('sales:communicationChannels.fieldLabel').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Email').length).toBeGreaterThan(0);
    const manageButton = screen.getByRole('button', { name: 'common:buttons.manage' });
    expect(manageButton.querySelector('.fa-gear')).not.toBeNull();
    expect(manageButton).toHaveAttribute('data-size', 'xs');
  });

  test('requires a communication channel before saving a quote', () => {
    render(
      <ClientQuotesView
        quotes={[]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        communicationChannels={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'sales:clientQuotes.createNewQuote' }));
    fireEvent.click(screen.getByRole('button', { name: 'sales:clientQuotes.createQuote' }));

    expect(screen.getByText('sales:communicationChannels.errors.required')).toBeInTheDocument();
  });

  test('shows duplicate quote code conflicts on the code field instead of a toast', async () => {
    const duplicateQuote = { ...quotes[0], id: 'Q-DUP-A', expirationDate: '2099-12-31' };
    const onUpdateQuote = mock(async () => {
      throw new ApiError('Quote ID already exists', 409);
    });

    render(
      <ClientQuotesView
        quotes={[duplicateQuote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        communicationChannels={communicationChannels}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={onUpdateQuote}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByText('Q-DUP-A'));
    const dialog = await screen.findByRole('dialog');
    const codeInput = within(dialog).getByDisplayValue('Q-DUP-A');
    fireEvent.change(codeInput, { target: { value: 'Q-DUP-B' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'sales:clientQuotes.updateQuote' }));

    await waitFor(() => {
      expect(onUpdateQuote).toHaveBeenCalled();
    });
    expect(
      await within(dialog).findByText('sales:clientQuotes.errors.quoteCodeAlreadyExists'),
    ).toBeInTheDocument();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('scales line totals by a line item duration in the quote list (issue #757)', () => {
    const durationQuote: Quote = {
      id: 'Q-DUR',
      clientId: 'client-1',
      clientName: 'Helios Energy Services',
      items: [
        {
          id: 'item-dur',
          quoteId: 'Q-DUR',
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
      expirationDate: STABLE_FUTURE_EXPIRATION_DATE,
      createdAt: Date.UTC(2026, 4, 14),
      updatedAt: Date.UTC(2026, 4, 14),
    };

    render(
      <ClientQuotesView
        quotes={[durationQuote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    // Subtotal (revenue) = unitPrice 100 × quantity 2 × durationMonths 3 = 600.00
    // (without the duration multiplier it would be 200.00).
    expect(screen.getAllByText('600,00 EUR').length).toBeGreaterThan(0);
    // Margin = revenue 600 − cost (60 × 2 × 3 = 360) = 240.00, which only holds when BOTH
    // revenue and cost are scaled by duration.
    expect(screen.getAllByText('240,00 EUR').length).toBeGreaterThan(0);
  });

  test('shows an editable duration field for "unit"-measured lines (always usable)', async () => {
    const unitQuote: Quote = {
      id: 'Q-UNIT',
      clientId: 'client-1',
      clientName: 'Helios Energy Services',
      items: [
        {
          id: 'item-unit',
          quoteId: 'Q-UNIT',
          productId: 'product-1',
          productName: 'Widget',
          quantity: 5,
          unitPrice: 100,
          productCost: 60,
          productMolPercentage: 40,
          // Durata is editable for every unit type now, including 'unit'.
          unitType: 'unit',
          durationMonths: 6,
        },
      ],
      paymentTerms: '30gg',
      discount: 0,
      discountType: 'percentage',
      status: 'draft',
      expirationDate: STABLE_FUTURE_EXPIRATION_DATE,
      createdAt: Date.UTC(2026, 4, 14),
      updatedAt: Date.UTC(2026, 4, 14),
    };

    render(
      <ClientQuotesView
        quotes={[unitQuote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );
    fireEvent.click(screen.getByText('Q-UNIT'));
    await screen.findByRole('dialog');

    // The Durata cell is an editable input (not N/A), showing the stored 6 months for the unit line.
    expect(screen.queryAllByText('common:labels.notApplicable')).toHaveLength(0);
    const durationInputs = screen
      .getAllByPlaceholderText('sales:clientQuotes.durationColumn')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs.some((el) => el.value === '6')).toBe(true);
  });

  test("disables the duration input when the line's duration unit is 'N/A' (issue #775)", async () => {
    const naQuote: Quote = {
      id: 'Q-NA',
      clientId: 'client-1',
      clientName: 'Helios Energy Services',
      items: [
        {
          id: 'item-na',
          quoteId: 'Q-NA',
          productId: 'product-1',
          productName: 'Consulting',
          quantity: 2,
          unitPrice: 100,
          productCost: 60,
          productMolPercentage: 40,
          durationMonths: 6,
          durationUnit: 'na',
        },
      ],
      paymentTerms: '30gg',
      discount: 0,
      discountType: 'percentage',
      status: 'draft',
      expirationDate: STABLE_FUTURE_EXPIRATION_DATE,
      createdAt: Date.UTC(2026, 4, 14),
      updatedAt: Date.UTC(2026, 4, 14),
    };

    render(
      <ClientQuotesView
        quotes={[naQuote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );
    fireEvent.click(screen.getByText('Q-NA'));
    await screen.findByRole('dialog');

    // Selecting N/A disables the numeric duration input beside the unit selector (issue #775).
    const durationInputs = screen
      .getAllByPlaceholderText('sales:clientQuotes.durationColumn')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs.every((el) => el.disabled)).toBe(true);
  });

  test('a years duration prices off the canonical months, matching the months equivalent (issue #757)', () => {
    // durationUnit only changes how the duration is displayed/entered; pricing always uses the
    // canonical durationMonths (24). So 24 months shown as "2 years" must total the same as
    // 24 months shown as months.
    const yearsItem = {
      id: 'item-years',
      quoteId: 'Q-YEARS',
      productId: 'product-1',
      productName: 'Consulting',
      quantity: 2,
      unitPrice: 100,
      productCost: 60,
      productMolPercentage: 40,
      durationMonths: 24,
      durationUnit: 'years' as const,
    };
    const yearsQuote: Quote = {
      id: 'Q-YEARS',
      clientId: 'client-1',
      clientName: 'Helios Energy Services',
      items: [yearsItem],
      paymentTerms: '30gg',
      discount: 0,
      discountType: 'percentage',
      status: 'draft',
      expirationDate: STABLE_FUTURE_EXPIRATION_DATE,
      createdAt: Date.UTC(2026, 4, 14),
      updatedAt: Date.UTC(2026, 4, 14),
    };

    render(
      <ClientQuotesView
        quotes={[yearsQuote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    // Subtotal (revenue) = 100 × 2 × 24 = 4800.00 — identical to a 24-month item.
    expect(screen.getAllByText('4.800,00 EUR').length).toBeGreaterThan(0);
    // Margin = 4800 − (60 × 2 × 24 = 2880) = 1920.00.
    expect(screen.getAllByText('1.920,00 EUR').length).toBeGreaterThan(0);
  });

  test('MOL line input keeps two decimals instead of rounding to one (issue #780)', async () => {
    const twoDecimalMolQuote: Quote = {
      id: 'Q-MOL',
      clientId: 'client-1',
      clientName: 'Helios Energy Services',
      items: [
        {
          id: 'item-mol',
          quoteId: 'Q-MOL',
          productId: 'product-1',
          productName: 'Consulting',
          quantity: 2,
          unitPrice: 100,
          productCost: 60,
          productMolPercentage: 12.34,
        },
      ],
      paymentTerms: '30gg',
      discount: 0,
      discountType: 'percentage',
      status: 'draft',
      expirationDate: STABLE_FUTURE_EXPIRATION_DATE,
      createdAt: Date.UTC(2026, 4, 14),
      updatedAt: Date.UTC(2026, 4, 14),
    };

    render(
      <ClientQuotesView
        quotes={[twoDecimalMolQuote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByText('Q-MOL'));
    await screen.findByRole('dialog');

    // formatDecimals={2}: the MOL inputs (mobile + desktop layouts) show 12,34, not the
    // pre-fix rounded 12,3 that silently dropped the second decimal.
    expect(screen.queryAllByDisplayValue('12,34').length).toBeGreaterThan(0);
    expect(screen.queryAllByDisplayValue('12,3')).toHaveLength(0);
  });

  test('the read-only banner renders dark-mode-compatible amber, not a light slab (issue #768)', async () => {
    // A finalized (accepted) quote opens the dialog read-only and surfaces the warning banner.
    const acceptedQuote: Quote = { ...quotes[0], id: 'Q-ACCEPTED', status: 'accepted' };

    render(
      <ClientQuotesView
        quotes={[acceptedQuote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByText('Q-ACCEPTED'));
    const dialog = await screen.findByRole('dialog');

    const lineDiscountInputs = within(dialog)
      .getAllByRole('textbox', { name: 'common:labels.discount' })
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
    expect(lineDiscountInputs.length).toBeGreaterThan(0);
    expect(lineDiscountInputs.every((input) => input.disabled)).toBe(true);

    const label = screen.getByText('sales:clientQuotes.readOnlyBecauseFinal');
    // The label carries an explicit dark-mode color so it stays legible on the dark dialog.
    expect(label.className).toContain('dark:text-amber-300');
    // The banner background is translucent amber (renders on both themes) instead of the old
    // solid bg-amber-50 cream that looked broken in dark mode (issue #768).
    const banner = label.closest('div');
    expect(banner?.className).toContain('bg-amber-500/10');
    expect(banner?.className).toContain('border-amber-500/30');
    // The old solid-cream banner border is gone (bg-amber-50 is a prefix of bg-amber-500/10,
    // so assert on the unambiguous old border token instead).
    expect(banner?.className).not.toContain('border-amber-200');
  });

  test('dialog warning banners avoid light-only amber classes (issue #768)', async () => {
    const source = await readComponentSource('sales/ClientQuotesView.tsx');
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

describe('<ClientQuotesView /> edit action gating (#812 round 13)', () => {
  const renderQuote = (quote: Quote) =>
    render(
      <ClientQuotesView
        quotes={[quote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

  // StandardTable collapses the actions cell into a per-row kebab menu; the edit entry (cloned
  // from the pencil button, aria-label + disabled preserved) only exists after opening it.
  const openRowActions = async (user: ReturnType<typeof userEvent.setup>) => {
    await waitForSavedViewsLoad();
    await user.click(screen.getByRole('button', { name: 'table.rowActions' }));
    await waitFor(() => {
      expect(
        document.body.querySelector('[data-standard-table-action-menu="true"]'),
      ).not.toBeNull();
    });
  };

  test('keeps the edit action enabled on an expired quote without an offer (extend-date recovery)', async () => {
    // The row click opens such quotes read-only-except-expiration so the date can be extended out
    // of `expired`; the edit action must gate on the same canOpenQuoteModal predicate, not
    // isHistoryRow.
    const user = userEvent.setup();
    renderQuote({ ...quotes[0], id: 'Q-EXPIRED', status: 'sent', expirationDate: '2000-01-01' });

    await openRowActions(user);
    const edit = await screen.findByRole('button', { name: 'sales:clientQuotes.editQuote' });
    expect(edit).not.toBeDisabled();
  });

  test('opens an in-offer quote row in read-only mode', async () => {
    const user = userEvent.setup();
    renderQuote({
      ...quotes[0],
      id: 'Q-OFFERED',
      status: 'offer',
      expirationDate: '2099-12-31',
      linkedOfferId: 'off-1',
    });

    await waitForSavedViewsLoad();
    await user.click(screen.getByText('Q-OFFERED'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('sales:clientQuotes.readOnlyBecauseOffer')).toBeTruthy();
  });

  test('enables back-to-draft for an offer quote whose linked offer is still draft', async () => {
    const user = userEvent.setup();
    const onUpdateQuote = mock(() => Promise.resolve());
    render(
      <ClientQuotesView
        quotes={[
          {
            ...quotes[0],
            id: 'Q-OFFERED',
            status: 'offer',
            expirationDate: '2099-12-31',
            linkedOfferId: 'off-1',
          },
        ]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={onUpdateQuote}
        onDeleteQuote={mock(() => Promise.resolve())}
        quoteOfferStatuses={{ 'Q-OFFERED': 'draft' }}
      />,
    );

    await openRowActions(user);
    const restore = await screen.findByRole('button', { name: 'sales:clientQuotes.restoreQuote' });
    expect(restore).not.toBeDisabled();
    await user.click(restore);
    await waitFor(() => {
      expect(onUpdateQuote).toHaveBeenCalledWith('Q-OFFERED', { status: 'draft' });
    });
  });

  test('keeps back-to-draft disabled once the linked offer is no longer draft', async () => {
    const user = userEvent.setup();
    render(
      <ClientQuotesView
        quotes={[
          {
            ...quotes[0],
            id: 'Q-OFFERED',
            status: 'offer',
            expirationDate: '2099-12-31',
            linkedOfferId: 'off-1',
          },
        ]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
        quoteOfferStatuses={{ 'Q-OFFERED': 'sent' }}
      />,
    );

    await openRowActions(user);
    const restore = await screen.findByRole('button', {
      name: 'sales:clientQuotes.restoreDisabledOfferStatus',
    });
    expect(restore).toBeDisabled();
  });

  test('keeps back-to-draft disabled for an expired offer quote even with a draft linked offer', async () => {
    const user = userEvent.setup();
    render(
      <ClientQuotesView
        quotes={[
          {
            ...quotes[0],
            id: 'Q-OFFERED',
            status: 'offer',
            effectiveStatus: 'expired',
            linkedOfferId: 'off-1',
          },
        ]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
        quoteOfferStatuses={{ 'Q-OFFERED': 'draft' }}
      />,
    );

    await openRowActions(user);
    const restore = await screen.findByRole('button', {
      name: 'sales:clientQuotes.historyActionsDisabled',
    });
    expect(restore).toBeDisabled();
  });
});

describe('<ClientQuotesView /> line-item delete confirmation', () => {
  const openEditor = async () => {
    render(
      <ClientQuotesView
        quotes={[{ ...quotes[0], expirationDate: '2099-12-31' }]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );
    await waitForSavedViewsLoad();
    fireEvent.click(screen.getByText('Q-001'));
    return screen.findByRole('dialog');
  };

  const findLineDeleteConfirm = async () => {
    const title = await screen.findByText('sales:clientQuotes.removeProductTitle');
    const root =
      title.closest('[data-testid="line-delete-confirm"]') ?? title.closest('[role="dialog"]');
    if (!(root instanceof HTMLElement)) {
      throw new Error('Line delete confirmation root not found');
    }
    return root;
  };

  const clickLineDeleteConfirm = (root: HTMLElement) => {
    const stubConfirm = within(root).queryByTestId('line-delete-confirm-btn');
    if (stubConfirm) {
      fireEvent.click(stubConfirm);
      return;
    }
    fireEvent.click(within(root).getByRole('button', { name: 'buttons.yesDelete' }));
  };

  const clickLineDeleteCancel = (root: HTMLElement) => {
    const stubCancel = within(root).queryByTestId('line-delete-cancel');
    if (stubCancel) {
      fireEvent.click(stubCancel);
      return;
    }
    fireEvent.click(within(root).getByRole('button', { name: 'buttons.noGoBack' }));
  };

  test('confirms before removing a product line and removes it only after confirming', async () => {
    const dialog = await openEditor();
    const rowDeletes = rowDeleteButtons(dialog);
    expect(rowDeletes.length).toBeGreaterThan(0);

    // Clicking the trash icon must NOT remove the row immediately — it opens a confirmation.
    fireEvent.click(rowDeletes[0]);
    const confirmUi = await findLineDeleteConfirm();
    expect(
      within(confirmUi).getByText('sales:clientQuotes.removeProductTitle'),
    ).toBeInTheDocument();
    expect(rowDeleteButtons(dialog)).toHaveLength(rowDeletes.length);

    clickLineDeleteConfirm(confirmUi);
    await waitFor(() => {
      expect(rowDeleteButtons(dialog)).toHaveLength(0);
    });
  });

  test('keeps the product line when the confirmation is dismissed', async () => {
    const dialog = await openEditor();
    const rowDeletes = rowDeleteButtons(dialog);

    fireEvent.click(rowDeletes[0]);
    clickLineDeleteCancel(await findLineDeleteConfirm());

    await waitFor(() => {
      expect(screen.queryByText('sales:clientQuotes.removeProductTitle')).not.toBeInTheDocument();
    });
    expect(rowDeleteButtons(dialog)).toHaveLength(rowDeletes.length);
  });
});
