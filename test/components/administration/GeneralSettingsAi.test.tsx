import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { GeneralSettings as IGeneralSettings } from '../../../types';
import { ApiErrorStub } from '../../helpers/apiErrorStub';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

const validateModelMock = mock(async (_input: unknown) => ({ ok: true }));
mock.module('../../../services/api', () => ({
  default: {
    ai: { validateModel: (input: unknown) => validateModelMock(input) },
    branding: {
      updateName: async () => ({ companyName: null, logoUrl: null }),
      uploadLogo: async () => ({ companyName: null, logoUrl: null }),
      deleteLogo: async () => ({ companyName: null, logoUrl: null }),
    },
  },
  ApiError: ApiErrorStub,
}));

clearSpyStateAfterAll();

const GeneralSettings = (await import('../../../components/administration/GeneralSettings'))
  .default;

const settings: IGeneralSettings = {
  currency: 'EUR',
  dailyLimit: 8,
  startOfWeek: 'Monday',
  treatSaturdayAsHoliday: true,
  enableAiReporting: true,
  aiProvider: 'ollama',
  geminiApiKey: '',
  openrouterApiKey: '',
  geminiModelId: '',
  openrouterModelId: '',
  ollamaBaseUrl: 'http://ollama:11434',
  ollamaBearerToken: '',
  ollamaModelId: 'qwen3:8b',
  enableTotp: true,
  enforceTotp: false,
  totpEnforcedRoleIds: [],
  totpExemptRoleIds: [],
  totpExemptUserIds: [],
  sessionIdleTimeoutMinutes: 30,
  allowWeekendSelection: true,
  defaultLocation: 'remote',
  rilCompanyName: '',
  rilDefaultStartTime: '09:00',
  rilDefaultExitTime: '18:00',
  rilLunchBreakMinutes: 60,
  rilNoteOptions: [{ value: 'P', label: 'Ferie' }],
  rilTransferOptions: ['In sede', 'Telelavoro'],
};

const renderAiSettings = (
  onUpdate = mock(async () => undefined),
  settingsOverride: Partial<IGeneralSettings> = {},
) => {
  render(
    <GeneralSettings
      settings={{ ...settings, ...settingsOverride }}
      onUpdate={onUpdate}
      branding={{ companyName: null, logoUrl: null }}
      onBrandingChange={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'general.tabs.ai' }));
  return onUpdate;
};

describe('<GeneralSettings /> Ollama AI settings', () => {
  beforeEach(() => validateModelMock.mockClear());
  afterEach(cleanup);

  test('validates an Ollama model without requiring a Bearer token', async () => {
    renderAiSettings();

    expect(screen.getByLabelText(/general\.ollamaBaseUrl/)).toHaveValue('http://ollama:11434');
    expect(screen.getByLabelText(/general\.ollamaBearerToken/)).toHaveValue('');
    expect(screen.getByLabelText(/general\.modelIdLabel/)).toHaveValue('qwen3:8b');

    fireEvent.click(screen.getByRole('button', { name: 'general.checkModel' }));

    await waitFor(() =>
      expect(validateModelMock).toHaveBeenCalledWith({
        provider: 'ollama',
        modelId: 'qwen3:8b',
        ollamaBaseUrl: 'http://ollama:11434',
        ollamaBearerToken: '',
      }),
    );
    expect(screen.getByText('general.modelVerified')).toBeDefined();
  });

  test('saves endpoint, optional token, and model while blocking a missing endpoint', async () => {
    const onUpdate = renderAiSettings();
    const baseUrlInput = screen.getByLabelText(/general\.ollamaBaseUrl/);
    const tokenInput = screen.getByLabelText(/general\.ollamaBearerToken/);

    fireEvent.change(baseUrlInput, { target: { value: '' } });
    expect(screen.getByText('general.ollamaBaseUrlRequired')).toBeDefined();
    expect(screen.getByRole('button', { name: /general\.saveConfiguration/ })).toBeDisabled();

    fireEvent.change(baseUrlInput, { target: { value: 'http://ollama.internal:11434' } });
    fireEvent.change(tokenInput, { target: { value: 'proxy-token' } });
    fireEvent.click(screen.getByRole('button', { name: /general\.saveConfiguration/ }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        aiProvider: 'ollama',
        ollamaBaseUrl: 'http://ollama.internal:11434',
        ollamaBearerToken: 'proxy-token',
        ollamaModelId: 'qwen3:8b',
      }),
    );
  });

  test('requires an Ollama model even while AI reporting is disabled', async () => {
    const onUpdate = renderAiSettings(
      mock(async () => undefined),
      {
        enableAiReporting: false,
        ollamaModelId: '',
      },
    );
    const saveButton = screen.getByRole('button', { name: /general\.saveConfiguration/ });

    expect(saveButton).toBeDisabled();

    const enableSwitch = screen.getByRole('switch');
    fireEvent.click(enableSwitch);
    const modelInput = screen.getByLabelText(/general\.modelIdLabel/);
    expect(modelInput).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(modelInput, { target: { value: 'qwen3:8b' } });

    fireEvent.click(enableSwitch);
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ enableAiReporting: false, ollamaModelId: 'qwen3:8b' }),
    );
  });
});
