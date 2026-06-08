import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '../helpers/render';

// AttachmentDropzone takes already-resolved strings, so no i18n mock is needed.
const AttachmentDropzone = (await import('../../components/sales/AttachmentDropzone')).default;

const xlsx = (name = 'q.xlsx'): File =>
  new File(['data'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

const baseProps = {
  primaryLabel: 'Drop here',
  allowedTypesLabel: 'Allowed: xlsx, pdf, docx · max 10 MB',
  uploadButtonLabel: 'Upload file',
  inputLabel: 'Drop a file here or click to upload',
};

afterEach(() => {
  document.body.style.overflow = '';
});

describe('<AttachmentDropzone />', () => {
  test('renders its labels and forwards a chosen file to onFile', () => {
    const onFile = mock((_file: File) => {});
    render(<AttachmentDropzone {...baseProps} onFile={onFile} />);

    expect(screen.getByText('Drop here')).toBeInTheDocument();
    expect(screen.getByText('Allowed: xlsx, pdf, docx · max 10 MB')).toBeInTheDocument();

    const file = xlsx();
    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0]).toBe(file);
  });

  test('forwards a dropped file', () => {
    const onFile = mock((_file: File) => {});
    render(<AttachmentDropzone {...baseProps} onFile={onFile} />);

    const file = xlsx('dropped.pdf');
    fireEvent.drop(document.querySelector('label') as HTMLLabelElement, {
      dataTransfer: { files: [file] },
    });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  test('resets the input value so the same file can be re-picked', () => {
    render(<AttachmentDropzone {...baseProps} onFile={() => {}} />);
    const input = fileInput();
    fireEvent.change(input, { target: { files: [xlsx()] } });
    expect(input.value).toBe('');
  });

  test('blocks interaction while busy: disables the input and ignores files', () => {
    const onFile = mock((_file: File) => {});
    render(<AttachmentDropzone {...baseProps} onFile={onFile} busy />);

    const input = fileInput();
    expect(input.disabled).toBe(true);
    fireEvent.change(input, { target: { files: [xlsx()] } });
    fireEvent.drop(document.querySelector('label') as HTMLLabelElement, {
      dataTransfer: { files: [xlsx()] },
    });
    expect(onFile).not.toHaveBeenCalled();
  });
});
