import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppBranding, GeneralSettings as IGeneralSettings } from '../../../types';
import { ApiErrorStub } from '../../helpers/apiErrorStub';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

const updateNameMock = mock(
  async (_name: string | null): Promise<AppBranding> => ({ companyName: 'Acme', logoUrl: null }),
);
const uploadLogoMock = mock(
  async (_file: File): Promise<AppBranding> => ({ companyName: null, logoUrl: '/x?v=2' }),
);
const deleteLogoMock = mock(
  async (): Promise<AppBranding> => ({ companyName: null, logoUrl: null }),
);
const validateModelMock = mock(async () => ({ ok: true }));

// Own factory with ApiError (process-global mock convention — see helpers/mockCleanup.ts).
mock.module('../../../services/api', () => ({
  default: {
    branding: {
      updateName: (name: string | null) => updateNameMock(name),
      uploadLogo: (file: File) => uploadLogoMock(file),
      deleteLogo: () => deleteLogoMock(),
    },
    ai: { validateModel: () => validateModelMock() },
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

const GeneralSettings = (await import('../../../components/administration/GeneralSettings'))
  .default;

const baseSettings: IGeneralSettings = {
  currency: 'EUR',
  dailyLimit: 8,
  startOfWeek: 'Monday',
  treatSaturdayAsHoliday: true,
  enableAiReporting: false,
  enableTotp: true,
  enforceTotp: false,
  totpEnforcedRoleIds: [],
  totpExemptRoleIds: [],
  allowWeekendSelection: true,
  defaultLocation: 'remote',
  rilCompanyName: '',
  rilDefaultStartTime: '09:00',
  rilDefaultExitTime: '18:00',
  rilLunchBreakMinutes: 60,
  rilNoteOptions: [{ value: 'P', label: 'Ferie' }],
  rilTransferOptions: ['In sede', 'Telelavoro'],
};

const renderSettings = (branding: AppBranding, onUpdate = mock(async () => undefined)) => {
  const onBrandingChange = mock((_b: AppBranding) => {});
  render(
    <GeneralSettings
      settings={baseSettings}
      onUpdate={onUpdate}
      branding={branding}
      onBrandingChange={onBrandingChange}
    />,
  );
  return { onUpdate, onBrandingChange };
};

const openBrandingTab = () =>
  fireEvent.click(screen.getByRole('button', { name: 'general.tabs.branding' }));

describe('<GeneralSettings /> branding tab', () => {
  beforeEach(() => {
    updateNameMock.mockClear();
    uploadLogoMock.mockClear();
    deleteLogoMock.mockClear();
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
  });

  test('hides the global save bar and renders the branding card on the branding tab', () => {
    renderSettings({ companyName: null, logoUrl: null });

    // The general-settings save bar is present on the default (localization) tab...
    expect(screen.getByRole('button', { name: /general\.saveConfiguration/ })).toBeDefined();

    openBrandingTab();

    // ...and hidden on the branding tab, which has its own per-action saves.
    expect(screen.getByText('branding.title')).toBeDefined();
    expect(screen.queryByRole('button', { name: /general\.saveConfiguration/ })).toBeNull();
  });

  test('saving the company name persists via the branding API without submitting the form', async () => {
    const { onUpdate, onBrandingChange } = renderSettings({ companyName: '', logoUrl: null });

    openBrandingTab();
    fireEvent.change(screen.getByLabelText('branding.companyNameLabel'), {
      target: { value: 'Acme' },
    });
    fireEvent.click(screen.getByRole('button', { name: /branding\.save/ }));

    await waitFor(() => expect(updateNameMock).toHaveBeenCalledWith('Acme'));
    await waitFor(() => expect(onBrandingChange).toHaveBeenCalled());
    // Because BrandingSettings renders outside the <form> and its buttons are type="button",
    // the branding action must NOT trigger the general-settings submit handler.
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test('removing the logo calls the branding API and never submits the form', async () => {
    const { onUpdate } = renderSettings({ companyName: 'Acme', logoUrl: '/api/branding/logo?v=1' });

    openBrandingTab();
    fireEvent.click(screen.getByRole('button', { name: /branding\.removeButton/ }));

    await waitFor(() => expect(deleteLogoMock).toHaveBeenCalled());
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
