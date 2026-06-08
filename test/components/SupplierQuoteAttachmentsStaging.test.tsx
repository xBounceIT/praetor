import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { render } from '../helpers/render';

// Identity-ish translator that returns the defaultValue so assertions read in plain English.
const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
const i18n = { language: 'en', changeLanguage: () => {} };
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t, i18n }),
  Trans: ({ children }: { children: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const SupplierQuoteAttachmentsStaging = (
  await import('../../components/sales/SupplierQuoteAttachmentsStaging')
).default;

const xlsx = (name = 'quote.xlsx'): File =>
  new File(['data'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

const baseProps = {
  files: [] as File[],
  onAdd: () => {},
  onRemove: () => {},
  readOnlyStatus: 'Editable',
  statusLabel: 'Status:',
};

afterEach(() => {
  document.body.style.overflow = '';
});

describe('<SupplierQuoteAttachmentsStaging />', () => {
  test('renders the dropzone and the upload-on-save hint', () => {
    render(<SupplierQuoteAttachmentsStaging {...baseProps} />);
    expect(screen.getByText('Drop a file here or click to upload')).toBeInTheDocument();
    expect(screen.getByText('Files are uploaded when you save the quote.')).toBeInTheDocument();
  });

  test('stages a valid file via onAdd', () => {
    const onAdd = mock((_file: File) => {});
    render(<SupplierQuoteAttachmentsStaging {...baseProps} onAdd={onAdd} />);

    const file = xlsx();
    fireEvent.change(fileInput(), { target: { files: [file] } });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toBe(file);
  });

  test('rejects a disallowed type client-side and surfaces an error', () => {
    const onAdd = mock((_file: File) => {});
    render(<SupplierQuoteAttachmentsStaging {...baseProps} onAdd={onAdd} />);

    const exe = new File(['x'], 'malware.exe', { type: 'application/octet-stream' });
    fireEvent.change(fileInput(), { target: { files: [exe] } });

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText('File type not allowed. Use xlsx, pdf, or docx.')).toBeInTheDocument();
  });

  test('rejects an oversized file client-side', () => {
    const onAdd = mock((_file: File) => {});
    render(<SupplierQuoteAttachmentsStaging {...baseProps} onAdd={onAdd} />);

    const big = xlsx('big.xlsx');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.change(fileInput(), { target: { files: [big] } });

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText('File exceeds the 10 MB upload limit')).toBeInTheDocument();
  });

  test('lists staged files and removes the chosen one', () => {
    const onRemove = mock((_index: number) => {});
    render(
      <SupplierQuoteAttachmentsStaging
        {...baseProps}
        files={[xlsx('first.xlsx'), xlsx('second.pdf')]}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText('first.xlsx')).toBeInTheDocument();
    expect(screen.getByText('second.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText('Remove')[1]);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  test('locks the queue while disabled so a mid-save file is not silently dropped', () => {
    // While the parent is saving, handleSubmit has already snapshotted the queue; a file added now
    // would never be uploaded and would be wiped on modal close. The controls must be inert.
    const onAdd = mock((_file: File) => {});
    const onRemove = mock((_index: number) => {});
    render(
      <SupplierQuoteAttachmentsStaging
        {...baseProps}
        disabled
        files={[xlsx('first.xlsx')]}
        onAdd={onAdd}
        onRemove={onRemove}
      />,
    );

    const input = fileInput();
    expect(input.disabled).toBe(true);
    // Even if a change is forced through, the disabled guard ignores the file.
    fireEvent.change(input, { target: { files: [xlsx('late.xlsx')] } });
    expect(onAdd).not.toHaveBeenCalled();

    const removeButton = screen.getByLabelText('Remove') as HTMLButtonElement;
    expect(removeButton.disabled).toBe(true);
    fireEvent.click(removeButton);
    expect(onRemove).not.toHaveBeenCalled();
  });
});
