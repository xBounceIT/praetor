import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Client, Product, Supplier, SupplierQuote } from '../../types';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from './modalStylingTestUtils';

installI18nMock();

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

afterEach(() => {
  // Modal sets body.style.overflow='hidden'; reset defensively even though we mock it.
  document.body.style.overflow = '';
});

describe('<SupplierQuotesView /> list columns', () => {
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

describe('<SupplierQuotesView /> read-only gating', () => {
  test('clicking a draft row opens the modal in editable mode', () => {
    render(<SupplierQuotesView {...baseProps} />);
    fireEvent.click(screen.getByText('SQ-DRAFT'));
    // Edit modal title and Update submit button are rendered.
    expect(screen.getByText('sales:supplierQuotes.editQuote')).toBeInTheDocument();
    expect(screen.getByText('common:buttons.update')).toBeInTheDocument();
    // Read-only banner is NOT shown.
    expect(screen.queryByText('sales:supplierQuotes.readOnlyStatus')).not.toBeInTheDocument();
    expect(screen.queryByText('sales:supplierQuotes.readOnlyLinked')).not.toBeInTheDocument();
  });

  test('clicking a sent row opens the modal in read-only mode', () => {
    render(<SupplierQuotesView {...baseProps} />);
    fireEvent.click(screen.getByText('SQ-SENT'));
    expect(screen.getByText('sales:supplierQuotes.viewQuote')).toBeInTheDocument();
    expect(screen.queryByText('common:buttons.update')).not.toBeInTheDocument();
    expect(screen.getByText('sales:supplierQuotes.readOnlyStatus')).toBeInTheDocument();
  });

  test('clicking an accepted row (without linked order) opens the modal in read-only mode', () => {
    render(<SupplierQuotesView {...baseProps} />);
    fireEvent.click(screen.getByText('SQ-ACCEPTED'));
    expect(screen.getByText('sales:supplierQuotes.viewQuote')).toBeInTheDocument();
    expect(screen.queryByText('common:buttons.update')).not.toBeInTheDocument();
    expect(screen.getByText('sales:supplierQuotes.readOnlyStatus')).toBeInTheDocument();
  });

  test('clicking a denied row opens the modal in read-only mode', () => {
    render(<SupplierQuotesView {...baseProps} />);
    fireEvent.click(screen.getByText('SQ-DENIED'));
    expect(screen.getByText('sales:supplierQuotes.viewQuote')).toBeInTheDocument();
    expect(screen.queryByText('common:buttons.update')).not.toBeInTheDocument();
    expect(screen.getByText('sales:supplierQuotes.readOnlyStatus')).toBeInTheDocument();
  });

  test('clicking an accepted row with a linked order shows the linked-order banner', () => {
    render(<SupplierQuotesView {...baseProps} />);
    fireEvent.click(screen.getByText('SQ-ACCEPTED-ORDER'));
    expect(screen.getByText('sales:supplierQuotes.viewQuote')).toBeInTheDocument();
    expect(screen.queryByText('common:buttons.update')).not.toBeInTheDocument();
    // Linked-order copy wins over the generic non-draft copy.
    expect(screen.getByText('sales:supplierQuotes.readOnlyLinked')).toBeInTheDocument();
    expect(screen.queryByText('sales:supplierQuotes.readOnlyStatus')).not.toBeInTheDocument();
  });
});

describe('<SupplierQuotesView /> supplier pricing chain', () => {
  test('renders the list-price, discount, and unit-cost columns on a draft quote', () => {
    render(<SupplierQuotesView {...baseProps} />);
    fireEvent.click(screen.getByText('SQ-DRAFT'));
    expect(screen.getAllByText('sales:supplierQuotes.listPrice').length).toBeGreaterThan(0);
    expect(screen.getAllByText('sales:supplierQuotes.discountToUs').length).toBeGreaterThan(0);
    expect(screen.getAllByText('sales:supplierQuotes.unitCost').length).toBeGreaterThan(0);
  });

  test('editing list price and discount recomputes the net unit cost in the submit payload', async () => {
    const onUpdateQuote = mock((_id: string, _updates: Partial<SupplierQuote>) => {});
    render(<SupplierQuotesView {...baseProps} onUpdateQuote={onUpdateQuote} />);
    fireEvent.click(screen.getByText('SQ-DRAFT'));

    // List price starts at 100 (formatted to 2 decimals); there is one input per layout.
    const listPriceInputs = screen.getAllByDisplayValue('100.00');
    fireEvent.change(listPriceInputs[0], { target: { value: '200' } });
    // Discount starts at 0; qty shows "1", so "0" uniquely matches the discount inputs.
    const discountInputs = screen.getAllByDisplayValue('0');
    fireEvent.change(discountInputs[0], { target: { value: '10' } });

    fireEvent.click(screen.getByText('common:buttons.update'));

    expect(onUpdateQuote).toHaveBeenCalledTimes(1);
    const updates = onUpdateQuote.mock.calls[0]?.[1] as Partial<SupplierQuote>;
    const item = updates.items?.[0];
    expect(item?.listPrice).toBe(200);
    expect(item?.discountPercent).toBe(10);
    // 200 * (1 - 10/100) = 180
    expect(item?.unitPrice).toBe(180);
  });

  test('clamps a discount typed above 100% to 100 so the net cost never goes negative', () => {
    const onUpdateQuote = mock((_id: string, _updates: Partial<SupplierQuote>) => {});
    render(<SupplierQuotesView {...baseProps} onUpdateQuote={onUpdateQuote} />);
    fireEvent.click(screen.getByText('SQ-DRAFT'));

    // SQ-DRAFT starts at listPrice 100, discount 0; "0" uniquely matches the discount inputs.
    const discountInputs = screen.getAllByDisplayValue('0');
    fireEvent.change(discountInputs[0], { target: { value: '150' } });

    fireEvent.click(screen.getByText('common:buttons.update'));

    expect(onUpdateQuote).toHaveBeenCalledTimes(1);
    const updates = onUpdateQuote.mock.calls[0]?.[1] as Partial<SupplierQuote>;
    const item = updates.items?.[0];
    // The 150% entry is blocked at 100%, and 100 * (1 - 100/100) = 0 (never negative).
    expect(item?.discountPercent).toBe(100);
    expect(item?.unitPrice).toBe(0);
  });

  test('rounds list price/discount to DB scale so the submitted net cost matches the server', () => {
    const onUpdateQuote = mock((_id: string, _updates: Partial<SupplierQuote>) => {});
    render(<SupplierQuotesView {...baseProps} onUpdateQuote={onUpdateQuote} />);
    fireEvent.click(screen.getByText('SQ-DRAFT'));

    // A list price with >2 decimals must be rounded to the persisted scale (NUMERIC(_,2)) before
    // deriving the net cost, exactly as the server does — otherwise the UI would show/submit a net
    // cost the server would not store.
    const listPriceInputs = screen.getAllByDisplayValue('100.00');
    fireEvent.change(listPriceInputs[0], { target: { value: '10.005' } });
    const discountInputs = screen.getAllByDisplayValue('0');
    fireEvent.change(discountInputs[0], { target: { value: '10' } });

    fireEvent.click(screen.getByText('common:buttons.update'));

    const updates = onUpdateQuote.mock.calls[0]?.[1] as Partial<SupplierQuote>;
    const item = updates.items?.[0];
    // 10.005 → 10.01 at scale 2; 10.01 × (1 − 10/100) = 9.009 → 9.01 (matches deriveSupplierLinePricing).
    expect(item?.listPrice).toBe(10.01);
    expect(item?.discountPercent).toBe(10);
    expect(item?.unitPrice).toBe(9.01);
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

  test('shows the Sconto a noi line in the Riepilogo when a line has a discount', () => {
    render(<SupplierQuotesView {...baseProps} quotes={[discountedQuote]} />);
    fireEvent.click(screen.getByText('SQ-DISCOUNT'));
    // Discount row label renders only when the aggregate discount is > 0.
    expect(screen.getByText('sales:supplierQuotes.discountAmount')).toBeInTheDocument();
    // Subtotale = gross 500, Sconto = 75, Totale = net 425.
    expect(screen.getByText('-75.00 EUR')).toBeInTheDocument();
  });

  test('omits the discount line when no line has a discount', () => {
    render(<SupplierQuotesView {...baseProps} />);
    // SQ-DRAFT: listPrice 100, discount 0 → gross == net, no discount.
    fireEvent.click(screen.getByText('SQ-DRAFT'));
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
const fillNewQuoteForm = (customerName?: string, listPrice: string | null = '100') => {
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
  if (listPrice !== null) {
    fireEvent.change(screen.getAllByPlaceholderText('0,00')[0], {
      target: { value: listPrice },
    });
  }
};

describe('<SupplierQuotesView /> required list price', () => {
  test('keeps new-item prices empty with the 0,00 placeholder and blocks save until entered', async () => {
    const onAddQuote = mock((_data: Partial<SupplierQuote>) => Promise.resolve(draft));
    render(<SupplierQuotesView {...baseProps} quotes={[]} onAddQuote={onAddQuote} />);

    fillNewQuoteForm('Globex Corp', null);

    const listPriceInputs = screen.getAllByPlaceholderText('0,00');
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

      const listPriceInputs = screen.getAllByPlaceholderText('0,00');
      fireEvent.submit(screen.getByText('common:buttons.save').closest('form') as HTMLFormElement);
      fireEvent.change(listPriceInputs[0], { target: { value: '125' } });

      expect(onAddQuote).not.toHaveBeenCalled();
      expect(screen.getByText('sales:supplierQuotes.errors.listPriceRequired')).toBeInTheDocument();
    } finally {
      Date.now = originalDateNow;
    }
  });

  test.each(['.', ','])('rejects a separator-only list price (%s)', (separator) => {
    const onAddQuote = mock((_data: Partial<SupplierQuote>) => Promise.resolve(draft));
    render(<SupplierQuotesView {...baseProps} quotes={[]} onAddQuote={onAddQuote} />);

    fillNewQuoteForm('Globex Corp', separator);
    fireEvent.submit(screen.getByText('common:buttons.save').closest('form') as HTMLFormElement);

    expect(onAddQuote).not.toHaveBeenCalled();
    expect(screen.getByText('sales:supplierQuotes.errors.listPriceRequired')).toBeInTheDocument();
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

  test('blocks updating an existing client-less draft until a customer is chosen', () => {
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
    fireEvent.click(screen.getByText('SQ-NO-CLIENT'));

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

  test('pre-selects the linked customer when editing a quote', () => {
    const withClient = buildQuote({
      id: 'SQ-EDIT-CLIENT',
      status: 'draft',
      clientId: 'cli-2',
      clientName: 'Initech',
    });
    render(<SupplierQuotesView {...baseProps} quotes={[withClient]} />);
    fireEvent.click(screen.getByText('SQ-EDIT-CLIENT'));
    expect(screen.getByText('sales:supplierQuotes.editQuote')).toBeInTheDocument();
    // The customer select trigger reflects the linked client's name (scoped by id; the list row
    // behind the modal also renders "Initech").
    const trigger = document.getElementById('supplier-quote-client');
    expect(trigger?.textContent).toContain('Initech');
  });

  test('shows the stored customer name when the linked client is absent from the options', () => {
    // The /clients list is user-scoped and does not include the linked client; the select must
    // still surface the quote's stored clientName rather than the empty placeholder.
    const withScopedOutClient = buildQuote({
      id: 'SQ-SCOPED-CLIENT',
      status: 'draft',
      clientId: 'cli-hidden',
      clientName: 'Hidden Customer',
    });
    render(<SupplierQuotesView {...baseProps} quotes={[withScopedOutClient]} />);
    fireEvent.click(screen.getByText('SQ-SCOPED-CLIENT'));
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

  test('renders the Durata column and an editable duration for a time-based line', () => {
    render(<SupplierQuotesView {...baseProps} quotes={[daysLineQuote]} />);
    fireEvent.click(screen.getByText('SQ-DURATION'));
    // The Durata column header renders once a line item exists...
    expect(screen.getAllByText('sales:supplierQuotes.durationColumn').length).toBeGreaterThan(0);
    // ...and the row carries a duration input reflecting the stored value (3 months).
    const durationInputs = screen
      .getAllByPlaceholderText('sales:supplierQuotes.durationColumn')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs[0].value).toBe('3');
  });

  test('scales the quote total by the line duration', () => {
    render(<SupplierQuotesView {...baseProps} quotes={[daysLineQuote]} />);
    // Total column = unitPrice 100 × quantity 2 × durationMonths 3 = 600.00
    // (without the duration multiplier it would be 200.00).
    expect(screen.getAllByText('600.00 EUR').length).toBeGreaterThan(0);
    expect(screen.queryByText('200.00 EUR')).not.toBeInTheDocument();
  });

  test('renders an editable duration for a unit-measured line (duration applies to every type)', () => {
    // SQ-DRAFT's sample item is unitType "unit". Under the new model duration applies to every line
    // type (issue #775) — the cell shows the editable value + selector, not a static N/A.
    render(<SupplierQuotesView {...baseProps} />);
    fireEvent.click(screen.getByText('SQ-DRAFT'));
    expect(screen.queryAllByText('common:labels.notApplicable')).toHaveLength(0);
    const durationInputs = screen
      .getAllByPlaceholderText('sales:supplierQuotes.durationColumn')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
  });

  test('treats a line with durationUnit "na" as no-duration (x1) and disables its value input', () => {
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
    fireEvent.click(screen.getByText('SQ-DUR-NA'));
    // 2 × 100 × 1 (na) = 200.00 — not 600.00, even though durationMonths is 3.
    expect(screen.getAllByText('200.00 EUR').length).toBeGreaterThan(0);
    expect(screen.queryByText('600.00 EUR')).not.toBeInTheDocument();
    // The value input is disabled while the unit is N/A; the selector stays usable.
    const durationInputs = screen
      .getAllByPlaceholderText('sales:supplierQuotes.durationColumn')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(durationInputs.length).toBeGreaterThan(0);
    expect(durationInputs.every((el) => el.disabled)).toBe(true);
  });

  test('editing the duration updates the submitted multiplier', () => {
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
    fireEvent.click(screen.getByText('SQ-DUR-EDIT'));

    const durationInputs = screen
      .getAllByPlaceholderText('sales:supplierQuotes.durationColumn')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    fireEvent.change(durationInputs[0], { target: { value: '4' } });

    fireEvent.click(screen.getByText('common:buttons.update'));

    expect(onUpdateQuote).toHaveBeenCalledTimes(1);
    const updates = onUpdateQuote.mock.calls[0]?.[1] as Partial<SupplierQuote>;
    expect(updates.items?.[0]?.durationMonths).toBe(4);
    expect(updates.items?.[0]?.durationUnit).toBe('months');
  });

  test("submits each line's stored duration verbatim (no unit-line coercion)", () => {
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
    fireEvent.click(screen.getByText('SQ-DUR-MIX'));
    fireEvent.click(screen.getByText('common:buttons.update'));

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

describe('<SupplierQuotesView /> compact line-item numeric columns', () => {
  test('discount/quantity inputs are width-capped and unit cost is content-sized', async () => {
    const source = await readComponentSource('sales/SupplierQuotesView.tsx');
    // The desktop "Sconto a noi (%)" and "Quantità" inputs are BOTH capped at max-w-[5rem] so the
    // columns only have to fit values like "100" or "45.47" instead of stretching the cell. The cap
    // sits directly after text-center (the duration input also uses max-w-[5rem], but not adjacent
    // to text-center), so this regex matches exactly those two inputs. Assert both carry it —
    // reverting either one alone would be a regression a single substring check would miss.
    expect((source.match(/text-center max-w-\[5rem\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // "Costo unitario" and the discount column are centered under their centered headers; gap-1.5
    // is unique to the unit-cost cell, sized to its content rather than spanning the column.
    expectSourceContainsAll(source, ['flex items-center justify-center gap-1.5']);
    // The old full-width unit-cost treatment is gone: the value no longer spans the cell right-aligned.
    expectSourceOmitsAll(source, ['flex-1 text-right text-sm font-semibold text-zinc-700']);
    // The editable "Prezzo listino" input right-aligns its value so the amount sits beside the
    // currency symbol like the other money figures; `flex-1 text-right` is unique to that input now.
    expectSourceContainsAll(source, ['flex-1 text-right']);
  });

  test('uses the compact 16-col grid with a widened product column', async () => {
    const source = await readComponentSource('sales/SupplierQuotesView.tsx');
    // Desktop line-item rows use the same tighter grid as ClientQuotesView (16 cols / gap-2)
    // instead of the old evenly-split 12-col / gap-3 that left big gaps between the capped numeric
    // inputs. Both the header row and the data row carry it → at least 2 occurrences.
    expect((source.match(/grid grid-cols-16 gap-2/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The product column is widened to col-span-6 (the five remaining columns stay col-span-2:
    // 6 + 5×2 = 16) to soak up the reclaimed width — header + data row → at least 2 occurrences.
    expect((source.match(/col-span-6/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The old evenly-split 12-col grid that wasted horizontal space is gone from both rows.
    expectSourceOmitsAll(source, ['grid grid-cols-12 gap-3']);
  });
});
