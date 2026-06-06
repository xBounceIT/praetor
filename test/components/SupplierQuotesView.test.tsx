import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, within } from '@testing-library/react';
import type { Client, Product, Supplier, SupplierQuote } from '../../types';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

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
  onAddQuote: () => {},
  onUpdateQuote: () => {},
  onDeleteQuote: () => {},
  currency: 'EUR',
};

afterEach(() => {
  // Modal sets body.style.overflow='hidden'; reset defensively even though we mock it.
  document.body.style.overflow = '';
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

describe('<SupplierQuotesView /> optional customer association (issue #759)', () => {
  test('renders the Customer field in the add-quote dialog', () => {
    render(<SupplierQuotesView {...baseProps} />);
    fireEvent.click(screen.getByText('sales:supplierQuotes.addQuote'));
    expect(screen.getByText('sales:supplierQuotes.newQuote')).toBeInTheDocument();
    // The customer select trigger renders; with nothing linked it shows the "No customer" option
    // (scoped by id because the same i18n key is also the list column header behind the modal).
    const trigger = document.getElementById('supplier-quote-client');
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain('sales:supplierQuotes.noClient');
    // Saving with no customer selected must be allowed: the Save button is shown.
    expect(screen.getByText('common:buttons.save')).toBeInTheDocument();
  });

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
