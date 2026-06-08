import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { SupplierQuoteAttachment } from '../../types';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';
import { render } from '../helpers/render';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from './modalStylingTestUtils';

// Stable t/i18n references - components that put `t` in useEffect dep arrays would otherwise
// loop forever in tests because every render produces a fresh `t` identity.
const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
const i18n = { language: 'en', changeLanguage: () => {} };
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t, i18n }),
  Trans: ({ children }: { children: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const listAttachmentsMock = mock<(id: string) => Promise<SupplierQuoteAttachment[]>>(() =>
  Promise.resolve([]),
);
const uploadAttachmentMock = mock<(id: string, file: File) => Promise<SupplierQuoteAttachment>>();
const downloadAttachmentMock = mock<(id: string, attachmentId: string) => Promise<Blob>>();
const deleteAttachmentMock = mock<(id: string, attachmentId: string) => Promise<void>>();

mock.module('../../services/api/supplierQuotes', () => ({
  supplierQuotesApi: {
    listAttachments: (id: string) => listAttachmentsMock(id),
    uploadAttachment: (id: string, file: File) => uploadAttachmentMock(id, file),
    downloadAttachment: (id: string, aid: string) => downloadAttachmentMock(id, aid),
    deleteAttachment: (id: string, aid: string) => deleteAttachmentMock(id, aid),
  },
}));

const realDate = await import('../../utils/date');
mock.module('../../utils/date', () => ({
  ...realDate,
  formatInsertDateTime: (ts: number) => `at-${ts}`,
}));

mock.module('../../components/shared/DeleteConfirmModal', () => ({
  default: ({
    isOpen,
    onConfirm,
    onClose,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <button type="button" onClick={onClose}>
          confirm-cancel
        </button>
        <button type="button" onClick={onConfirm}>
          confirm-yes
        </button>
      </div>
    ) : null,
}));

clearSpyStateAfterAll();

const SupplierQuoteAttachmentsSection = (
  await import('../../components/sales/SupplierQuoteAttachmentsSection')
).default;

const ATTACHMENT_A: SupplierQuoteAttachment = {
  id: 'sqa-1',
  quoteId: 'sq-1',
  fileName: 'first.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  fileSize: 2048,
  uploadedByUserId: 'u-1',
  createdAt: 1_700_000_000_000,
};

const ATTACHMENT_B: SupplierQuoteAttachment = {
  id: 'sqa-2',
  quoteId: 'sq-1',
  fileName: 'second.pdf',
  mimeType: 'application/pdf',
  fileSize: 5_242_880,
  uploadedByUserId: null,
  createdAt: 1_700_000_001_000,
};

beforeEach(() => {
  listAttachmentsMock.mockReset();
  uploadAttachmentMock.mockReset();
  downloadAttachmentMock.mockReset();
  deleteAttachmentMock.mockReset();
  listAttachmentsMock.mockImplementation(() => Promise.resolve([]));
});

afterEach(() => {
  document.body.style.overflow = '';
});

describe('<SupplierQuoteAttachmentsSection />', () => {
  test('renders empty state and the upload zone when editable', async () => {
    render(
      <SupplierQuoteAttachmentsSection
        quoteId="sq-1"
        isReadOnly={false}
        readOnlyStatus="Editable"
        statusLabel="Status:"
      />,
    );
    await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalledWith('sq-1'));
    expect(screen.getByText('No attachments yet.')).toBeInTheDocument();
    expect(screen.getByText('Drop a file here or click to upload')).toBeInTheDocument();
  });

  test('renders attachments newest-first and shows formatted size', async () => {
    listAttachmentsMock.mockImplementation(() => Promise.resolve([ATTACHMENT_B, ATTACHMENT_A]));
    render(
      <SupplierQuoteAttachmentsSection
        quoteId="sq-1"
        isReadOnly={false}
        readOnlyStatus="Editable"
        statusLabel="Status:"
      />,
    );
    await waitFor(() => expect(screen.getByText('first.xlsx')).toBeInTheDocument());
    expect(screen.getByText('second.pdf')).toBeInTheDocument();
    // 2048 bytes => 2.0 KB; 5242880 bytes => 5.0 MB
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();
  });

  test('hides upload zone and delete buttons when read-only', async () => {
    listAttachmentsMock.mockImplementation(() => Promise.resolve([ATTACHMENT_A]));
    render(
      <SupplierQuoteAttachmentsSection
        quoteId="sq-1"
        isReadOnly={true}
        readOnlyStatus="Read-only"
        statusLabel="Status:"
      />,
    );
    await waitFor(() => expect(screen.getByText('first.xlsx')).toBeInTheDocument());
    expect(screen.queryByText('Drop a file here or click to upload')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete')).not.toBeInTheDocument();
    // Download stays visible - view-only users can still grab the file.
    expect(screen.getByLabelText('Download')).toBeInTheDocument();
  });

  test('uploads a valid file and prepends it to the list', async () => {
    const created: SupplierQuoteAttachment = {
      ...ATTACHMENT_A,
      id: 'sqa-new',
      fileName: 'new.xlsx',
    };
    uploadAttachmentMock.mockImplementation(() => Promise.resolve(created));
    render(
      <SupplierQuoteAttachmentsSection
        quoteId="sq-1"
        isReadOnly={false}
        readOnlyStatus="Editable"
        statusLabel="Status:"
      />,
    );
    await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalled());

    const file = new File(['contents'], 'new.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledWith('sq-1', file));
    await waitFor(() => expect(screen.getByText('new.xlsx')).toBeInTheDocument());
  });

  test('rejects disallowed file types client-side without calling the API', async () => {
    render(
      <SupplierQuoteAttachmentsSection
        quoteId="sq-1"
        isReadOnly={false}
        readOnlyStatus="Editable"
        statusLabel="Status:"
      />,
    );
    await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalled());

    const exe = new File(['x'], 'malware.exe', { type: 'application/octet-stream' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [exe] } });

    await waitFor(() =>
      expect(
        screen.getByText('File type not allowed. Use xlsx, pdf, or docx.'),
      ).toBeInTheDocument(),
    );
    expect(uploadAttachmentMock).not.toHaveBeenCalled();
  });

  test('rejects oversized files client-side', async () => {
    render(
      <SupplierQuoteAttachmentsSection
        quoteId="sq-1"
        isReadOnly={false}
        readOnlyStatus="Editable"
        statusLabel="Status:"
      />,
    );
    await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalled());

    // Forge a File whose `size` property reports >10 MB without actually allocating that much.
    const big = new File(['x'], 'big.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [big] } });

    await waitFor(() =>
      expect(screen.getByText('File exceeds the 10 MB upload limit')).toBeInTheDocument(),
    );
    expect(uploadAttachmentMock).not.toHaveBeenCalled();
  });

  test('confirms before deleting and removes the row on success', async () => {
    listAttachmentsMock.mockImplementation(() => Promise.resolve([ATTACHMENT_A]));
    deleteAttachmentMock.mockImplementation(() => Promise.resolve());
    render(
      <SupplierQuoteAttachmentsSection
        quoteId="sq-1"
        isReadOnly={false}
        readOnlyStatus="Editable"
        statusLabel="Status:"
      />,
    );
    await waitFor(() => expect(screen.getByText('first.xlsx')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Delete'));
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByText('confirm-yes'));
    await waitFor(() => expect(deleteAttachmentMock).toHaveBeenCalledWith('sq-1', 'sqa-1'));
    await waitFor(() => expect(screen.queryByText('first.xlsx')).not.toBeInTheDocument());
  });

  test('surfaces server upload error message', async () => {
    uploadAttachmentMock.mockImplementation(() =>
      Promise.reject(new Error('Quotes become read-only once an order exists')),
    );
    render(
      <SupplierQuoteAttachmentsSection
        quoteId="sq-1"
        isReadOnly={false}
        readOnlyStatus="Editable"
        statusLabel="Status:"
      />,
    );
    await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalled());

    const file = new File(['x'], 'order.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByText('Quotes become read-only once an order exists')).toBeInTheDocument(),
    );
  });
});

describe('SupplierQuoteAttachmentsSection dark-mode error banner (issue #768 follow-up)', () => {
  test('the upload-error banner avoids light-only red classes', async () => {
    const source = await readComponentSource('sales/SupplierQuoteAttachmentsSection.tsx');
    // Translucent red + explicit dark-mode text keeps the error legible on the dark dialog.
    expectSourceContainsAll(source, ['border-red-500/30', 'bg-red-500/10', 'dark:text-red-300']);
    expectSourceOmitsAll(source, ['border-red-200']);
  });
});
