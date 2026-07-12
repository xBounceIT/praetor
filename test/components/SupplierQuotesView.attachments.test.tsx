import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { Client, Product, Supplier, SupplierQuote } from '../../types';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock();

const uploadAttachmentMock = mock<(id: string, file: File) => Promise<unknown>>(() =>
  Promise.resolve({ id: 'sqa-1' }),
);

// The create flow calls supplierQuotesApi.uploadAttachment after the quote is saved. Mock the whole
// module so nothing hits the network; the other methods are stubbed for any child that mounts.
mock.module('../../services/api/supplierQuotes', () => ({
  supplierQuotesApi: {
    list: () => Promise.resolve([]),
    create: () => Promise.resolve({}),
    update: () => Promise.resolve({}),
    delete: () => Promise.resolve(),
    listVersions: () => Promise.resolve([]),
    getVersion: () => Promise.resolve({}),
    restoreVersion: () => Promise.resolve({}),
    listAttachments: () => Promise.resolve([]),
    uploadAttachment: (id: string, file: File) => uploadAttachmentMock(id, file),
    downloadAttachment: () => Promise.resolve(new Blob()),
    deleteAttachment: () => Promise.resolve(),
  },
}));

const SupplierQuotesView = (await import('../../components/sales/SupplierQuotesView')).default;

const supplier: Supplier = { id: 'sup-1', name: 'Acme Supplies' };
// A customer is mandatory on every supplier quote (issue #777), so the create flow needs one to pick.
const clients: Client[] = [{ id: 'cli-1', name: 'Globex Corp' }];
const products: Product[] = [];

// The server-assigned id deliberately differs from the code typed below, so the test proves the
// upload targets the id returned by onAddQuote rather than the raw form value.
const createdQuote: SupplierQuote = {
  id: 'SQ-SERVER-ID',
  supplierId: 'sup-1',
  supplierName: 'Acme Supplies',
  items: [],
  paymentTerms: 'immediate',
  status: 'draft',
  expirationDate: '2026-12-31',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const onAddQuote = mock((_data: Partial<SupplierQuote>) => Promise.resolve(createdQuote));

const baseProps = {
  quotes: [] as SupplierQuote[],
  suppliers: [supplier],
  clients,
  products,
  onAddQuote,
  onUpdateQuote: () => Promise.resolve(),
  onDeleteQuote: () => Promise.resolve(),
  currency: 'EUR',
};

const xlsx = (name = 'offer.xlsx'): File =>
  new File(['data'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

beforeEach(() => {
  uploadAttachmentMock.mockClear();
  onAddQuote.mockClear();
});

afterEach(() => {
  document.body.style.overflow = '';
});

describe('<SupplierQuotesView /> create with staged attachments (issue #781)', () => {
  test('uploads files staged during creation to the new quote once it is saved', async () => {
    render(<SupplierQuotesView {...baseProps} />);

    // Open the New-quote dialog.
    fireEvent.click(screen.getByText('sales:supplierQuotes.addQuote'));

    // Choose the supplier (searchable combobox), which the form requires.
    fireEvent.click(document.getElementById('supplier-quote-supplier') as HTMLElement);
    fireEvent.click(screen.getByText('Acme Supplies'));

    // A customer is also required (issue #777).
    fireEvent.click(document.getElementById('supplier-quote-client') as HTMLElement);
    fireEvent.click(screen.getByText('Globex Corp'));

    // Quote code is required (intentionally different from the server-assigned id).
    fireEvent.change(document.getElementById('supplier-quote-code') as HTMLInputElement, {
      target: { value: 'SQ-TYPED-CODE' },
    });

    // At least one line item is required.
    fireEvent.click(screen.getByText('sales:supplierQuotes.addItem'));
    fireEvent.change(screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.qty' })[0], {
      target: { value: '1' },
    });
    fireEvent.change(
      screen.getAllByRole('textbox', { name: 'sales:supplierQuotes.listPrice' })[0],
      { target: { value: '100' } },
    );

    // Stage a file before the quote exists.
    const file = xlsx();
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });

    // Save.
    fireEvent.click(screen.getByText('common:buttons.save'));

    await waitFor(() => expect(onAddQuote).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledTimes(1));
    // The staged file is uploaded against the id returned by onAddQuote, not the typed code.
    expect(uploadAttachmentMock.mock.calls[0][0]).toBe('SQ-SERVER-ID');
    expect(uploadAttachmentMock.mock.calls[0][1]).toBe(file);
  });
});
