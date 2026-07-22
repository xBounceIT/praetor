import { afterEach, beforeEach, describe, expect, mock } from 'bun:test';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../services/api/client';
import type { Client, Quote, QuoteMutation, SupplierQuote } from '../../../types';
import { addMonthsToDateOnly, getLocalDateString } from '../../../utils/date';
import { installI18nMock } from '../../helpers/i18n';
import { LineDeleteConfirmStub } from '../../helpers/lineItemDeleteConfirm';
import { reactTest as test } from '../../helpers/reactTest';
import { render } from '../../helpers/render';
import { openRowDeleteButton, rowDeleteButtons } from '../../helpers/rowDeleteButtons';
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
    icon: 'envelope' as const,
    isDefault: true,
    clientQuoteCount: 0,
    supplierQuoteCount: 0,
    totalQuoteCount: 0,
  },
];

const quotes: Quote[] = [
  {
    id: 'Q-001',
    description: 'Managed consulting',
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
    description: 'Infrastructure renewal',
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

const withSingleCandidate = (quote: Quote, candidateId: string): Quote => {
  const items = quote.items.map((item) => ({
    ...item,
    quoteId: quote.id,
    candidateId,
  }));
  return {
    ...quote,
    items,
    candidates: [
      {
        id: candidateId,
        quoteId: quote.id,
        name: 'Variante A',
        position: 0,
        state: 'active',
        items,
        paymentTerms: quote.paymentTerms,
        discount: quote.discount,
        discountType: quote.discountType,
        expirationDate: quote.expirationDate,
        communicationChannelId: quote.communicationChannelId,
        notes: quote.notes,
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
      },
    ],
  };
};

describe('<ClientQuotesView />', () => {
  test('exposes an editable free-text description in the create dialog', () => {
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
    const description = screen.getByRole('textbox', { name: 'sales:clientQuotes.description' });
    fireEvent.change(description, { target: { value: 'Managed service renewal' } });

    expect(description).toHaveValue('Managed service renewal');
    expect(description).toBeEnabled();
    expect(description.closest('[data-slot="field"]')).toHaveClass('w-full');
    expect(description.closest('.grid')).toBeNull();
  });

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
      'sales:clientQuotes.description',
      'crm:clients.tableHeaders.insertDate',
      'sales:clientQuotes.clientColumn',
      'sales:clientQuotes.candidates.column',
      'sales:clientQuotes.subtotal',
      'sales:clientQuotes.discountPercentColumn',
      'common:labels.totalDiscount',
      'sales:clientQuotes.discountedTotalColumn',
      'sales:clientQuotes.marginLabel',
      'sales:clientQuotes.molLabel',
      'sales:clientQuotes.paymentTermsColumn',
      'sales:communicationChannels.fieldLabel',
      'sales:clientQuotes.expirationColumn',
      'sales:clientQuotes.statusColumn',
      'sales:clientQuotes.actionsColumn',
    ]);
    const firstQuoteRow = screen.getByText('Q-001').closest('tr');
    if (!firstQuoteRow) throw new Error('Expected Q-001 table row');
    expect(within(firstQuoteRow).getByText('Managed consulting')).toBeInTheDocument();
    const variantCell = within(firstQuoteRow).getAllByRole('cell')[4];
    expect(variantCell).toHaveTextContent('sales:clientQuotes.candidates.notApplicable');
    expect(variantCell).not.toHaveTextContent('sales:clientQuotes.candidates.count');
    expect(variantCell).not.toHaveTextContent('EUR');
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

  test('shows the sum of line and global discounts in the list and summary', async () => {
    const quoteWithDiscounts: Quote = {
      ...quotes[0],
      id: 'Q-TOTAL-DISCOUNT',
      discount: 10,
      items: [{ ...quotes[0].items[0], quoteId: 'Q-TOTAL-DISCOUNT', discount: 10 }],
    };

    render(
      <ClientQuotesView
        quotes={[quoteWithDiscounts]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        communicationChannels={communicationChannels}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    const quoteRow = screen.getByText('Q-TOTAL-DISCOUNT').closest('tr');
    if (!quoteRow) throw new Error('Expected quote row');
    expect(within(quoteRow).getByText('-38,00 EUR')).toBeInTheDocument();
    expect(within(quoteRow).getByText('200,00 EUR')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Q-TOTAL-DISCOUNT'));
    const dialog = await screen.findByRole('dialog');
    const discountLabel = within(dialog).getByText('common:labels.totalDiscount');
    expect(within(dialog).getByText('(19,00%)')).toHaveClass('text-amber-600');
    expect(discountLabel.nextElementSibling).toHaveTextContent('-38,00 EUR');
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
    // ...and the new row leaves duration empty so only its text placeholder is visible.
    const durationInputs = screen
      .getAllByRole('textbox', { name: 'sales:clientQuotes.durationColumn' })
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs[0].value).toBe('');
    expect(durationInputs[0]).toHaveAttribute('placeholder', '0');
  });

  test('edits a per-line discount and submits net revenue and margin', async () => {
    const onUpdateQuote = mock((_id: string, _updates: QuoteMutation) => Promise.resolve());
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
    const revenueInputs = within(dialog)
      .getAllByRole('textbox', { name: 'sales:clientQuotes.revenue' })
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
    expect(revenueInputs.length).toBeGreaterThan(0);
    expect(revenueInputs.every((input) => input.disabled)).toBe(true);
    fireEvent.change(lineDiscountInputs[0], { target: { value: '10' } });
    expect(revenueInputs.every((input) => !input.disabled)).toBe(true);
    expect(revenueInputs.some((input) => input.value === '180,00')).toBe(true);
    expect(within(dialog).getAllByText('60,00 EUR').length).toBeGreaterThan(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'sales:clientQuotes.updateQuote' }));
    await waitFor(() => expect(onUpdateQuote).toHaveBeenCalledTimes(1));
    expect(onUpdateQuote.mock.calls[0][1].items?.[0].discount).toBe(10);
  });

  test('submits a blank duration without persisting an empty years unit', async () => {
    const onUpdateQuote = mock((_id: string, _updates: QuoteMutation) => Promise.resolve());
    const blankDurationQuote: Quote = {
      ...quotes[0],
      id: 'Q-BLANK-DURATION',
      items: [
        {
          ...quotes[0].items[0],
          quoteId: 'Q-BLANK-DURATION',
          durationMonths: undefined,
          durationUnit: 'years',
        },
      ],
    };

    render(
      <ClientQuotesView
        quotes={[blankDurationQuote]}
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

    fireEvent.click(screen.getByText('Q-BLANK-DURATION'));
    const dialog = await screen.findByRole('dialog');
    const durationInputs = within(dialog)
      .getAllByRole('textbox', { name: 'sales:clientQuotes.durationColumn' })
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
    expect(durationInputs.some((input) => input.value === '')).toBe(true);

    fireEvent.click(within(dialog).getByRole('button', { name: 'sales:clientQuotes.updateQuote' }));
    await waitFor(() => expect(onUpdateQuote).toHaveBeenCalledTimes(1));
    expect(onUpdateQuote.mock.calls[0][1].items?.[0]).toMatchObject({
      durationMonths: undefined,
      durationUnit: 'months',
    });
  });

  test('inherits duration and its unit when selecting a supplier quote item', async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole('button', { name: 'sales:clientQuotes.createNewQuote' }));
    await user.click(screen.getByText('sales:clientQuotes.addProduct'));
    await user.click(
      screen.getAllByRole('button', { name: 'sales:clientQuotes.noSupplierQuote' })[0],
    );
    await user.click(
      await screen.findByRole('option', {
        name: /^\[SQ-DURATION\] Acme Supplies · Managed Service/,
      }),
    );

    await waitFor(() => {
      const durationInputs = screen
        .getAllByRole('textbox', { name: 'sales:clientQuotes.durationColumn' })
        .filter((element): element is HTMLInputElement => element instanceof HTMLInputElement);
      expect(durationInputs.length).toBeGreaterThan(0);
      expect(durationInputs.every((input) => input.value === '2')).toBe(true);
      expect(screen.getAllByText('sales:clientQuotes.years').length).toBeGreaterThan(0);
    });
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

  test('reorders quote items by drag and keyboard, then submits the new order', async () => {
    const reorderQuote: Quote = {
      ...quotes[0],
      id: 'Q-ORDER',
      items: [
        {
          ...quotes[0].items[0],
          id: 'item-first',
          quoteId: 'Q-ORDER',
          productName: 'First service',
        },
        {
          ...quotes[0].items[0],
          id: 'item-second',
          quoteId: 'Q-ORDER',
          productName: 'Second service',
        },
      ],
    };
    const onUpdateQuote = mock((_id: string, _updates: QuoteMutation) => Promise.resolve());

    render(
      <ClientQuotesView
        quotes={[reorderQuote]}
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

    fireEvent.click(screen.getByText('Q-ORDER'));
    const dialog = await screen.findByRole('dialog');
    const handles = within(dialog).getAllByRole('button', {
      name: 'sales:clientQuotes.reorderItem',
    });
    expect(handles).toHaveLength(2);
    const secondRow = handles[1].closest('[data-quote-item-id]');
    expect(secondRow).not.toBeNull();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: mock(() => {}),
      getData: mock(() => ''),
    };

    fireEvent.dragStart(handles[0], { dataTransfer });
    fireEvent.drop(secondRow as HTMLElement, { dataTransfer });
    const itemOrder = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>('[data-quote-item-id]')).map(
        (row) => row.dataset.quoteItemId,
      );
    expect(itemOrder()).toEqual(['item-second', 'item-first']);

    fireEvent.keyDown(
      within(dialog).getAllByRole('button', { name: 'sales:clientQuotes.reorderItem' })[0],
      { key: 'ArrowDown' },
    );
    expect(itemOrder()).toEqual(['item-first', 'item-second']);
    fireEvent.keyDown(
      within(dialog).getAllByRole('button', { name: 'sales:clientQuotes.reorderItem' })[0],
      { key: 'End' },
    );
    expect(itemOrder()).toEqual(['item-second', 'item-first']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'sales:clientQuotes.updateQuote' }));

    await waitFor(() => expect(onUpdateQuote).toHaveBeenCalledTimes(1));
    const submitted = onUpdateQuote.mock.calls[0][1] as Partial<Quote>;
    expect(submitted.items?.map((item) => item.id)).toEqual(['item-second', 'item-first']);
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
      .getAllByRole('textbox', { name: 'sales:clientQuotes.durationColumn' })
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
      .getAllByRole('textbox', { name: 'sales:clientQuotes.durationColumn' })
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs.every((el) => el.disabled)).toBe(true);
  });

  test('a years duration prices using the displayed year value', () => {
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

    // Stored 24 months display as 2 years: revenue = 100 × 2 × 2 = 400.
    expect(screen.getAllByText('400,00 EUR').length).toBeGreaterThan(0);
    // Margin = 400 − (60 × 2 × 2 = 240) = 160.
    expect(screen.getAllByText('160,00 EUR').length).toBeGreaterThan(0);
  });

  test('changing hours to days preserves numeric cost and sale price', async () => {
    const onUpdateQuote = mock((_id: string, _updates: QuoteMutation) => Promise.resolve());
    const hourlyQuote: Quote = {
      ...quotes[0],
      id: 'Q-UNIT-LABEL',
      discount: 0,
      items: [
        {
          ...quotes[0].items[0],
          quoteId: 'Q-UNIT-LABEL',
          quantity: 1,
          unitPrice: 100,
          productCost: 60,
          productMolPercentage: 40,
          unitType: 'hours',
        },
      ],
    };

    render(
      <ClientQuotesView
        quotes={[hourlyQuote]}
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

    fireEvent.click(screen.getByText('Q-UNIT-LABEL'));
    const dialog = await screen.findByRole('dialog');
    const unitSelector = screen
      .getAllByRole('combobox')
      .find((element) => element.textContent?.includes('sales:clientQuotes.hour'));
    expect(unitSelector).toBeDefined();
    fireEvent.click(unitSelector as HTMLElement);
    const dayOption = screen
      .getAllByText('sales:clientQuotes.day')
      .find((element) => element.tagName === 'SPAN');
    expect(dayOption).toBeDefined();
    fireEvent.click(dayOption as HTMLElement);
    fireEvent.click(within(dialog).getByRole('button', { name: 'sales:clientQuotes.updateQuote' }));
    await waitFor(() => expect(onUpdateQuote).toHaveBeenCalledTimes(1));

    const updates = onUpdateQuote.mock.calls[0]?.[1] as Partial<Quote>;
    expect(updates.items?.[0]).toEqual(
      expect.objectContaining({ unitType: 'days', productCost: 60, unitPrice: 100 }),
    );
  });

  test('shows the effective daily cost for a legacy product-backed day line', async () => {
    const legacyQuote: Quote = {
      ...quotes[0],
      id: 'Q-LEGACY-DAY-COST',
      items: [
        {
          ...quotes[0].items[0],
          quoteId: 'Q-LEGACY-DAY-COST',
          unitType: 'days',
          productCost: 50,
          unitPrice: 500,
          pricingSemanticsVersion: 1,
        },
      ],
    };

    render(
      <ClientQuotesView
        quotes={[legacyQuote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        communicationChannels={communicationChannels}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByText('Q-LEGACY-DAY-COST'));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByLabelText('crm:internalListing.cost')).toHaveValue('400,00');
  });

  test('MOL line input keeps two decimals, stays below 100, and recalculates pricing', async () => {
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
    const dialog = await screen.findByRole('dialog');

    // formatDecimals={2}: the MOL inputs (mobile + desktop layouts) show 12,34, not the
    // pre-fix rounded 12,3 that silently dropped the second decimal.
    expect(screen.queryAllByDisplayValue('12,34').length).toBeGreaterThan(0);
    expect(screen.queryAllByDisplayValue('12,3')).toHaveLength(0);

    const molInput = screen.getAllByLabelText('sales:clientQuotes.molLabel')[0] as HTMLInputElement;
    fireEvent.focus(molInput);
    fireEvent.change(molInput, { target: { value: '118' } });

    // A MOL of 100% or more has no finite sale price. The editor caps it at the highest value
    // representable by numeric(5, 2), instead of accepting it and silently resetting margin to 0.
    expect(molInput.value).toBe('99,99');

    fireEvent.change(molInput, { target: { value: '25' } });
    await waitFor(() => {
      // Cost 60, MOL 25% => unit price 80; with quantity 2, revenue is 160 and margin is 40.
      expect(screen.getAllByText('160,00 EUR').length).toBeGreaterThan(0);
      expect(screen.getAllByText('40,00 EUR').length).toBeGreaterThan(0);
    });

    expect(dialog).toBeInTheDocument();
  });

  test('automatically recalculates MOL when the sale price changes', async () => {
    render(
      <ClientQuotesView
        quotes={[{ ...quotes[0], id: 'Q-AUTO-MOL', discount: 0 }]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByText('Q-AUTO-MOL'));
    const dialog = await screen.findByRole('dialog');
    const salePriceInput = within(dialog).getAllByLabelText(
      'crm:internalListing.salePrice',
    )[0] as HTMLInputElement;
    const molInput = within(dialog).getAllByLabelText(
      'sales:clientQuotes.molLabel',
    )[0] as HTMLInputElement;

    fireEvent.focus(salePriceInput);
    fireEvent.change(salePriceInput, { target: { value: '80' } });
    await waitFor(() => {
      // Cost 60, sale price 80 => MOL 25%; quantity 2 => revenue 160 and margin 40.
      expect(molInput.value).toBe('25,00');
      expect(within(dialog).getAllByText('160,00 EUR').length).toBeGreaterThan(0);
      expect(within(dialog).getAllByText('40,00 EUR').length).toBeGreaterThan(0);
    });

    fireEvent.change(salePriceInput, { target: { value: '50' } });
    await waitFor(() => expect(molInput.value).toBe('-20,00'));
    expect(molInput.checkValidity()).toBe(true);
  });

  test('edits net revenue and recalculates sale price and MOL without changing cost', async () => {
    const revenueQuote: Quote = {
      ...quotes[0],
      id: 'Q-REVENUE',
      discount: 0,
      items: [
        {
          ...quotes[0].items[0],
          quoteId: 'Q-REVENUE',
          quantity: 2,
          durationMonths: 3,
          discount: 20,
        },
      ],
    };
    render(
      <ClientQuotesView
        quotes={[revenueQuote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    fireEvent.click(screen.getByText('Q-REVENUE'));
    const dialog = await screen.findByRole('dialog');
    const revenueInput = within(dialog).getAllByLabelText(
      'sales:clientQuotes.revenue',
    )[0] as HTMLInputElement;
    const salePriceInput = within(dialog).getAllByLabelText(
      'crm:internalListing.salePrice',
    )[0] as HTMLInputElement;
    const costInput = within(dialog).getAllByLabelText(
      'crm:internalListing.cost',
    )[0] as HTMLInputElement;
    const quantityInput = within(dialog).getAllByLabelText(
      'sales:clientQuotes.qty',
    )[0] as HTMLInputElement;
    const molInput = within(dialog).getAllByLabelText(
      'sales:clientQuotes.molLabel',
    )[0] as HTMLInputElement;

    expect(revenueInput).not.toBeDisabled();
    expect(revenueInput).toHaveValue('480,00');
    fireEvent.focus(revenueInput);
    fireEvent.change(revenueInput, { target: { value: '720' } });

    await waitFor(() => {
      expect(salePriceInput).toHaveValue('150,00');
      expect(molInput).toHaveValue('60,00');
      expect(costInput).toHaveValue('60,00');
      expect(within(dialog).getAllByText('360,00 EUR').length).toBeGreaterThan(0);
    });

    fireEvent.change(quantityInput, { target: { value: '' } });
    expect(revenueInput).toBeDisabled();
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
    const revenueInputs = within(dialog)
      .getAllByRole('textbox', { name: 'sales:clientQuotes.revenue' })
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
    expect(revenueInputs.length).toBeGreaterThan(0);
    expect(revenueInputs.every((input) => input.disabled)).toBe(true);

    const label = screen.getByText('sales:clientQuotes.readOnlyStatus');
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
    const viewSource = await readComponentSource('sales/ClientQuotesView.tsx');
    const bannerSource = await readComponentSource('shared/ModalReadOnlyStatusBanner.tsx');
    // Read-only status uses the shared banner with translucent amber plus an explicit dark-mode
    // text color, matching the dark-mode-compatible accounting orders banners.
    expectSourceContainsAll(viewSource, ["from '../shared/ModalReadOnlyStatusBanner'"]);
    expectSourceContainsAll(bannerSource, [
      'border border-amber-500/30 bg-amber-500/10',
      'dark:text-amber-300',
    ]);
    // The old light-only banner backgrounds (a pale cream slab on the dark dialog) are gone.
    expectSourceOmitsAll(viewSource, [
      'border border-amber-200 bg-amber-50',
      'border border-amber-300 bg-amber-50',
    ]);
  });
});

describe('<ClientQuotesView /> row actions and edit gating (#812 round 13)', () => {
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

  test('opens a clean create draft from Duplicate and saves every reactivated variant', async () => {
    const user = userEvent.setup();
    const onAddQuote = mock((_data: QuoteMutation) => Promise.resolve());
    const quote = withSingleCandidate(
      {
        ...quotes[0],
        id: 'Q-DUPLICATE-SOURCE',
        status: 'accepted',
        linkedOfferId: 'OFF-001',
      },
      'candidate-selected',
    );
    const [firstCandidate] = quote.candidates ?? [];
    if (!firstCandidate) throw new Error('Expected candidate fixture');
    const sourcedItem = {
      ...firstCandidate.items[0],
      quantity: 3,
      unitPrice: 150,
      productCost: 90,
      productMolPercentage: 40,
      discount: 10,
      durationMonths: 12,
      durationUnit: 'years' as const,
      supplierQuoteId: 'SQ-SOURCE',
      supplierQuoteItemId: 'SQI-SOURCE',
      supplierQuoteSupplierName: 'Source Supplier',
      supplierQuoteUnitPrice: 60,
      supplierQuoteBaseQuantity: 2,
      supplierQuoteBaseUnitPrice: 60,
    };
    quote.items = [sourcedItem];
    quote.selectedCandidateId = firstCandidate.id;
    quote.candidates = [
      {
        ...firstCandidate,
        state: 'selected',
        items: [sourcedItem],
      },
      {
        ...firstCandidate,
        id: 'candidate-discarded',
        name: 'Variante B',
        position: 1,
        state: 'discarded',
        notes: 'Second variant notes',
        items: [
          {
            ...sourcedItem,
            id: 'item-second',
            candidateId: 'candidate-discarded',
            unitPrice: 120,
          },
        ],
      },
    ];

    render(
      <ClientQuotesView
        quotes={[quote]}
        clients={[]}
        products={[]}
        supplierQuotes={[]}
        communicationChannels={communicationChannels}
        currency="EUR"
        onAddQuote={onAddQuote}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    await openRowActions(user);
    await user.click(
      await screen.findByRole('button', { name: 'sales:clientQuotes.duplicateQuote' }),
    );

    expect(onAddQuote).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('sales:clientQuotes.createNewQuote')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('sales:clientQuotes.quoteCode')).toHaveValue('');
    expect(document.getElementById('client-quote-client')).toHaveTextContent(quote.clientName);
    await user.click(document.getElementById('client-quote-client') as HTMLElement);
    await user.click(await screen.findByRole('option', { name: quote.clientName }));
    expect(within(dialog).getByRole('tab', { name: /Variante A/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('tab', { name: /Variante B/ })).toBeInTheDocument();
    const expectedExpiration = addMonthsToDateOnly(getLocalDateString(), 1);

    await user.click(within(dialog).getByRole('tab', { name: /Variante B/ }));
    expect(
      within(dialog).getAllByRole('button', { name: 'sales:clientQuotes.candidates.rename' }),
    ).toHaveLength(2);

    await user.click(
      within(dialog).getByRole('button', { name: 'sales:clientQuotes.createQuote' }),
    );
    await waitFor(() => expect(onAddQuote).toHaveBeenCalledTimes(1));

    const payload = onAddQuote.mock.calls[0]?.[0] as QuoteMutation;
    expect(payload.id).toBeUndefined();
    expect(payload.description).toBe(quote.description);
    expect(payload.status).toBe('draft');
    expect(payload.clientName).toBe(quote.clientName);
    expect(payload.expirationDate).toBe(expectedExpiration);
    expect(payload).not.toHaveProperty('linkedOfferId');
    expect(payload.candidates).toHaveLength(2);
    expect(payload.candidates?.map((candidate) => candidate.name)).toEqual([
      'Variante A',
      'Variante B',
    ]);
    expect(payload.candidates?.[0]).toMatchObject({
      paymentTerms: firstCandidate.paymentTerms,
      discount: firstCandidate.discount,
      discountType: firstCandidate.discountType,
      communicationChannelId: firstCandidate.communicationChannelId,
    });
    expect(payload.candidates?.[0]?.items[0]).toMatchObject({
      quantity: 3,
      unitPrice: 150,
      productCost: 90,
      productMolPercentage: 40,
      discount: 10,
      durationMonths: 12,
      durationUnit: 'years',
    });
    expect(payload.candidates?.[1]?.notes).toBe('Second variant notes');
    for (const candidate of payload.candidates ?? []) {
      expect(candidate).not.toHaveProperty('id');
      expect(candidate.expirationDate).toBe(expectedExpiration);
      expect(candidate.items[0]?.id).toStartWith('temp-');
      expect(candidate.items[0]?.supplierQuoteId).toBeNull();
      expect(candidate.items[0]?.supplierQuoteItemId).toBeNull();
      expect(candidate.items[0]?.supplierQuoteSupplierName).toBeNull();
      expect(candidate.items[0]?.supplierQuoteUnitPrice).toBeNull();
      expect(candidate.items[0]?.supplierQuoteBaseQuantity).toBeNull();
      expect(candidate.items[0]?.supplierQuoteBaseUnitPrice).toBeNull();
    }
  });

  test('submits the selected source variant first as the duplicate primary', async () => {
    const user = userEvent.setup();
    const onAddQuote = mock((_data: QuoteMutation) => Promise.resolve());
    const quote = withSingleCandidate(
      {
        ...quotes[0],
        id: 'Q-DUPLICATE-SELECTED',
        status: 'accepted',
        linkedOfferId: 'OFF-SELECTED',
      },
      'candidate-first',
    );
    const [firstCandidate] = quote.candidates ?? [];
    const firstItem = firstCandidate?.items[0];
    if (!firstCandidate || !firstItem) throw new Error('Expected candidate fixture');

    const selectedItem = {
      ...firstItem,
      id: 'item-selected',
      candidateId: 'candidate-selected',
      unitPrice: 275,
    };
    quote.candidates = [
      {
        ...firstCandidate,
        state: 'discarded',
        items: [{ ...firstItem, unitPrice: 125 }],
      },
      {
        ...firstCandidate,
        id: 'candidate-selected',
        name: 'Variante B',
        position: 1,
        state: 'selected',
        paymentTerms: '90gg',
        discount: 15,
        notes: 'Winning variant notes',
        items: [selectedItem],
      },
    ];
    quote.selectedCandidateId = 'candidate-selected';
    quote.items = [selectedItem];
    quote.paymentTerms = '90gg';
    quote.discount = 15;
    quote.notes = 'Winning variant notes';

    render(
      <ClientQuotesView
        quotes={[quote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        communicationChannels={communicationChannels}
        currency="EUR"
        onAddQuote={onAddQuote}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    await openRowActions(user);
    await user.click(
      await screen.findByRole('button', { name: 'sales:clientQuotes.duplicateQuote' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('tab', { name: /Variante B/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(
      within(dialog).getByRole('button', { name: 'sales:clientQuotes.createQuote' }),
    );
    await waitFor(() => expect(onAddQuote).toHaveBeenCalledTimes(1));

    const payload = onAddQuote.mock.calls[0]?.[0] as QuoteMutation;
    expect(payload.candidates?.map((candidate) => candidate.name)).toEqual([
      'Variante B',
      'Variante A',
    ]);
    expect(payload).toMatchObject({
      paymentTerms: '90gg',
      discount: 15,
      notes: 'Winning variant notes',
    });
    expect(payload.items?.[0]?.unitPrice).toBe(275);
    expect(payload.candidates?.[0]?.items[0]?.unitPrice).toBe(275);
    expect(payload.candidates?.[1]?.items[0]?.unitPrice).toBe(125);
  });

  test('blocks a duplicated source-only line in a non-active variant until it is relinked', async () => {
    const user = userEvent.setup();
    const onAddQuote = mock((_data: QuoteMutation) => Promise.resolve());
    const quote = withSingleCandidate(
      {
        ...quotes[0],
        id: 'Q-DUPLICATE-SOURCE-ONLY',
      },
      'candidate-primary',
    );
    const [primaryCandidate] = quote.candidates ?? [];
    const primaryItem = primaryCandidate?.items[0];
    if (!primaryCandidate || !primaryItem) throw new Error('Expected candidate fixture');
    quote.candidates = [
      primaryCandidate,
      {
        ...primaryCandidate,
        id: 'candidate-source-only',
        name: 'Variante B',
        position: 1,
        items: [
          {
            ...primaryItem,
            id: 'item-source-only',
            candidateId: 'candidate-source-only',
            productId: '',
            productName: 'Supplier-only service',
            supplierQuoteId: 'SQ-SOURCE',
            supplierQuoteItemId: 'SQI-SOURCE',
            supplierQuoteSupplierName: 'Source Supplier',
            supplierQuoteUnitPrice: 60,
          },
        ],
      },
    ];

    render(
      <ClientQuotesView
        quotes={[quote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        communicationChannels={communicationChannels}
        currency="EUR"
        onAddQuote={onAddQuote}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    await openRowActions(user);
    await user.click(
      await screen.findByRole('button', { name: 'sales:clientQuotes.duplicateQuote' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('tab', { name: /Variante B/ }));
    expect(within(dialog).getByText('Supplier-only service')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('tab', { name: /Variante A/ }));
    await user.click(
      within(dialog).getByRole('button', { name: 'sales:clientQuotes.createQuote' }),
    );

    expect(onAddQuote).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText('sales:clientQuotes.errors.productOrSupplierRequired'),
    ).toBeInTheDocument();
  });

  test('keeps the one-time offer action for an accepted legacy quote without an offer', async () => {
    const user = userEvent.setup();
    const onCreateOfferFromLegacyQuote = mock((_quote: Quote) => {});
    const legacyQuote = withSingleCandidate(
      { ...quotes[0], id: 'Q-LEGACY-ACCEPTED', status: 'accepted' },
      'Q-BEFORE-RENAME',
    );

    render(
      <ClientQuotesView
        quotes={[legacyQuote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
        onCreateOfferFromLegacyQuote={onCreateOfferFromLegacyQuote}
      />,
    );

    await openRowActions(user);
    await user.click(
      await screen.findByRole('button', { name: 'sales:clientQuotes.convertToOffer' }),
    );

    expect(onCreateOfferFromLegacyQuote).toHaveBeenCalledTimes(1);
    expect(onCreateOfferFromLegacyQuote.mock.calls[0][0].id).toBe('Q-LEGACY-ACCEPTED');
  });

  test('does not expose legacy conversion for an accepted multi-candidate family', async () => {
    const user = userEvent.setup();
    const quote = withSingleCandidate(
      { ...quotes[0], id: 'Q-CANDIDATE-ACCEPTED', status: 'accepted' },
      'candidate-a',
    );
    const [firstCandidate] = quote.candidates ?? [];
    if (!firstCandidate) throw new Error('Expected candidate fixture');
    quote.candidates = [
      firstCandidate,
      {
        ...firstCandidate,
        id: 'candidate-b',
        name: 'Variante B',
        position: 1,
      },
    ];

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
        onCreateOfferFromLegacyQuote={mock(() => {})}
      />,
    );

    await openRowActions(user);
    expect(
      screen.queryByRole('button', { name: 'sales:clientQuotes.convertToOffer' }),
    ).not.toBeInTheDocument();
  });

  test('keeps supplier-expired quote progression actions disabled', async () => {
    const user = userEvent.setup();
    const onUpdateQuote = mock((_id: string, _updates: QuoteMutation) => Promise.resolve());
    const onPromoteCandidate = mock((_quoteId: string, _candidateId: string) => Promise.resolve());

    const { rerender } = render(
      <ClientQuotesView
        quotes={[{ ...quotes[0], id: 'Q-BLOCKED-DRAFT', linkedSupplierQuoteExpired: true }]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={onUpdateQuote}
        onDeleteQuote={mock(() => Promise.resolve())}
        onPromoteCandidate={onPromoteCandidate}
      />,
    );

    await openRowActions(user);
    expect(
      await screen.findByRole('button', { name: 'sales:clientQuotes.markAsSent' }),
    ).toBeDisabled();

    rerender(
      <ClientQuotesView
        quotes={[
          {
            ...quotes[0],
            id: 'Q-BLOCKED-SENT',
            status: 'sent',
            linkedSupplierQuoteExpired: true,
          },
        ]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={onUpdateQuote}
        onDeleteQuote={mock(() => Promise.resolve())}
        onPromoteCandidate={onPromoteCandidate}
      />,
    );
    expect(
      await screen.findByRole('button', {
        name: 'sales:clientQuotes.candidates.chooseTitle',
      }),
    ).toBeDisabled();
    expect(onUpdateQuote).not.toHaveBeenCalled();
    expect(onPromoteCandidate).not.toHaveBeenCalled();
  });

  test('promotes the only candidate directly without opening the comparison dialog', async () => {
    const user = userEvent.setup();
    let finishPromotion = () => {};
    const onPromoteCandidate = mock(
      (_quoteId: string, _candidateId: string) =>
        new Promise<void>((resolve) => {
          finishPromotion = resolve;
        }),
    );
    const quote = withSingleCandidate(
      { ...quotes[0], id: 'Q-SINGLE-CANDIDATE', status: 'sent' },
      'candidate-only',
    );

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
        onPromoteCandidate={onPromoteCandidate}
      />,
    );

    await openRowActions(user);
    await user.click(
      await screen.findByRole('button', { name: 'sales:clientQuotes.candidates.chooseTitle' }),
    );

    await waitFor(() =>
      expect(onPromoteCandidate).toHaveBeenCalledWith('Q-SINGLE-CANDIDATE', 'candidate-only'),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await openRowActions(user);
    const deny = screen.getByRole('button', { name: 'sales:clientQuotes.markAsDenied' });
    const restore = screen.getByRole('button', { name: 'sales:clientQuotes.restoreQuote' });
    expect(deny).toBeDisabled();
    expect(restore).toBeDisabled();

    await act(async () => finishPromotion());
    await waitFor(() => expect(deny).not.toBeDisabled());
  });

  test('opens candidate comparison when at least one variant remains promotable', async () => {
    const user = userEvent.setup();
    const quote = withSingleCandidate(
      {
        ...quotes[0],
        id: 'Q-MIXED-SUPPLIER-EXPIRY',
        status: 'sent',
        linkedSupplierQuoteExpired: true,
      },
      'candidate-a',
    );
    const [firstCandidate] = quote.candidates ?? [];
    if (!firstCandidate) throw new Error('Expected candidate fixture');
    quote.candidates = [
      {
        ...firstCandidate,
        linkedSupplierQuoteExpired: false,
        isExpired: false,
      },
      {
        ...firstCandidate,
        id: 'candidate-b',
        name: 'Variante B',
        position: 1,
        linkedSupplierQuoteExpired: true,
        isExpired: false,
      },
    ];

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
        onPromoteCandidate={mock(() => Promise.resolve())}
      />,
    );

    await openRowActions(user);
    const choose = await screen.findByRole('button', {
      name: 'sales:clientQuotes.candidates.chooseTitle',
    });
    expect(choose).not.toBeDisabled();
    await user.click(choose);

    const comparisonDialog = await screen.findByRole('dialog');
    expect(within(comparisonDialog).getByText('Variante A')).toBeInTheDocument();
    expect(within(comparisonDialog).getByText('Variante B')).toBeInTheDocument();
  });

  test('promotes the selected candidate of a sent quote through the dedicated action', async () => {
    const user = userEvent.setup();
    const onPromoteCandidate = mock((_quoteId: string, _candidateId: string) => Promise.resolve());

    const staleQuote: Quote = {
      ...quotes[0],
      id: 'Q-LOCAL-MOL',
      status: 'sent',
      items: [
        {
          ...quotes[0].items[0],
          quoteId: 'Q-LOCAL-MOL',
          productId: null as unknown as string,
          unitPrice: 100,
          productMolPercentage: 0,
          supplierQuoteId: 'SQ-1',
          supplierQuoteItemId: 'SQI-1',
          supplierQuoteSupplierName: 'Supplier',
          supplierQuoteUnitPrice: 80,
        },
      ],
    };
    staleQuote.candidates = [
      {
        id: 'candidate-a',
        quoteId: staleQuote.id,
        name: 'Variante A',
        position: 0,
        state: 'active',
        items: staleQuote.items.map((item) => ({ ...item, candidateId: 'candidate-a' })),
        paymentTerms: staleQuote.paymentTerms,
        discount: staleQuote.discount,
        discountType: staleQuote.discountType,
        expirationDate: staleQuote.expirationDate,
        communicationChannelId: staleQuote.communicationChannelId,
        notes: 'Customer prefers annual billing.',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    const [firstCandidate] = staleQuote.candidates;
    if (!firstCandidate) throw new Error('Expected candidate fixture');
    staleQuote.candidates.push({
      ...firstCandidate,
      id: 'candidate-b',
      name: 'Variante B',
      position: 1,
      items: firstCandidate.items.map((item) => ({
        ...item,
        id: `${item.id}-b`,
        candidateId: 'candidate-b',
      })),
    });

    render(
      <ClientQuotesView
        quotes={[staleQuote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
        onPromoteCandidate={onPromoteCandidate}
      />,
    );

    await openRowActions(user);
    await user.click(
      await screen.findByRole('button', { name: 'sales:clientQuotes.candidates.chooseTitle' }),
    );
    const comparisonDialog = await screen.findByRole('dialog');
    expect(comparisonDialog.querySelector('[data-slot="modal-content"]')).toHaveClass('max-w-6xl');
    expect(within(comparisonDialog).getAllByText('sales:clientQuotes.molLabel')).toHaveLength(2);
    expect(within(comparisonDialog).getAllByText('11,11%')).toHaveLength(2);
    expect(within(comparisonDialog).getAllByText('sales:clientQuotes.notesLabel')).toHaveLength(2);
    expect(within(comparisonDialog).getAllByText('Customer prefers annual billing.')).toHaveLength(
      2,
    );
    await user.click(
      await screen.findByRole('button', { name: 'sales:clientQuotes.candidates.promote' }),
    );

    await waitFor(() =>
      expect(onPromoteCandidate).toHaveBeenCalledWith('Q-LOCAL-MOL', 'candidate-a'),
    );
  });
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

  test('a valid sent quote stays fully read-only — no submit button, date field disabled', async () => {
    const user = userEvent.setup();
    renderQuote({
      ...quotes[0],
      id: 'Q-SENT',
      status: 'sent',
      expirationDate: '2999-12-31',
    });

    await waitForSavedViewsLoad();
    await user.click(screen.getByText('Q-SENT'));
    await screen.findByRole('button', { name: 'common:buttons.cancel' });
    // The extend-only submit path is for EXPIRED quotes; exposing it on valid sent quotes let a
    // no-op "Update" click write needless version snapshots and audit rows.
    expect(screen.queryByRole('button', { name: 'sales:clientQuotes.updateQuote' })).toBeNull();
    expect(document.getElementById('client-quote-expiration-date')).toBeDisabled();
    expect(screen.getByText('sales:clientQuotes.readOnlyStatus')).toBeTruthy();
  });

  test('shows an enabled restore-to-draft button next to the read-only badge for sent quotes', async () => {
    const user = userEvent.setup();
    const onUpdateQuote = mock(() => Promise.resolve());
    render(
      <ClientQuotesView
        quotes={[
          {
            ...quotes[0],
            id: 'Q-SENT-RESTORE',
            status: 'sent',
            expirationDate: '2999-12-31',
          },
        ]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={onUpdateQuote}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    await waitForSavedViewsLoad();
    await user.click(screen.getByText('Q-SENT-RESTORE'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('sales:clientQuotes.readOnlyStatus')).toBeTruthy();
    const restore = within(dialog).getByTestId('client-quote-modal-restore-draft');
    expect(restore).not.toBeDisabled();

    await user.click(restore);
    await waitFor(() =>
      expect(onUpdateQuote).toHaveBeenCalledWith('Q-SENT-RESTORE', { status: 'draft' }),
    );
    await waitFor(() => {
      expect(within(dialog).queryByTestId('client-quote-modal-restore-draft')).toBeNull();
      expect(within(dialog).queryByText('sales:clientQuotes.readOnlyStatus')).toBeNull();
      expect(within(dialog).getByText('sales:clientQuotes.editQuote')).toBeTruthy();
    });
  });

  test('disables modal restore-to-draft for accepted quotes', async () => {
    const user = userEvent.setup();
    renderQuote({
      ...quotes[0],
      id: 'Q-ACCEPTED',
      status: 'accepted',
      expirationDate: '2999-12-31',
    });

    await waitForSavedViewsLoad();
    await user.click(screen.getByText('Q-ACCEPTED'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('client-quote-modal-restore-draft')).toBeDisabled();
  });

  test('modal restore uses candidate rollback when the linked offer is still draft', async () => {
    const user = userEvent.setup();
    const onRollbackPromotion = mock(() => Promise.resolve());
    render(
      <ClientQuotesView
        quotes={[
          {
            ...quotes[0],
            id: 'Q-OFFERED-MODAL',
            status: 'offer',
            expirationDate: '2099-12-31',
            linkedOfferId: 'off-1',
            selectedCandidateId: 'qc-selected',
          },
        ]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onRollbackPromotion={onRollbackPromotion}
        onDeleteQuote={mock(() => Promise.resolve())}
        quoteOfferStatuses={{ 'Q-OFFERED-MODAL': 'draft' }}
      />,
    );

    await waitForSavedViewsLoad();
    await user.click(screen.getByText('Q-OFFERED-MODAL'));
    const dialog = await screen.findByRole('dialog');
    const restore = within(dialog).getByTestId('client-quote-modal-restore-draft');
    expect(restore).not.toBeDisabled();
    await user.click(restore);
    await waitFor(() => {
      expect(onRollbackPromotion).toHaveBeenCalledWith('Q-OFFERED-MODAL');
    });
  });

  test('an expired sent quote keeps only the expiration date editable', async () => {
    const user = userEvent.setup();
    renderQuote({
      ...quotes[0],
      id: 'Q-EXPIRED-SENT',
      status: 'sent',
      expirationDate: '2000-01-01',
    });

    await waitForSavedViewsLoad();
    await user.click(screen.getByText('Q-EXPIRED-SENT'));
    await screen.findByRole('button', { name: 'common:buttons.cancel' });
    expect(document.getElementById('client-quote-expiration-date')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'sales:clientQuotes.updateQuote' })).toBeTruthy();
    expect(screen.getByText('sales:clientQuotes.readOnlyExpired')).toBeTruthy();
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

  test('shows a header "view offer" action for a quote linked to an offer', async () => {
    const user = userEvent.setup();
    const onViewOffers = mock(() => {});
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
        onViewOffers={onViewOffers}
      />,
    );

    await waitForSavedViewsLoad();
    await user.click(screen.getByText('Q-OFFERED'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('sales:clientQuotes.linkedOffer')).toBeNull();
    const viewButton = within(dialog).getByRole('button', {
      name: 'sales:clientQuotes.viewLinkedOffer',
    });
    expect(viewButton.getAttribute('data-variant')).toBe('outline');

    await user.click(viewButton);
    expect(onViewOffers).toHaveBeenCalledWith('Q-OFFERED');
  });

  test('uses candidate rollback for an offer quote whose linked offer is still draft', async () => {
    const user = userEvent.setup();
    const onRollbackPromotion = mock(() => Promise.resolve());
    render(
      <ClientQuotesView
        quotes={[
          {
            ...quotes[0],
            id: 'Q-OFFERED',
            status: 'offer',
            expirationDate: '2099-12-31',
            linkedOfferId: 'off-1',
            selectedCandidateId: 'qc-selected',
          },
        ]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onRollbackPromotion={onRollbackPromotion}
        onDeleteQuote={mock(() => Promise.resolve())}
        quoteOfferStatuses={{ 'Q-OFFERED': 'draft' }}
      />,
    );

    await openRowActions(user);
    const restore = await screen.findByRole('button', { name: 'sales:clientQuotes.restoreQuote' });
    expect(restore).not.toBeDisabled();
    await user.click(restore);
    await waitFor(() => {
      expect(onRollbackPromotion).toHaveBeenCalledWith('Q-OFFERED');
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
            selectedCandidateId: 'qc-selected',
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
            selectedCandidateId: 'qc-selected',
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
    fireEvent.click(await openRowDeleteButton(dialog));
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

    fireEvent.click(await openRowDeleteButton(dialog));
    clickLineDeleteCancel(await findLineDeleteConfirm());

    await waitFor(() => {
      expect(screen.queryByText('sales:clientQuotes.removeProductTitle')).not.toBeInTheDocument();
    });
    expect(rowDeleteButtons(dialog)).toHaveLength(rowDeletes.length);
  });
});

describe('<ClientQuotesView /> candidate variants', () => {
  const openCreateQuote = async () => {
    const user = userEvent.setup();
    render(
      <ClientQuotesView
        quotes={[]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        communicationChannels={communicationChannels}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'sales:clientQuotes.createNewQuote' }));
    return user;
  };

  test('chooses the first unused default variant name after renames', async () => {
    const user = await openCreateQuote();

    await user.click(screen.getByRole('button', { name: 'sales:clientQuotes.candidates.addMenu' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'sales:clientQuotes.candidates.add' }),
    );
    await user.dblClick(screen.getByRole('tab', { name: /Variante B/ }));
    const nameInput = screen.getByLabelText('sales:clientQuotes.candidates.name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Variante C');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('tab', { name: /Variante A/ }));
    await user.click(screen.getByRole('button', { name: 'sales:clientQuotes.candidates.addMenu' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'sales:clientQuotes.candidates.add' }),
    );

    expect(screen.getByRole('tab', { name: /Variante B/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Variante C/ })).toBeInTheDocument();
  });

  test('shows the variants section heading and information tooltip above the tabs', async () => {
    await openCreateQuote();

    const heading = screen.getByRole('heading', {
      name: /sales:clientQuotes.candidates.column/,
    });
    const tabs = screen.getByTestId('quote-candidate-tabs-scroll');
    const tooltip = screen.getByRole('button', { name: 'sales:fieldInfo.variants' });

    expect(heading.nextElementSibling).toBe(tabs);
    expect(tooltip.querySelector('.fa-circle-info')).toBeInTheDocument();
  });

  test('keeps validation errors visible when renaming the active candidate', async () => {
    const user = await openCreateQuote();

    await user.click(screen.getByRole('button', { name: 'sales:clientQuotes.createQuote' }));
    expect(screen.getByText('sales:clientQuotes.errors.clientRequired')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'sales:clientQuotes.candidates.rename' }));

    expect(screen.getByText('sales:clientQuotes.errors.clientRequired')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Variante A/ })).toHaveAttribute('tabindex', '-1');
  });

  test('manages browser-style candidate tabs from inline and contextual actions', async () => {
    const user = await openCreateQuote();

    expect(screen.getByText('Variante A')).toBeInTheDocument();
    expect(screen.getByTestId('quote-candidate-tabs-scroll')).toHaveClass(
      'overflow-x-auto',
      'overflow-y-hidden',
      'pt-1',
    );
    const addVariantButton = screen.getByRole('button', {
      name: 'sales:clientQuotes.candidates.addMenu',
    });
    expect(addVariantButton).toHaveAttribute('data-variant', 'ghost');
    expect(addVariantButton).not.toHaveClass('border');
    expect(addVariantButton).not.toHaveClass('rounded-t-lg');
    await user.click(addVariantButton);
    expect(
      await screen.findByRole('menuitem', { name: 'sales:clientQuotes.candidates.duplicate' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'sales:clientQuotes.candidates.add' }));
    expect(screen.getByText('Variante B')).toBeInTheDocument();
    const activeTabFrame = screen.getByRole('tab', { name: /Variante B/ }).parentElement;
    expect(activeTabFrame).toHaveClass('border-x', 'border-t', 'border-border');
    expect(activeTabFrame).not.toHaveClass('border-t-2');
    expect(activeTabFrame).not.toHaveClass('border-t-primary');
    expect(activeTabFrame).not.toHaveClass('shadow-sm');
    expect(screen.getByRole('tab', { name: /Variante A/ }).parentElement).toHaveClass(
      'border-border',
    );

    const renameButtons = screen.getAllByRole('button', {
      name: 'sales:clientQuotes.candidates.rename',
    });
    await user.click(renameButtons.at(-1) as HTMLButtonElement);
    const nameInput = screen.getByLabelText('sales:clientQuotes.candidates.name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Premium');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: /Premium/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'sales:clientQuotes.candidates.addMenu' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'sales:clientQuotes.candidates.duplicate' }),
    );
    expect(screen.getByRole('tab', { name: /Variante B/ })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);

    fireEvent.contextMenu(screen.getByRole('tab', { name: /Variante A/ }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'sales:clientQuotes.candidates.rename' }),
    );
    const contextualNameInput = await screen.findByLabelText('sales:clientQuotes.candidates.name');
    await user.clear(contextualNameInput);
    await user.type(contextualNameInput, 'Standard');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: /Standard/ })).toBeInTheDocument();

    const premiumTab = screen.getByRole('tab', { name: /Premium/ });
    await user.click(
      within(premiumTab.parentElement as HTMLElement).getByRole('button', {
        name: 'sales:clientQuotes.candidates.delete',
      }),
    );
    expect(screen.getByText('sales:clientQuotes.candidates.removeTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('line-delete-confirm-btn'));
    expect(screen.queryByRole('tab', { name: /Premium/ })).not.toBeInTheDocument();
  });
});

describe('<ClientQuotesView /> localized line amounts', () => {
  test('formats line cost, margin, and revenue with Italian separators', async () => {
    const quoteId = 'Q-LOCALE-AMOUNTS';
    const quote: Quote = {
      ...quotes[0],
      id: quoteId,
      items: [
        {
          ...quotes[0].items[0],
          id: 'locale-line',
          quoteId,
          quantity: 1,
          unitPrice: 2000,
          productCost: 1234.5,
          productMolPercentage: 38.275,
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
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );
    fireEvent.click(screen.getByText(quoteId));

    await waitFor(() => expect(screen.getAllByText('1.234,50 EUR').length).toBeGreaterThan(0));
    const marginValues = screen.getAllByText('765,50 EUR');
    expect(marginValues.length).toBeGreaterThan(0);
    expect(
      marginValues.some((value) => value.closest('td')?.className.includes('text-emerald-600')),
    ).toBe(true);
    expect(screen.getAllByText('2.000,00 EUR').length).toBeGreaterThan(0);
  });
});

describe('<ClientQuotesView /> appended item visibility', () => {
  test('keeps a newly added row visible under a persisted product filter', async () => {
    localStorage.clear();
    localStorage.setItem(
      'praetor_table_customviews_sales_clientquotes_items',
      JSON.stringify([
        {
          id: 'filtered-products',
          name: 'Product 1 only',
          hiddenColIds: [],
          sortState: null,
          filterState: { product: ['Product 1'] },
        },
      ]),
    );
    localStorage.setItem('praetor_table_activeview_sales_clientquotes_items', 'filtered-products');
    const quoteId = 'Q-APPEND-FILTERED';
    const items = Array.from({ length: 2 }, (_, index): Quote['items'][number] => ({
      ...quotes[0].items[0],
      id: `filtered-item-${index + 1}`,
      quoteId,
      productName: `Product ${index + 1}`,
      quantity: 1,
    }));
    const quote: Quote = { ...quotes[0], id: quoteId, items };

    render(
      <ClientQuotesView
        quotes={[quote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        communicationChannels={communicationChannels}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );
    fireEvent.click(screen.getByText(quoteId));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).queryByText('Product 2')).not.toBeInTheDocument());

    fireEvent.click(within(dialog).getByRole('button', { name: 'sales:clientQuotes.addProduct' }));

    await waitFor(() => {
      const quantityInputs = within(dialog).getAllByRole('textbox', {
        name: 'sales:clientQuotes.qty',
      });
      expect(quantityInputs.some((input) => (input as HTMLInputElement).value === '')).toBe(true);
    });
  });

  test('moves to the page containing a sixth item immediately after adding it', async () => {
    localStorage.clear();
    const quoteId = 'Q-APPEND-PAGE';
    const items = Array.from({ length: 5 }, (_, index): Quote['items'][number] => ({
      ...quotes[0].items[0],
      id: `existing-item-${index + 1}`,
      quoteId,
      productName: `Product ${index + 1}`,
      quantity: 1,
    }));
    const quote: Quote = { ...quotes[0], id: quoteId, items };

    render(
      <ClientQuotesView
        quotes={[quote]}
        clients={clients}
        products={[]}
        supplierQuotes={[]}
        communicationChannels={communicationChannels}
        currency="EUR"
        onAddQuote={mock(() => Promise.resolve())}
        onUpdateQuote={mock(() => Promise.resolve())}
        onDeleteQuote={mock(() => Promise.resolve())}
      />,
    );
    fireEvent.click(screen.getByText(quoteId));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1 / 1')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'sales:clientQuotes.addProduct' }));

    await waitFor(() => expect(within(dialog).getByText('2 / 2')).toBeInTheDocument());
    await waitFor(() => {
      const quantityInputs = within(dialog).getAllByRole('textbox', {
        name: 'sales:clientQuotes.qty',
      });
      expect(quantityInputs).toHaveLength(1);
      expect(quantityInputs[0]).toHaveValue('');
    });
  });
});
