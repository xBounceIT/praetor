import { afterEach, describe, expect, mock, spyOn } from 'bun:test';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Client, Product, Supplier, SupplierQuote } from '../../types';
import { addMonthsToDateOnly, getLocalDateString } from '../../utils/date';
import { installI18nMock } from '../helpers/i18n';
import { reactTest as test } from '../helpers/reactTest';
import { render } from '../helpers/render';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from './modalStylingTestUtils';

installI18nMock();

const supplierQuotesModule = await import('../../services/api/supplierQuotes');
const listAttachmentsMock = spyOn(
  supplierQuotesModule.supplierQuotesApi,
  'listAttachments',
).mockResolvedValue([]);
spyOn(supplierQuotesModule.supplierQuotesApi, 'listVersions').mockResolvedValue([]);

const SupplierQuotesView = (await import('../../components/sales/SupplierQuotesView')).default;

const supplier: Supplier = {
  id: 'sup-1',
  name: 'Acme Supplies',
};

const clients: Client[] = [
  { id: 'cli-1', name: 'Globex Corp' },
  { id: 'cli-2', name: 'Initech' },
];

const products: Product[] = [];

const buildQuote = (overrides: Partial<SupplierQuote>): SupplierQuote => ({
  id: 'SQ-base',
  description: 'Managed hardware procurement',
  supplierId: 'sup-1',
  supplierName: 'Acme Supplies',
  // Every supplier quote is associated with a customer (issue #777); default to one so edit/submit
  // fixtures pass the mandatory-customer check. Tests that need a client-less quote override these.
  clientId: 'cli-1',
  clientName: 'Globex Corp',
  items: [
    {
      id: 'sqi-1',
      quoteId: overrides.id ?? 'SQ-base',
      productName: 'Widget',
      quantity: 1,
      listPrice: 100,
      discountPercent: 0,
      unitPrice: 100,
      unitType: 'unit',
    },
  ],
  paymentTerms: 'immediate',
  communicationChannelId: 'qcc_email',
  communicationChannelName: 'Email',
  status: 'draft',
  expirationDate: '2026-12-31',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

const draft = buildQuote({ id: 'SQ-DRAFT', status: 'draft' });
const sent = buildQuote({ id: 'SQ-SENT', status: 'sent' });
const accepted = buildQuote({ id: 'SQ-ACCEPTED', status: 'accepted' });
const denied = buildQuote({ id: 'SQ-DENIED', status: 'denied' });
const acceptedWithOrder = buildQuote({
  id: 'SQ-ACCEPTED-ORDER',
  status: 'accepted',
  linkedOrderId: 'SO-100',
});

const baseProps = {
  quotes: [draft, sent, accepted, denied, acceptedWithOrder],
  suppliers: [supplier],
  clients,
  products,
  onAddQuote: () => Promise.resolve(draft),
  onUpdateQuote: () => {},
  onDeleteQuote: () => {},
  currency: 'EUR',
};

const openQuote = async (id: string) => {
  await act(async () => {
    fireEvent.click(screen.getByText(id));
    await Promise.resolve();
  });
};

afterEach(() => {
  // Modal sets body.style.overflow='hidden'; reset defensively even though we mock it.
  document.body.style.overflow = '';
});

describe('<SupplierQuotesView /> list columns', () => {
  test('renders description immediately after the quote code', () => {
    const { container } = render(<SupplierQuotesView {...baseProps} />);

    const headerLabels = Array.from(container.querySelectorAll('[data-column-header-label]')).map(
      (header) => header.textContent?.trim(),
    );

    expect(headerLabels.slice(0, 2)).toEqual([
      'sales:supplierQuotes.quoteCode',
      'sales:supplierQuotes.description',
    ]);
    expect(screen.getAllByText('Managed hardware procurement').length).toBeGreaterThan(0);
  });

  test('renders the communication channel column between payment terms and expiration', () => {
    const { container } = render(<SupplierQuotesView {...baseProps} />);

    const headerLabels = Array.from(container.querySelectorAll('[data-column-header-label]')).map(
      (header) => header.textContent?.trim(),
    );

    expect(headerLabels).toContain('sales:communicationChannels.fieldLabel');
    expect(headerLabels.indexOf('sales:supplierQuotes.paymentTerms')).toBeLessThan(
      headerLabels.indexOf('sales:communicationChannels.fieldLabel'),
    );
    expect(headerLabels.indexOf('sales:communicationChannels.fieldLabel')).toBeLessThan(
      headerLabels.indexOf('sales:supplierQuotes.expirationDate'),
    );
    expect(screen.getAllByText('Email').length).toBeGreaterThan(0);
  });
});

describe('<SupplierQuotesView /> description', () => {
  test('allows a free-text description while creating a quote', () => {
    render(<SupplierQuotesView {...baseProps} quotes={[]} />);
    fireEvent.click(screen.getByText('sales:supplierQuotes.addQuote'));

    const description = screen.getByRole('textbox', {
      name: 'sales:supplierQuotes.description',
    });
    fireEvent.change(description, { target: { value: 'Annual hardware procurement' } });

    expect(description).toBeEnabled();
    expect(description).toHaveValue('Annual hardware procurement');
    expect(description.closest('[data-slot="field"]')).toHaveClass('w-full');
    expect(description.closest('.grid')).toBeNull();
  });
});

describe('<SupplierQuotesView /> Duplicate row action', () => {
  test('opens an independent create draft from a historical ordered quote and saves no attachments', async () => {
    const user = userEvent.setup();
    const source = buildQuote({
      ...acceptedWithOrder,
      id: 'SQ-DUPLICATE-SOURCE',
      items: [
        {
          ...acceptedWithOrder.items[0],
          id: 'sqi-duplicate-source',
          quoteId: 'SQ-DUPLICATE-SOURCE',
          listPrice: 37.75,
          discountPercent: 15,
          unitPrice: 32.09,
          note: 'Keep this line note',
          durationMonths: 12,
          durationUnit: 'years',
        },
      ],
      notes: 'Keep these quote notes',
    });
    const created = buildQuote({ id: 'SQ-COPY', status: 'draft' });
    const onAddQuote = mock((_data: Partial<SupplierQuote>) => Promise.resolve(created));
    listAttachmentsMock.mockClear();

    render(
      <SupplierQuotesView
        {...baseProps}
        quotes={[source]}
        suppliers={[]}
        clients={[]}
        onAddQuote={onAddQuote}
      />,
    );

    const row = screen.getByText('SQ-DUPLICATE-SOURCE').closest('tr');
    if (!row) throw new Error('Expected supplier quote table row');
    await user.click(within(row).getByRole('button', { name: 'table.rowActions' }));
    await user.click(
      await screen.findByRole('button', { name: 'sales:supplierQuotes.duplicateQuote' }),
    );

    expect(onAddQuote).not.toHaveBeenCalled();
    expect(listAttachmentsMock).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('sales:supplierQuotes.newQuote')).toBeInTheDocument();
    expect(
      within(dialog).queryByText('sales:supplierQuotes.readOnlyLinked'),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('sales:supplierQuotes.quoteCode')).toHaveValue('');
    expect(document.getElementById('supplier-quote-supplier')).toHaveTextContent(
      source.supplierName,
    );
    await user.click(document.getElementById('supplier-quote-supplier') as HTMLElement);
    await user.click(await screen.findByRole('option', { name: source.supplierName }));
    if (!source.clientName) throw new Error('Expected linked customer name');
    expect(document.getElementById('supplier-quote-client')).toHaveTextContent(source.clientName);
    expect(within(dialog).getByText('supplierQuotes.attachments.dropHere')).toBeInTheDocument();
    const expectedExpiration = addMonthsToDateOnly(getLocalDateString(), 1);

    await user.click(within(dialog).getByText('common:buttons.save'));
    await waitFor(() => expect(onAddQuote).toHaveBeenCalledTimes(1));

    const payload = onAddQuote.mock.calls[0]?.[0] as Partial<SupplierQuote>;
    expect(payload.id).toBeUndefined();
    expect(payload.description).toBe(source.description);
    expect(payload.status).toBe('draft');
    expect(payload.expirationDate).toBe(expectedExpiration);
    expect(payload.supplierId).toBe(source.supplierId);
    expect(payload.supplierName).toBe(source.supplierName);
    expect(payload.clientId).toBe(source.clientId);
    expect(payload.paymentTerms).toBe(source.paymentTerms);
    expect(payload.communicationChannelId).toBe(source.communicationChannelId);
    expect(payload.notes).toBe(source.notes);
    expect(payload).not.toHaveProperty('linkedOrderId');
    expect(payload).not.toHaveProperty('linkedClientQuoteId');
    expect(payload).not.toHaveProperty('isStatusSynced');
    expect(payload.items).toHaveLength(1);
    expect(payload.items?.[0]?.id).toStartWith('temp-');
    expect(payload.items?.[0]?.id).not.toBe(source.items[0]?.id);
    expect(payload.items?.[0]?.quoteId).toBe('');
    expect(payload.items?.[0]?.listPrice).toBe(37.75);
    expect(payload.items?.[0]?.discountPercent).toBe(15);
    expect(payload.items?.[0]?.unitPrice).toBe(32.09);
    expect(payload.items?.[0]?.note).toBe('Keep this line note');
    expect(payload.items?.[0]?.durationMonths).toBe(12);
    expect(payload.items?.[0]?.durationUnit).toBe('years');
  });
});

describe('<SupplierQuotesView /> read-only gating', () => {
  test('clicking a draft row opens the modal in editable mode', async () => {
    render(<SupplierQuotesView {...baseProps} />);
    await openQuote('SQ-DRAFT');
    // Edit modal title and Update submit button are rendered.
    expect(screen.getByText('sales:supplierQuotes.editQuote')).toBeInTheDocument();
    expect(screen.getByText('common:buttons.update')).toBeInTheDocument();
    // Read-only banner is NOT shown.
    expect(screen.queryByText('sales:supplierQuotes.readOnlyStatus')).not.toBeInTheDocument();
    expect(screen.queryByText('sales:supplierQuotes.readOnlyLinked')).not.toBeInTheDocument();
  });

  test('clicking a sent row opens the modal in read-only mode', async () => {
    render(<SupplierQuotesView {...baseProps} />);
    await openQuote('SQ-SENT');
    expect(screen.getByText('sales:supplierQuotes.viewQuote')).toBeInTheDocument();
    expect(screen.queryByText('common:buttons.update')).not.toBeInTheDocument();
    expect(screen.getByText('sales:supplierQuotes.readOnlyStatus')).toBeInTheDocument();
  });

  test('clicking an accepted row (without linked order) opens the modal in read-only mode', async () => {
    render(<SupplierQuotesView {...baseProps} />);
    await openQuote('SQ-ACCEPTED');
    expect(screen.getByText('sales:supplierQuotes.viewQuote')).toBeInTheDocument();
    expect(screen.queryByText('common:buttons.update')).not.toBeInTheDocument();
    expect(screen.getByText('sales:supplierQuotes.readOnlyStatus')).toBeInTheDocument();
  });

  test('clicking a denied row opens the modal in read-only mode', async () => {
    render(<SupplierQuotesView {...baseProps} />);
    await openQuote('SQ-DENIED');
    expect(screen.getByText('sales:supplierQuotes.viewQuote')).toBeInTheDocument();
    expect(screen.queryByText('common:buttons.update')).not.toBeInTheDocument();
    expect(screen.getByText('sales:supplierQuotes.readOnlyStatus')).toBeInTheDocument();
  });

  test('clicking an accepted row with a linked order shows the linked-order banner', async () => {
    render(<SupplierQuotesView {...baseProps} />);
    await openQuote('SQ-ACCEPTED-ORDER');
    expect(screen.getByText('sales:supplierQuotes.viewQuote')).toBeInTheDocument();
    expect(screen.queryByText('common:buttons.update')).not.toBeInTheDocument();
    // Linked-order copy wins over the generic non-draft copy.
    expect(screen.getByText('sales:supplierQuotes.readOnlyLinked')).toBeInTheDocument();
    expect(screen.queryByText('sales:supplierQuotes.readOnlyStatus')).not.toBeInTheDocument();
  });
});

describe('<SupplierQuotesView /> supplier pricing chain', () => {
  test('renders the list-price, discount, and unit-cost columns on a draft quote', async () => {
    render(<SupplierQuotesView {...baseProps} />);
    await act(async () => fireEvent.click(screen.getByText('SQ-DRAFT')));
    expect(screen.getAllByText('sales:supplierQuotes.listPrice').length).toBeGreaterThan(0);
    expect(screen.getAllByText('sales:supplierQuotes.discountToUs').length).toBeGreaterThan(0);
    expect(screen.getAllByText('sales:supplierQuotes.unitCost').length).toBeGreaterThan(0);
  });

  test('editing list price and discount recomputes the net unit cost in the submit payload', async () => {
    const onUpdateQuote = mock((_id: string, _updates: Partial<SupplierQuote>) => {});
    render(<SupplierQuotesView {...baseProps} onUpdateQuote={onUpdateQuote} />);
    await act(async () => fireEvent.click(screen.getByText('SQ-DRAFT')));

    // List price starts at 100 (formatted to 2 decimals); there is one input per layout.
    const listPriceInputs = screen.getAllByDisplayValue('100,00');
    fireEvent.change(listPriceInputs[0], { target: { value: '200' } });
    // Discount starts at 0; qty shows "1", so "0" uniquely matches the discount inputs.
    const discountInputs = screen.getAllByDisplayValue('0');
    fireEvent.change(discountInputs[0], { target: { value: '10' } });

    await act(async () => fireEvent.click(screen.getByText('common:buttons.update')));

    expect(onUpdateQuote).toHaveBeenCalledTimes(1);
    const updates = onUpdateQuote.mock.calls[0]?.[1] as Partial<SupplierQuote>;
    const item = updates.items?.[0];
    expect(item?.listPrice).toBe(200);
    expect(item?.discountPercent).toBe(10);
    // 200 * (1 - 10/100) = 180
    expect(item?.unitPrice).toBe(180);
  });

  test('clamps a discount typed above 100% to 100 so the net cost never goes negative', async () => {
    const onUpdateQuote = mock((_id: string, _updates: Partial<SupplierQuote>) => {});
    render(<SupplierQuotesView {...baseProps} onUpdateQuote={onUpdateQuote} />);
    await act(async () => fireEvent.click(screen.getByText('SQ-DRAFT')));

    // SQ-DRAFT starts at listPrice 100, discount 0; "0" uniquely matches the discount inputs.
    const discountInputs = screen.getAllByDisplayValue('0');
    fireEvent.change(discountInputs[0], { target: { value: '150' } });

    await act(async () => fireEvent.click(screen.getByText('common:buttons.update')));

    expect(onUpdateQuote).toHaveBeenCalledTimes(1);
    const updates = onUpdateQuote.mock.calls[0]?.[1] as Partial<SupplierQuote>;
    const item = updates.items?.[0];
    // The 150% entry is blocked at 100%, and 100 * (1 - 100/100) = 0 (never negative).
    expect(item?.discountPercent).toBe(100);
    expect(item?.unitPrice).toBe(0);
  });

  test('rounds list price/discount to DB scale so the submitted net cost matches the server', async () => {
    const onUpdateQuote = mock((_id: string, _updates: Partial<SupplierQuote>) => {});
    render(<SupplierQuotesView {...baseProps} onUpdateQuote={onUpdateQuote} />);
    await act(async () => fireEvent.click(screen.getByText('SQ-DRAFT')));

    // A list price with >2 decimals must be rounded to the persisted scale (NUMERIC(_,2)) before
    // deriving the net cost, exactly as the server does — otherwise the UI would show/submit a net
    // cost the server would not store.
    const listPriceInputs = screen.getAllByDisplayValue('100,00');
    fireEvent.change(listPriceInputs[0], { target: { value: '10,005' } });
    const discountInputs = screen.getAllByDisplayValue('0');
    fireEvent.change(discountInputs[0], { target: { value: '10' } });

    await act(async () => fireEvent.click(screen.getByText('common:buttons.update')));

    const updates = onUpdateQuote.mock.calls[0]?.[1] as Partial<SupplierQuote>;
    const item = updates.items?.[0];
    // 10.005 → 10.01 at scale 2; the derived 9.009 keeps its fractional cent.
    expect(item?.listPrice).toBe(10.01);
    expect(item?.discountPercent).toBe(10);
    expect(item?.unitPrice).toBe(9.009);
  });

  test('rounds the discounted line total only after multiplying by quantity', async () => {
    const fractionalUnitCostQuote = buildQuote({
      id: 'SQ-FRACTIONAL-UNIT-COST',
      items: [
        {
          id: 'sqi-fractional-unit-cost',
          quoteId: 'SQ-FRACTIONAL-UNIT-COST',
          productName: 'Widget',
          quantity: 150,
          listPrice: 37.75,
          discountPercent: 15,
          // The API persists the derived cost with fractional cents; display formatting remains
          // at currency scale while the line total uses this precise stored value.
          unitPrice: 32.0875,
          unitType: 'unit',
        },
      ],
    });

    render(<SupplierQuotesView {...baseProps} quotes={[fractionalUnitCostQuote]} />);

    // 37.75 × (1 − 15/100) × 150 = 4813.125, rounded once to 4813.13.
    expect(screen.getByText('4.813,13 EUR')).toBeInTheDocument();

    await openQuote('SQ-FRACTIONAL-UNIT-COST');
    expect(screen.getAllByText('4.813,13 EUR').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('4.813,50 EUR')).not.toBeInTheDocument();
  });

  test('changing the quantity unit preserves list price and unit cost', async () => {
    const onUpdateQuote = mock((_id: string, _updates: Partial<SupplierQuote>) => {});
    render(<SupplierQuotesView {...baseProps} onUpdateQuote={onUpdateQuote} />);
    await openQuote('SQ-DRAFT');

    const unitSelector = screen
      .getAllByRole('combobox')
      .find((element) => element.textContent?.includes('sales:supplierQuotes.unit'));
    expect(unitSelector).toBeDefined();
    fireEvent.click(unitSelector as HTMLElement);
    const dayOption = screen
      .getAllByText('sales:supplierQuotes.day')
      .find((element) => element.tagName === 'SPAN');
    expect(dayOption).toBeDefined();
    fireEvent.click(dayOption as HTMLElement);

    await act(async () => fireEvent.click(screen.getByText('common:buttons.update')));

    const updates = onUpdateQuote.mock.calls[0]?.[1] as Partial<SupplierQuote>;
    expect(updates.items?.[0]).toEqual(
      expect.objectContaining({ unitType: 'days', listPrice: 100, unitPrice: 100 }),
    );
  });
});

describe('<SupplierQuotesView /> summary discount line', () => {
  const discountedQuote = buildQuote({
    id: 'SQ-DISCOUNT',
    status: 'draft',
    items: [
      {
        id: 'sqi-disc',
        quoteId: 'SQ-DISCOUNT',
        productName: 'Widget',
        quantity: 1,
        listPrice: 500,
        discountPercent: 15,
        unitPrice: 425,
        unitType: 'unit',
      },
    ],
  });

  test('shows the Sconto a noi line in the Riepilogo when a line has a discount', async () => {
    render(<SupplierQuotesView {...baseProps} quotes={[discountedQuote]} />);
    await openQuote('SQ-DISCOUNT');
    // Discount row label renders only when the aggregate discount is > 0.
    expect(screen.getByText('sales:supplierQuotes.discountAmount')).toBeInTheDocument();
    // Subtotale = gross 500, Sconto = 75, Totale = net 425.
    expect(screen.getByText('-75,00 EUR')).toBeInTheDocument();
  });

  test('omits the discount line when no line has a discount', async () => {
    render(<SupplierQuotesView {...baseProps} />);
    // SQ-DRAFT: listPrice 100, discount 0 → gross == net, no discount.
    await openQuote('SQ-DRAFT');
    expect(screen.queryByText('sales:supplierQuotes.discountAmount')).not.toBeInTheDocument();
  });
});

describe('<SupplierQuotesView /> deep-link filter', () => {
  test('pre-filters the table to the linked quote via the visible Codice column', () => {
    render(<SupplierQuotesView {...baseProps} quoteFilterId="SQ-SENT" />);

    // Only the linked quote is shown; the filter targets the visible id column
    // so the native column-filter funnel is rendered and stays clearable.
    expect(screen.getByText('SQ-SENT')).toBeInTheDocument();
    expect(screen.queryByText('SQ-DRAFT')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /table\.filters .*supplierQuotes\.quoteCode/i }),
    ).toBeInTheDocument();
  });

  test('shows every quote when there is no filter', () => {
    render(<SupplierQuotesView {...baseProps} />);
    expect(screen.getByText('SQ-DRAFT')).toBeInTheDocument();
    expect(screen.getByText('SQ-SENT')).toBeInTheDocument();
  });
});

// Opens the New-quote dialog and fills every required field (supplier, code, one line item).
// Pass a customer name to also pick it from the Customer combobox. The caller must render with
// `quotes={[]}` so the supplier/customer names are unambiguous (no table rows behind the modal).
const fillNewQuoteForm = (
  customerName?: string,
  listPrice: string | null = '100',
  quantity: string | null = '1',
) => {
  fireEvent.click(screen.getByText('sales:supplierQuotes.addQuote'));
  fireEvent.click(document.getElementById('supplier-quote-supplier') as HTMLElement);
  fireEvent.click(screen.getByText('Acme Supplies'));
  if (customerName) {
    fireEvent.click(document.getElementById('supplier-quote-client') as HTMLElement);
    fireEvent.click(screen.getByText(customerName));
  }
  fireEvent.change(document.getElementById('supplier-quote-code') as HTMLInputElement, {
    target: { value: 'SQ-NEW' },
  });
  fireEvent.click(screen.getByText('sales:supplierQuotes.addItem'));
  if (quantity !== null) {
    fireEvent.change(screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.qty' })[0], {
      target: { value: quantity },
    });
  }
  if (listPrice !== null) {
    fireEvent.change(
      screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.listPrice' })[0],
      {
        target: { value: listPrice },
      },
    );
  }
};

describe('<SupplierQuotesView /> required list price', () => {
  test('keeps new-item prices empty with a numeric placeholder and blocks save until entered', async () => {
    const onAddQuote = mock((_data: Partial<SupplierQuote>) => Promise.resolve(draft));
    render(<SupplierQuotesView {...baseProps} quotes={[]} onAddQuote={onAddQuote} />);

    fillNewQuoteForm('Globex Corp', null);

    const listPriceInputs = screen.getAllByRole('textbox', {
      name: 'sales:supplierQuotes.listPrice',
    });
    expect(listPriceInputs.length).toBeGreaterThan(0);
    for (const input of listPriceInputs) {
      expect(input).toHaveValue('');
      expect(input).toHaveAttribute('aria-required', 'true');
      expect(input).not.toHaveAttribute('required');
    }

    const saveButton = screen.getByText('common:buttons.save');
    fireEvent.submit(saveButton.closest('form') as HTMLFormElement);

    expect(onAddQuote).not.toHaveBeenCalled();
    expect(screen.getByText('sales:supplierQuotes.errors.listPriceRequired')).toBeInTheDocument();

    fireEvent.change(listPriceInputs[0], { target: { value: '125' } });
    expect(
      screen.queryByText('sales:supplierQuotes.errors.listPriceRequired'),
    ).not.toBeInTheDocument();
    fireEvent.click(saveButton);

    await waitFor(() => expect(onAddQuote).toHaveBeenCalledTimes(1));
    const payload = onAddQuote.mock.calls[0]?.[0] as Partial<SupplierQuote>;
    expect(payload.items?.[0]?.listPrice).toBe(125);
  });

  test('tracks rapidly added blank prices independently even when Date.now is unchanged', () => {
    const originalDateNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    try {
      const onAddQuote = mock((_data: Partial<SupplierQuote>) => Promise.resolve(draft));
      render(<SupplierQuotesView {...baseProps} quotes={[]} onAddQuote={onAddQuote} />);

      fillNewQuoteForm('Globex Corp', null);
      fireEvent.click(screen.getByText('sales:supplierQuotes.addItem'));

      const listPriceInputs = screen.getAllByRole('textbox', {
        name: 'sales:supplierQuotes.listPrice',
      });
      fireEvent.submit(screen.getByText('common:buttons.save').closest('form') as HTMLFormElement);
      fireEvent.change(listPriceInputs[0], { target: { value: '125' } });

      expect(onAddQuote).not.toHaveBeenCalled();
      expect(screen.getByText('sales:supplierQuotes.errors.listPriceRequired')).toBeInTheDocument();
    } finally {
      Date.now = originalDateNow;
    }
  });

  for (const separator of ['.', ',']) {
    test(`rejects a separator-only list price (${separator})`, () => {
      const onAddQuote = mock((_data: Partial<SupplierQuote>) => Promise.resolve(draft));
      render(<SupplierQuotesView {...baseProps} quotes={[]} onAddQuote={onAddQuote} />);

      fillNewQuoteForm('Globex Corp', separator);
      fireEvent.submit(screen.getByText('common:buttons.save').closest('form') as HTMLFormElement);

      expect(onAddQuote).not.toHaveBeenCalled();
      expect(screen.getByText('sales:supplierQuotes.errors.listPriceRequired')).toBeInTheDocument();
    });
  }

  test('shows only format-appropriate numeric placeholders on a new line', () => {
    render(<SupplierQuotesView {...baseProps} quotes={[]} />);

    fillNewQuoteForm('Globex Corp', null, null);

    expect(screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.qty' })[0]).toHaveValue('');
    expect(screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.qty' })[0]).toHaveAttribute(
      'placeholder',
      '0,00',
    );
    expect(
      screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.durationColumn' })[0],
    ).toHaveValue('');
    expect(
      screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.durationColumn' })[0],
    ).toHaveAttribute('placeholder', '0');
    expect(
      screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.listPrice' })[0],
    ).toHaveValue('');
    expect(
      screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.listPrice' })[0],
    ).toHaveAttribute('placeholder', '0,00');
    expect(
      screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.discountToUs' })[0],
    ).toHaveValue('');
    expect(
      screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.discountToUs' })[0],
    ).toHaveAttribute('placeholder', '0,00');
  });
});

// The customer link used to be optional (issue #759); issue #777 makes it mandatory.
describe('<SupplierQuotesView /> mandatory customer association (issue #777)', () => {
  test('marks the Customer field required and drops the empty "No customer" option', () => {
    render(<SupplierQuotesView {...baseProps} />);
    fireEvent.click(screen.getByText('sales:supplierQuotes.addQuote'));
    expect(screen.getByText('sales:supplierQuotes.newQuote')).toBeInTheDocument();

    // The Customer field now carries the required `*` indicator, like Supplier / Quote Code.
    const clientLabel = document.querySelector('label[for="supplier-quote-client"]');
    expect(clientLabel?.textContent).toContain('*');

    // With nothing linked the trigger shows the placeholder; the empty "No customer" clearing
    // option is gone (scoped by id since the same key is also the list column header behind it).
    const trigger = document.getElementById('supplier-quote-client');
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain('sales:supplierQuotes.selectClient');
    expect(trigger?.textContent).not.toContain('sales:supplierQuotes.noClient');
  });

  test('blocks updating an existing client-less draft until a customer is chosen', async () => {
    // A draft created while the link was optional (clientId null) must now name a customer to save.
    const clientless = buildQuote({
      id: 'SQ-NO-CLIENT',
      status: 'draft',
      clientId: null,
      clientName: null,
    });
    const onUpdateQuote = mock((_id: string, _updates: Partial<SupplierQuote>) => {});
    render(
      <SupplierQuotesView {...baseProps} quotes={[clientless]} onUpdateQuote={onUpdateQuote} />,
    );
    await openQuote('SQ-NO-CLIENT');

    // Supplier, code, and items are all valid — only the customer is missing.
    fireEvent.click(screen.getByText('common:buttons.update'));

    expect(onUpdateQuote).not.toHaveBeenCalled();
    expect(screen.getByText('sales:supplierQuotes.errors.clientRequired')).toBeInTheDocument();
  });

  test('blocks saving a NEW quote when no customer is selected', () => {
    const onAddQuote = mock((_data: Partial<SupplierQuote>) => Promise.resolve(draft));
    // No table rows so the supplier name is unambiguous in the combobox.
    render(<SupplierQuotesView {...baseProps} quotes={[]} onAddQuote={onAddQuote} />);

    // Fill every required field except the customer.
    fillNewQuoteForm();
    fireEvent.click(screen.getByText('common:buttons.save'));

    // The create path is blocked and the customer-required error surfaces.
    expect(onAddQuote).not.toHaveBeenCalled();
    expect(screen.getByText('sales:supplierQuotes.errors.clientRequired')).toBeInTheDocument();
  });

  test('saves a new quote once a customer is selected', async () => {
    const onAddQuote = mock((_data: Partial<SupplierQuote>) => Promise.resolve(draft));
    // No table rows (quotes: []) so the supplier/customer names are unambiguous in the combobox.
    render(<SupplierQuotesView {...baseProps} quotes={[]} onAddQuote={onAddQuote} />);

    fillNewQuoteForm('Globex Corp');
    fireEvent.click(screen.getByText('common:buttons.save'));

    await waitFor(() => expect(onAddQuote).toHaveBeenCalledTimes(1));
    const payload = onAddQuote.mock.calls[0]?.[0] as Partial<SupplierQuote>;
    expect(payload.clientId).toBe('cli-1');
    expect(payload.clientName).toBe('Globex Corp');
  });
});

describe('<SupplierQuotesView /> linked customer display', () => {
  test('shows the linked customer name in the list', () => {
    const withClient = buildQuote({
      id: 'SQ-CLIENT',
      status: 'draft',
      clientId: 'cli-1',
      clientName: 'Globex Corp',
    });
    render(<SupplierQuotesView {...baseProps} quotes={[withClient]} />);
    const row = screen.getByText('SQ-CLIENT').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Globex Corp')).toBeInTheDocument();
  });

  test('pre-selects the linked customer when editing a quote', async () => {
    const withClient = buildQuote({
      id: 'SQ-EDIT-CLIENT',
      status: 'draft',
      clientId: 'cli-2',
      clientName: 'Initech',
    });
    render(<SupplierQuotesView {...baseProps} quotes={[withClient]} />);
    await openQuote('SQ-EDIT-CLIENT');
    expect(screen.getByText('sales:supplierQuotes.editQuote')).toBeInTheDocument();
    // The customer select trigger reflects the linked client's name (scoped by id; the list row
    // behind the modal also renders "Initech").
    const trigger = document.getElementById('supplier-quote-client');
    expect(trigger?.textContent).toContain('Initech');
  });

  test('shows the stored customer name when the linked client is absent from the options', async () => {
    // The /clients list is user-scoped and does not include the linked client; the select must
    // still surface the quote's stored clientName rather than the empty placeholder.
    const withScopedOutClient = buildQuote({
      id: 'SQ-SCOPED-CLIENT',
      status: 'draft',
      clientId: 'cli-hidden',
      clientName: 'Hidden Customer',
    });
    render(<SupplierQuotesView {...baseProps} quotes={[withScopedOutClient]} />);
    await openQuote('SQ-SCOPED-CLIENT');
    const trigger = document.getElementById('supplier-quote-client');
    expect(trigger?.textContent).toContain('Hidden Customer');
    expect(trigger?.textContent).not.toContain('sales:supplierQuotes.selectClient');
  });
});

describe('<SupplierQuotesView /> line item duration (issue #776)', () => {
  const daysLineQuote = buildQuote({
    id: 'SQ-DURATION',
    status: 'draft',
    items: [
      {
        id: 'sqi-dur',
        quoteId: 'SQ-DURATION',
        productName: 'Managed service',
        quantity: 2,
        listPrice: 100,
        discountPercent: 0,
        unitPrice: 100,
        // Time-based line (days) → duration is editable, unlike the default "unit" lines.
        unitType: 'days',
        durationMonths: 3,
        durationUnit: 'months',
      },
    ],
  });

  test('renders the Durata column and an editable duration for a time-based line', async () => {
    render(<SupplierQuotesView {...baseProps} quotes={[daysLineQuote]} />);
    await openQuote('SQ-DURATION');
    // The Durata column header renders once a line item exists...
    expect(screen.getAllByText('sales:supplierQuotes.durationColumn').length).toBeGreaterThan(0);
    // ...and the row carries a duration input reflecting the stored value (3 months).
    const durationInputs = screen
      .getAllByRole('textbox', { name: 'sales:supplierQuotes.durationColumn' })
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs[0].value).toBe('3');
  });

  test('scales the quote total by the line duration', () => {
    render(<SupplierQuotesView {...baseProps} quotes={[daysLineQuote]} />);
    // Total column = unitPrice 100 × quantity 2 × durationMonths 3 = 600.00
    // (without the duration multiplier it would be 200.00).
    expect(screen.getAllByText('600,00 EUR').length).toBeGreaterThan(0);
    expect(screen.queryByText('200,00 EUR')).not.toBeInTheDocument();
  });

  test('prices a years duration using the displayed year value', () => {
    const yearsQuote = buildQuote({
      id: 'SQ-DURATION-YEARS',
      status: 'draft',
      items: [
        {
          ...daysLineQuote.items[0],
          id: 'sqi-years',
          quoteId: 'SQ-DURATION-YEARS',
          durationMonths: 24,
          durationUnit: 'years',
        },
      ],
    });

    render(<SupplierQuotesView {...baseProps} quotes={[yearsQuote]} />);
    // 24 canonical months display as 2 years: 100 × 2 × 2 = 400.
    expect(screen.getAllByText('400,00 EUR').length).toBeGreaterThan(0);
  });

  test('renders an editable duration for a unit-measured line (duration applies to every type)', async () => {
    // SQ-DRAFT's sample item is unitType "unit". Under the new model duration applies to every line
    // type (issue #775) — the cell shows the editable value + selector, not a static N/A.
    render(<SupplierQuotesView {...baseProps} />);
    await openQuote('SQ-DRAFT');
    expect(screen.queryAllByText('common:labels.notApplicable')).toHaveLength(0);
    const durationInputs = screen
      .getAllByRole('textbox', { name: 'sales:supplierQuotes.durationColumn' })
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
  });

  test('treats a line with durationUnit "na" as no-duration (x1) and disables its value input', async () => {
    const naQuote = buildQuote({
      id: 'SQ-DUR-NA',
      status: 'draft',
      items: [
        {
          id: 'sqi-na',
          quoteId: 'SQ-DUR-NA',
          productName: 'Managed service',
          quantity: 2,
          listPrice: 100,
          discountPercent: 0,
          unitPrice: 100,
          unitType: 'days',
          // N/A duration: the stored months must never multiply the total (issue #775).
          durationMonths: 3,
          durationUnit: 'na',
        },
      ],
    });
    render(<SupplierQuotesView {...baseProps} quotes={[naQuote]} />);
    await act(async () => fireEvent.click(screen.getByText('SQ-DUR-NA')));
    // 2 × 100 × 1 (na) = 200.00 — not 600.00, even though durationMonths is 3.
    expect(screen.getAllByText('200,00 EUR').length).toBeGreaterThan(0);
    expect(screen.queryByText('600,00 EUR')).not.toBeInTheDocument();
    // The value input is disabled while the unit is N/A; the selector stays usable.
    const durationInputs = screen
      .getAllByRole('textbox', { name: 'sales:supplierQuotes.durationColumn' })
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs.every((el) => el.disabled)).toBe(true);
  });

  test('editing the duration updates the submitted multiplier', async () => {
    const onUpdateQuote = mock((_id: string, _updates: Partial<SupplierQuote>) => {});
    const editableQuote = buildQuote({
      id: 'SQ-DUR-EDIT',
      status: 'draft',
      items: [
        {
          id: 'sqi-edit',
          quoteId: 'SQ-DUR-EDIT',
          productName: 'Managed service',
          quantity: 2,
          listPrice: 100,
          discountPercent: 0,
          unitPrice: 100,
          unitType: 'days',
          durationMonths: 1,
          durationUnit: 'months',
        },
      ],
    });
    render(
      <SupplierQuotesView {...baseProps} quotes={[editableQuote]} onUpdateQuote={onUpdateQuote} />,
    );
    await act(async () => fireEvent.click(screen.getByText('SQ-DUR-EDIT')));

    const durationInputs = screen
      .getAllByRole('textbox', { name: 'sales:supplierQuotes.durationColumn' })
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    fireEvent.change(durationInputs[0], { target: { value: '4' } });

    await act(async () => fireEvent.click(screen.getByText('common:buttons.update')));

    expect(onUpdateQuote).toHaveBeenCalledTimes(1);
    const updates = onUpdateQuote.mock.calls[0]?.[1] as Partial<SupplierQuote>;
    expect(updates.items?.[0]?.durationMonths).toBe(4);
    expect(updates.items?.[0]?.durationUnit).toBe('months');
  });

  test('marks an added row with the legacy document pricing semantics', async () => {
    const onUpdateQuote = mock((_id: string, _updates: Partial<SupplierQuote>) => {});
    const legacyQuote = buildQuote({
      id: 'SQ-LEGACY-ADD',
      status: 'draft',
      items: [
        {
          ...daysLineQuote.items[0],
          id: 'sqi-legacy',
          quoteId: 'SQ-LEGACY-ADD',
          pricingSemanticsVersion: 1,
        },
      ],
    });
    render(
      <SupplierQuotesView {...baseProps} quotes={[legacyQuote]} onUpdateQuote={onUpdateQuote} />,
    );
    await openQuote('SQ-LEGACY-ADD');

    fireEvent.click(screen.getByText('sales:supplierQuotes.addItem'));
    fireEvent.change(screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.qty' })[1], {
      target: { value: '1' },
    });
    fireEvent.change(
      screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.listPrice' })[1],
      {
        target: { value: '100' },
      },
    );
    await act(async () => fireEvent.click(screen.getByText('common:buttons.update')));

    expect(onUpdateQuote).toHaveBeenCalledTimes(1);
    const updates = onUpdateQuote.mock.calls[0]?.[1] as Partial<SupplierQuote>;
    expect(updates.items?.[1]?.pricingSemanticsVersion).toBe(1);
  });

  test("submits each line's stored duration verbatim (no unit-line coercion)", async () => {
    const onUpdateQuote = mock((_id: string, _updates: Partial<SupplierQuote>) => {});
    const mixedQuote = buildQuote({
      id: 'SQ-DUR-MIX',
      status: 'draft',
      items: [
        {
          id: 'sqi-days',
          quoteId: 'SQ-DUR-MIX',
          productName: 'Managed service',
          quantity: 1,
          listPrice: 100,
          discountPercent: 0,
          unitPrice: 100,
          unitType: 'days',
          durationMonths: 3,
          durationUnit: 'months',
        },
        {
          id: 'sqi-unit',
          quoteId: 'SQ-DUR-MIX',
          productName: 'Widget',
          quantity: 1,
          listPrice: 50,
          discountPercent: 0,
          unitPrice: 50,
          // Unit lines are no longer coerced — duration applies to every type now (issue #775),
          // so the stored value/unit must round-trip unchanged on submit.
          unitType: 'unit',
          durationMonths: 24,
          durationUnit: 'years',
        },
      ],
    });
    render(
      <SupplierQuotesView {...baseProps} quotes={[mixedQuote]} onUpdateQuote={onUpdateQuote} />,
    );
    await act(async () => fireEvent.click(screen.getByText('SQ-DUR-MIX')));
    await act(async () => fireEvent.click(screen.getByText('common:buttons.update')));

    expect(onUpdateQuote).toHaveBeenCalledTimes(1);
    const updates = onUpdateQuote.mock.calls[0]?.[1] as Partial<SupplierQuote>;
    expect(updates.items?.[0]).toEqual(
      expect.objectContaining({ durationMonths: 3, durationUnit: 'months' }),
    );
    expect(updates.items?.[1]).toEqual(
      expect.objectContaining({ durationMonths: 24, durationUnit: 'years' }),
    );
  });
});

describe('<SupplierQuotesView /> new-quote attachment staging (issue #781)', () => {
  test('the New-quote dialog shows the attachment dropzone instead of a "save first" notice', () => {
    render(<SupplierQuotesView {...baseProps} />);
    fireEvent.click(screen.getByText('sales:supplierQuotes.addQuote'));

    // The dialog opens in create mode...
    expect(screen.getByText('sales:supplierQuotes.newQuote')).toBeInTheDocument();
    // ...with the staging dropzone (the staging component uses unprefixed `sales` keys)...
    expect(screen.getByText('supplierQuotes.attachments.dropHere')).toBeInTheDocument();
    expect(screen.getByText('supplierQuotes.attachments.pendingUploadHint')).toBeInTheDocument();
    // ...and no longer the old "save the quote first" placeholder.
    expect(
      screen.queryByText('sales:supplierQuotes.attachments.saveQuoteFirst'),
    ).not.toBeInTheDocument();
  });
});

describe('<SupplierQuotesView /> dark-mode banners (issue #768)', () => {
  test('dialog warning banners avoid light-only amber classes', async () => {
    const source = await readComponentSource('sales/SupplierQuotesView.tsx');
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

describe('<SupplierQuotesView /> StandardTable line items', () => {
  test('keeps numeric editors compact and money values aligned', async () => {
    const source = await readComponentSource('sales/SupplierQuotesView.tsx');
    expect((source.match(/max-w-\[5rem\]/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expectSourceContainsAll(source, [
      'flex min-w-[110px] items-center justify-end gap-1.5',
      'flex-1 text-right',
    ]);
    expectSourceOmitsAll(source, ['flex-1 text-right text-sm font-semibold text-zinc-700']);
  });

  test('uses the shared table with isolated preferences and explicit editor widths', async () => {
    const source = await readComponentSource('sales/SupplierQuotesView.tsx');
    expectSourceContainsAll(source, [
      '<StandardTable<SupplierQuoteItem>',
      'persistenceKey="sales.supplierQuotes.items"',
      'defaultRowsPerPage={5}',
      'minBodyRows={0}',
      'className="min-w-[220px]"',
    ]);
    expectSourceOmitsAll(source, ['grid grid-cols-16 gap-2', 'col-span-6']);
  });
});

describe('<SupplierQuotesView /> paginated item validation', () => {
  test('blocks a quantity missing on a row outside the first page', async () => {
    localStorage.clear();
    const quoteId = 'SQ-PAGED-VALIDATION';
    const items = Array.from({ length: 6 }, (_, index): SupplierQuote['items'][number] => ({
      id: `paged-supplier-quote-item-${index + 1}`,
      quoteId,
      productName: `Product ${index + 1}`,
      quantity: index === 5 ? Number.NaN : 1,
      listPrice: 100,
      discountPercent: 0,
      unitPrice: 100,
      unitType: 'unit',
    }));
    const onUpdateQuote = mock((_id: string, _updates: Partial<SupplierQuote>) => {});

    render(
      <SupplierQuotesView
        {...baseProps}
        quotes={[buildQuote({ id: quoteId, items })]}
        onUpdateQuote={onUpdateQuote}
      />,
    );
    fireEvent.click(screen.getByText(quoteId));

    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.update' }));

    expect(onUpdateQuote).not.toHaveBeenCalled();
    expect(screen.getByText('common:validation.positiveQuantityRequired')).toBeInTheDocument();
  });
});
