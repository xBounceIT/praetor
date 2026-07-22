import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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
const validateModelMock = mock(async (_data?: unknown) => ({ ok: true }));

// Own factory with ApiError (process-global mock convention — see helpers/mockCleanup.ts).
mock.module('../../../services/api', () => ({
  default: {
    branding: {
      updateName: (name: string | null) => updateNameMock(name),
      uploadLogo: (file: File) => uploadLogoMock(file),
      deleteLogo: () => deleteLogoMock(),
    },
    ai: { validateModel: (data: unknown) => validateModelMock(data) },
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

describe('<GeneralSettings /> AI provider settings', () => {
  beforeEach(() => {
    validateModelMock.mockReset();
    validateModelMock.mockImplementation(async () => ({ ok: true }));
  });

  test('selects Anthropic and saves its dedicated key and model', async () => {
    const onUpdate = mock(async () => undefined);
    render(
      <GeneralSettings
        settings={{ ...baseSettings, enableAiReporting: true, aiProvider: 'anthropic' }}
        onUpdate={onUpdate}
        branding={{ companyName: null, logoUrl: null }}
        onBrandingChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'general.tabs.ai' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'general.aiProviderLabel' }));
    const anthropicOption = screen.getByRole('option', {
      name: 'general.aiProviders.anthropic',
    });
    expect(anthropicOption).toBeDefined();
    fireEvent.click(anthropicOption);
    const apiKeyInput = document.getElementById('general-ai-api-key');
    if (!(apiKeyInput instanceof HTMLInputElement)) throw new Error('Missing Anthropic API key');
    fireEvent.change(apiKeyInput, {
      target: { value: 'sk-ant-test' },
    });
    const modelInput = document.getElementById('general-ai-model');
    if (!(modelInput instanceof HTMLInputElement)) throw new Error('Missing Anthropic model ID');
    fireEvent.change(modelInput, {
      target: { value: 'claude-sonnet-4-5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /general\.saveConfiguration/ }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          aiProvider: 'anthropic',
          anthropicApiKey: 'sk-ant-test',
          anthropicModelId: 'claude-sonnet-4-5',
        }),
      ),
    );
  });

  test('configures, validates, and saves OpenAI credentials separately', async () => {
    const onUpdate = mock(async () => undefined);
    render(
      <GeneralSettings
        settings={{
          ...baseSettings,
          enableAiReporting: true,
          aiProvider: 'openai',
          openaiApiKey: 'sk-openai',
          openaiModelId: 'gpt-test',
        }}
        onUpdate={onUpdate}
        branding={{ companyName: null, logoUrl: null }}
        onBrandingChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'general.tabs.ai' }));

    expect(screen.getByLabelText(/general\.openaiApiKey/)).toHaveValue('sk-openai');
    expect(screen.getByLabelText(/general\.modelIdLabel/)).toHaveValue('gpt-test');
    expect(screen.getByRole('link', { name: 'general.openaiDashboard' })).toHaveAttribute(
      'href',
      'https://platform.openai.com/api-keys',
    );

    fireEvent.click(screen.getByRole('button', { name: 'general.checkModel' }));
    await waitFor(() =>
      expect(validateModelMock).toHaveBeenCalledWith({
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'sk-openai',
      }),
    );

    fireEvent.change(screen.getByLabelText(/general\.openaiApiKey/), {
      target: { value: 'sk-openai-updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: /general\.saveConfiguration/ }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          aiProvider: 'openai',
          openaiApiKey: 'sk-openai-updated',
          openaiModelId: 'gpt-test',
        }),
      ),
    );
  });

  test('validates a stored write-only API key without sending its mask as a credential', async () => {
    render(
      <GeneralSettings
        settings={{
          ...baseSettings,
          enableAiReporting: true,
          aiProvider: 'openai',
          openaiApiKey: '********',
          openaiModelId: 'gpt-test',
        }}
        onUpdate={mock(async () => undefined)}
        branding={{ companyName: null, logoUrl: null }}
        onBrandingChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'general.tabs.ai' }));
    expect(screen.queryByLabelText(/general\.openaiApiKey/)).toBeNull();
    expect(screen.getByText('general.apiKeyStored')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'general.checkModel' }));

    await waitFor(() =>
      expect(validateModelMock).toHaveBeenCalledWith({
        provider: 'openai',
        modelId: 'gpt-test',
      }),
    );
    expect(screen.getByText('general.modelVerified')).toBeDefined();
  });

  test('requires an explicit replace action before editing a stored API key', async () => {
    const onUpdate = mock(async () => undefined);
    render(
      <GeneralSettings
        settings={{
          ...baseSettings,
          enableAiReporting: true,
          aiProvider: 'openai',
          openaiApiKey: '********',
          openaiModelId: 'gpt-test',
        }}
        onUpdate={onUpdate}
        branding={{ companyName: null, logoUrl: null }}
        onBrandingChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'general.tabs.ai' }));
    fireEvent.click(screen.getByRole('button', { name: 'secretField.replace' }));
    const apiKeyInput = screen.getByLabelText(/general\.openaiApiKey/);
    expect(apiKeyInput).toHaveValue('');
    fireEvent.change(apiKeyInput, { target: { value: 'sk-openai-replacement' } });
    fireEvent.click(screen.getByRole('button', { name: /general\.saveConfiguration/ }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ openaiApiKey: 'sk-openai-replacement' }),
      ),
    );
  });

  test('can leave replace mode without changing a stored API key', () => {
    render(
      <GeneralSettings
        settings={{
          ...baseSettings,
          enableAiReporting: true,
          aiProvider: 'openai',
          openaiApiKey: '********',
          openaiModelId: 'gpt-test',
        }}
        onUpdate={mock(async () => undefined)}
        branding={{ companyName: null, logoUrl: null }}
        onBrandingChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'general.tabs.ai' }));
    fireEvent.click(screen.getByRole('button', { name: 'secretField.replace' }));
    fireEvent.change(screen.getByLabelText(/general\.openaiApiKey/), {
      target: { value: 'not-saved' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'secretField.keepStored' }));

    expect(screen.queryByLabelText(/general\.openaiApiKey/)).toBeNull();
    expect(screen.getByText('general.apiKeyStored')).toBeDefined();
  });

  test('configures and validates a local endpoint without requiring an API token', async () => {
    const onUpdate = mock(async () => undefined);
    render(
      <GeneralSettings
        settings={{
          ...baseSettings,
          enableAiReporting: true,
          aiProvider: 'local',
          localApiKey: '',
          localBaseUrl: 'http://inference:11434/v1',
          localModelId: 'llama3.2',
        }}
        onUpdate={onUpdate}
        branding={{ companyName: null, logoUrl: null }}
        onBrandingChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'general.tabs.ai' }));
    expect(screen.getByLabelText(/general\.localBaseUrl/)).toHaveValue('http://inference:11434/v1');
    expect(screen.getByLabelText(/general\.localApiKey/)).toHaveValue('');
    expect(screen.getByLabelText(/general\.modelIdLabel/)).toHaveValue('llama3.2');

    fireEvent.click(screen.getByRole('button', { name: 'general.checkModel' }));
    await waitFor(() =>
      expect(validateModelMock).toHaveBeenCalledWith({
        provider: 'local',
        apiKey: '',
        baseUrl: 'http://inference:11434/v1',
        modelId: 'llama3.2',
      }),
    );

    fireEvent.change(screen.getByLabelText(/general\.localBaseUrl/), {
      target: { value: 'http://inference:8000/v1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /general\.saveConfiguration/ }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          aiProvider: 'local',
          localApiKey: '',
          localBaseUrl: 'http://inference:8000/v1',
          localModelId: 'llama3.2',
        }),
      ),
    );
  });

  test('ignores a stale model validation result after the target changes', async () => {
    let resolveValidation:
      | ((value: { ok: boolean; code?: string; message?: string }) => void)
      | undefined;
    validateModelMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveValidation = resolve;
        }),
    );

    render(
      <GeneralSettings
        settings={{
          ...baseSettings,
          enableAiReporting: true,
          aiProvider: 'openai',
          openaiApiKey: 'sk-openai',
          openaiModelId: 'gpt-old',
        }}
        onUpdate={async () => {}}
        branding={{ companyName: null, logoUrl: null }}
        onBrandingChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'general.tabs.ai' }));
    fireEvent.click(screen.getByRole('button', { name: 'general.checkModel' }));
    await waitFor(() => expect(resolveValidation).toBeDefined());

    fireEvent.change(screen.getByLabelText(/general\.modelIdLabel/), {
      target: { value: 'gpt-new' },
    });
    if (!resolveValidation) throw new Error('Validation request did not start');
    await act(async () => {
      resolveValidation?.({ ok: false, code: 'NOT_FOUND', message: 'Old result' });
      await Promise.resolve();
    });

    expect(screen.getByLabelText(/general\.modelIdLabel/)).toHaveValue('gpt-new');
    expect(screen.queryByText('general.modelNotFound')).toBeNull();
  });
});
