import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppBranding } from '../../../types';
import { ApiErrorStub } from '../../helpers/apiErrorStub';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

const updateNameMock = mock(
  async (_name: string | null): Promise<AppBranding> => ({ companyName: 'Acme', logoUrl: null }),
);
const uploadLogoMock = mock(
  async (_file: File): Promise<AppBranding> => ({
    companyName: null,
    logoUrl: '/api/branding/logo?v=2',
  }),
);
const deleteLogoMock = mock(
  async (): Promise<AppBranding> => ({ companyName: null, logoUrl: null }),
);

// `ApiError` must be on the mock even though this component never uses it: Bun's
// `mock.module` overrides are process-global and leak across files (see helpers/mockCleanup.ts),
// so a consumer that statically imports `{ ApiError }` from services/api (e.g. Login.tsx) would
// fail to link if this factory — when it happens to be the last one registered — omitted it.
// Every other services/api mock in the suite follows the same convention.
mock.module('../../../services/api', () => ({
  default: {
    branding: {
      updateName: (name: string | null) => updateNameMock(name),
      uploadLogo: (file: File) => uploadLogoMock(file),
      deleteLogo: () => deleteLogoMock(),
    },
  },
  ApiError: ApiErrorStub,
}));

const toastSuccessMock = mock((_message: string) => {});
const toastErrorMock = mock((_message: string) => {});
mock.module('../../../utils/toast', () => ({
  toastSuccess: (message: string) => toastSuccessMock(message),
  toastError: (message: string) => toastErrorMock(message),
}));

clearSpyStateAfterAll();

const BrandingSettings = (await import('../../../components/administration/BrandingSettings'))
  .default;

const fileInput = (): HTMLInputElement => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) throw new Error('file input not found');
  return input;
};

describe('<BrandingSettings />', () => {
  beforeEach(() => {
    updateNameMock.mockClear();
    uploadLogoMock.mockClear();
    deleteLogoMock.mockClear();
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
  });

  test('Save is disabled until the company name changes, then persists the trimmed value', async () => {
    const onChange = mock((_b: AppBranding) => {});
    render(<BrandingSettings branding={{ companyName: '', logoUrl: null }} onChange={onChange} />);

    const saveButton = screen.getByRole('button', { name: /branding\.save/ });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('branding.companyNameLabel'), {
      target: { value: '  Acme  ' },
    });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => expect(updateNameMock).toHaveBeenCalledWith('Acme'));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ companyName: 'Acme', logoUrl: null }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('branding.nameSaved');
  });

  test('clearing the company name sends null', async () => {
    const onChange = mock((_b: AppBranding) => {});
    updateNameMock.mockResolvedValueOnce({ companyName: null, logoUrl: null });
    render(
      <BrandingSettings branding={{ companyName: 'Acme', logoUrl: null }} onChange={onChange} />,
    );

    fireEvent.change(screen.getByLabelText('branding.companyNameLabel'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /branding\.save/ }));

    await waitFor(() => expect(updateNameMock).toHaveBeenCalledWith(null));
  });

  test('shows the current logo and removing it calls deleteLogo', async () => {
    const onChange = mock((_b: AppBranding) => {});
    render(
      <BrandingSettings
        branding={{ companyName: 'Acme', logoUrl: '/api/branding/logo?v=1' }}
        onChange={onChange}
      />,
    );

    expect(screen.getByAltText('branding.currentLogoAlt').getAttribute('src')).toBe(
      '/api/branding/logo?v=1',
    );

    fireEvent.click(screen.getByRole('button', { name: /branding\.removeButton/ }));

    await waitFor(() => expect(deleteLogoMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ companyName: null, logoUrl: null }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('branding.logoRemoved');
  });

  test('shows the ImageOff placeholder when the current logo fails to load', () => {
    render(
      <BrandingSettings
        branding={{ companyName: 'Acme', logoUrl: '/api/branding/logo?v=1' }}
        onChange={() => {}}
      />,
    );

    fireEvent.error(screen.getByAltText('branding.currentLogoAlt'));

    // A logo whose file is gone on disk 404s; the broken preview is replaced by the placeholder.
    expect(screen.queryByAltText('branding.currentLogoAlt')).toBeNull();
  });

  test('hides the Remove button when no logo is set', () => {
    render(
      <BrandingSettings branding={{ companyName: null, logoUrl: null }} onChange={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: /branding\.removeButton/ })).toBeNull();
  });

  test('uploads a valid image file', async () => {
    const onChange = mock((_b: AppBranding) => {});
    render(
      <BrandingSettings branding={{ companyName: null, logoUrl: null }} onChange={onChange} />,
    );

    const file = new File(['imagedata'], 'logo.png', { type: 'image/png' });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    await waitFor(() => expect(uploadLogoMock).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        companyName: null,
        logoUrl: '/api/branding/logo?v=2',
      }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('branding.logoUploaded');
  });

  test('rejects an unsupported file type without calling the API', async () => {
    render(
      <BrandingSettings branding={{ companyName: null, logoUrl: null }} onChange={() => {}} />,
    );

    const file = new File(['x'], 'malware.exe', { type: 'application/octet-stream' });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('branding.invalidType'));
    expect(uploadLogoMock).not.toHaveBeenCalled();
  });

  test('rejects a file larger than 2 MB without calling the API', async () => {
    render(
      <BrandingSettings branding={{ companyName: null, logoUrl: null }} onChange={() => {}} />,
    );

    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 3 * 1024 * 1024 });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('branding.tooLarge'));
    expect(uploadLogoMock).not.toHaveBeenCalled();
  });

  test('rejects an empty (0-byte) file without calling the API', async () => {
    render(
      <BrandingSettings branding={{ companyName: null, logoUrl: null }} onChange={() => {}} />,
    );

    const file = new File([], 'logo.png', { type: 'image/png' });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('branding.invalidType'));
    expect(uploadLogoMock).not.toHaveBeenCalled();
  });
});
