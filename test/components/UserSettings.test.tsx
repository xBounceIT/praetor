import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PersonalAccessToken, Settings } from '../../services/api';
import type { UserAuthMethod } from '../../types';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

const UserSettings = (await import('../../components/UserSettings')).default;

const settings: Settings = {
  fullName: 'Alice',
  email: 'alice@example.com',
  language: 'en',
};

const tokenMetadata = {
  tokenPrefix: 'praetor_pat_abc12345',
  createdAt: '2026-05-11T08:00:00.000Z',
  updatedAt: '2026-05-11T09:00:00.000Z',
  lastUsedAt: null,
};

const onUpdate = mock((_updates: Partial<Settings>) => Promise.resolve());
const onUpdatePassword = mock((_currentPassword: string, _newPassword: string) =>
  Promise.resolve(),
);
const onListMcpTokens = mock(() =>
  Promise.resolve([
    {
      id: 'mcp-token-1',
      name: 'Agent',
      tokenPrefix: 'praetor_mcp_abcd',
      scope: 'full' as const,
      createdAt: 1000,
      lastUsedAt: null,
    },
  ]),
);
const onCreateMcpToken = mock((_name: string, _scope: 'read_only' | 'full' = 'full') =>
  Promise.resolve({
    token: {
      id: 'mcp-token-2',
      name: 'External Agent',
      tokenPrefix: 'praetor_mcp_efgh',
      scope: _scope,
      createdAt: 2000,
      lastUsedAt: null,
    },
    rawToken: 'praetor_mcp_raw_secret',
  }),
);
const onRevokeMcpToken = mock((_id: string) => Promise.resolve());
const onGetPersonalAccessToken = mock(() =>
  Promise.resolve({ ...tokenMetadata, token: 'praetor_pat_abc12345-secret' }),
);
const onRenewPersonalAccessToken = mock(() =>
  Promise.resolve({ ...tokenMetadata, token: 'praetor_pat_new-secret' }),
);

const totpSetupResult = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/Praetor:alice?secret=JBSWY3DPEHPK3PXP&issuer=Praetor',
  qrDataUri: 'data:image/png;base64,QR',
  backupCodes: ['11112222', '33334444'],
};
const onTotpSetup = mock(() => Promise.resolve(totpSetupResult));
const onTotpConfirm = mock((_code: string) => Promise.resolve());
const onTotpDisable = mock((_payload: { password?: string; code?: string }) => Promise.resolve());
const onRegenerateTotpBackupCodes = mock((_code: string) =>
  Promise.resolve({ backupCodes: ['55556666', '77778888'] }),
);
const onGetTotpStatus = mock(() => Promise.resolve({ enabled: false, applicable: true }));

// The five 2FA handler props are required, so every render must supply them.
// `onGetTotpStatus` defaults to a disabled-but-applicable status; individual
// tests pass an override to exercise the enabled / IdP-managed branches.
const totpProps = {
  onTotpSetup,
  onTotpConfirm,
  onTotpDisable,
  onRegenerateTotpBackupCodes,
  onGetTotpStatus,
};

const renderSettings = (
  overrides: {
    authMethod?: UserAuthMethod;
    authProviderName?: string | null;
    onUpdate?: (updates: Partial<Settings>) => Promise<void>;
    onGetPersonalAccessToken?: () => Promise<PersonalAccessToken>;
    onRenewPersonalAccessToken?: () => Promise<PersonalAccessToken>;
    onGetTotpStatus?: () => Promise<{ enabled: boolean; applicable: boolean }>;
  } = {},
) =>
  render(
    <UserSettings
      settings={settings}
      authMethod={overrides.authMethod}
      authProviderName={overrides.authProviderName}
      onUpdate={overrides.onUpdate ?? onUpdate}
      onUpdatePassword={onUpdatePassword}
      onListMcpTokens={onListMcpTokens}
      onCreateMcpToken={onCreateMcpToken}
      onRevokeMcpToken={onRevokeMcpToken}
      onGetPersonalAccessToken={overrides.onGetPersonalAccessToken ?? onGetPersonalAccessToken}
      onRenewPersonalAccessToken={
        overrides.onRenewPersonalAccessToken ?? onRenewPersonalAccessToken
      }
      {...totpProps}
      onGetTotpStatus={overrides.onGetTotpStatus ?? onGetTotpStatus}
    />,
  );

describe('<UserSettings /> profile form', () => {
  test('two rapid submits while save is in flight only call onUpdate once', async () => {
    let resolveSave!: () => void;
    const slowUpdate = mock(
      (_updates: Partial<Settings>) =>
        new Promise<void>((resolve) => {
          resolveSave = () => resolve();
        }),
    );

    const { container } = render(
      <UserSettings
        settings={settings}
        onUpdate={slowUpdate}
        onUpdatePassword={onUpdatePassword}
        onListMcpTokens={onListMcpTokens}
        onCreateMcpToken={onCreateMcpToken}
        onRevokeMcpToken={onRevokeMcpToken}
        onGetPersonalAccessToken={onGetPersonalAccessToken}
        onRenewPersonalAccessToken={onRenewPersonalAccessToken}
        {...totpProps}
      />,
    );

    // Dirty the form so the submit button is enabled (hasChanges).
    const fullNameInput = screen.getByDisplayValue('Alice') as HTMLInputElement;
    fireEvent.change(fullNameInput, { target: { value: 'Alice Edited' } });

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    // Fire the submit event twice back-to-back: the disabled-button guard would
    // miss programmatic submits, so the in-component `if (isSaving) return;`
    // is what enforces this.
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    // Only one onUpdate call should be issued for the rapid double-submit.
    expect(slowUpdate).toHaveBeenCalledTimes(1);
    // Resolve the in-flight save so the test cleans up.
    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });
  });

  test('preserves in-progress edits when the parent re-renders with a new settings reference', () => {
    const { rerender } = render(
      <UserSettings
        settings={settings}
        onUpdate={onUpdate}
        onUpdatePassword={onUpdatePassword}
        onListMcpTokens={onListMcpTokens}
        onCreateMcpToken={onCreateMcpToken}
        onRevokeMcpToken={onRevokeMcpToken}
        onGetPersonalAccessToken={onGetPersonalAccessToken}
        onRenewPersonalAccessToken={onRenewPersonalAccessToken}
        {...totpProps}
      />,
    );

    const fullNameInput = screen.getByDisplayValue('Alice') as HTMLInputElement;
    fireEvent.change(fullNameInput, { target: { value: 'Alice (editing)' } });
    expect(fullNameInput.value).toBe('Alice (editing)');

    // Parent re-renders with a NEW object reference but identical values - the
    // user's in-progress edit must not be wiped.
    rerender(
      <UserSettings
        settings={{ ...settings }}
        onUpdate={onUpdate}
        onUpdatePassword={onUpdatePassword}
        onListMcpTokens={onListMcpTokens}
        onCreateMcpToken={onCreateMcpToken}
        onRevokeMcpToken={onRevokeMcpToken}
        onGetPersonalAccessToken={onGetPersonalAccessToken}
        onRenewPersonalAccessToken={onRenewPersonalAccessToken}
        {...totpProps}
      />,
    );

    expect((screen.getByDisplayValue('Alice (editing)') as HTMLInputElement).value).toBe(
      'Alice (editing)',
    );
  });
});

describe('<UserSettings /> Security tab', () => {
  beforeEach(() => {
    for (const m of [
      onUpdate,
      onUpdatePassword,
      onListMcpTokens,
      onCreateMcpToken,
      onRevokeMcpToken,
      onGetPersonalAccessToken,
      onRenewPersonalAccessToken,
    ]) {
      m.mockClear();
    }
  });

  test('renames the password tab to Security and loads the one-time PAT', async () => {
    const getToken = mock(() =>
      Promise.resolve({ ...tokenMetadata, token: 'praetor_pat_abc12345-secret' }),
    );
    renderSettings({ onGetPersonalAccessToken: getToken });

    fireEvent.click(screen.getByText('security.title'));

    await waitFor(() => {
      expect(getToken).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByDisplayValue('praetor_pat_abc12345-secret')).toBeInTheDocument();
    expect(screen.getByText('security.personalAccessToken.visibleOnce')).toBeInTheDocument();
  });

  test('renew replaces the displayed token', async () => {
    const renewToken = mock(() =>
      Promise.resolve({ ...tokenMetadata, token: 'praetor_pat_new-secret' }),
    );
    renderSettings({ onRenewPersonalAccessToken: renewToken });

    fireEvent.click(screen.getByText('security.title'));
    await screen.findByDisplayValue('praetor_pat_abc12345-secret');

    fireEvent.click(screen.getByRole('button', { name: /security.personalAccessToken.renew/ }));

    await waitFor(() => {
      expect(renewToken).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByDisplayValue('praetor_pat_new-secret')).toBeInTheDocument();
  });

  test('copy PAT button flips its label to the copied state, then reverts', async () => {
    const originalClipboard = navigator.clipboard;
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      renderSettings();
      fireEvent.click(screen.getByText('security.title'));
      await screen.findByDisplayValue('praetor_pat_abc12345-secret');

      const copyButton = screen.getByRole('button', {
        name: /security.personalAccessToken.copy/,
      });
      await act(async () => {
        fireEvent.click(copyButton);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      expect(writeText).toHaveBeenCalledWith('praetor_pat_abc12345-secret');
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /security.personalAccessToken.copied/ }),
        ).toBeInTheDocument(),
      );
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  test('rejects a new password identical to the current password without calling the API', async () => {
    renderSettings();
    fireEvent.click(screen.getByText('security.title'));

    const samePassword = 'same-pw-1234';
    fireEvent.change(screen.getByLabelText('password.currentPassword'), {
      target: { value: samePassword },
    });
    fireEvent.change(screen.getByLabelText('password.newPassword'), {
      target: { value: samePassword },
    });
    fireEvent.change(screen.getByLabelText('password.confirmNewPassword'), {
      target: { value: samePassword },
    });

    fireEvent.click(screen.getByRole('button', { name: /password.updatePassword/ }));

    expect(await screen.findByText('password.sameAsCurrent')).toBeInTheDocument();
    expect(onUpdatePassword).not.toHaveBeenCalled();
  });

  test('finishes token load when the user leaves and returns to Security before it resolves', async () => {
    let resolveToken!: (value: typeof tokenMetadata & { token: string }) => void;
    const onGetPersonalAccessToken = mock(
      () =>
        new Promise<typeof tokenMetadata & { token: string }>((resolve) => {
          resolveToken = resolve;
        }),
    );
    renderSettings({ onGetPersonalAccessToken });

    fireEvent.click(screen.getByText('security.title'));
    expect(screen.getByDisplayValue('security.personalAccessToken.loading')).toBeInTheDocument();

    fireEvent.click(screen.getByText('userProfile.title'));
    fireEvent.click(screen.getByText('security.title'));
    resolveToken({ ...tokenMetadata, token: 'praetor_pat_abc12345-secret' });

    await waitFor(() => {
      expect(screen.getByDisplayValue('praetor_pat_abc12345-secret')).toBeInTheDocument();
    });
    expect(onGetPersonalAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe('<UserSettings /> MCP tokens', () => {
  beforeEach(() => {
    for (const m of [
      onUpdate,
      onUpdatePassword,
      onListMcpTokens,
      onCreateMcpToken,
      onRevokeMcpToken,
      onGetPersonalAccessToken,
      onRenewPersonalAccessToken,
    ]) {
      m.mockClear();
    }
  });

  test('loads MCP tokens when the MCP tab opens', async () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /mcp.title/ }));

    await waitFor(() => expect(onListMcpTokens).toHaveBeenCalled());
    expect(await screen.findByText('Agent')).toBeInTheDocument();
    expect(screen.getByText(/praetor_mcp_abcd/)).toBeInTheDocument();
  });

  test('shows the MCP endpoint URL and agent setup prompt', async () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /mcp.title/ }));

    const endpointUrl = screen.getByLabelText('mcp.urlLabel') as HTMLInputElement;
    expect(endpointUrl.value).toContain('/api/mcp');

    const setupPrompt = screen.getByLabelText('mcp.promptLabel') as HTMLTextAreaElement;
    expect(setupPrompt.value).toContain('Configure Praetor as a remote MCP server');
    expect(setupPrompt.value).toContain('MCP server URL:');
    expect(setupPrompt.value).toContain('<paste your Praetor MCP token here>');
    expect(setupPrompt.value).toContain('Do not send it in chat messages');
  });

  test('creates a token and displays the raw token once', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /mcp.title/ }));

    fireEvent.change(await screen.findByPlaceholderText('mcp.namePlaceholder'), {
      target: { value: 'External Agent' },
    });
    fireEvent.click(screen.getByRole('button', { name: /mcp.create/ }));

    await waitFor(() => expect(onCreateMcpToken).toHaveBeenCalledWith('External Agent', 'full'));
    expect(await screen.findByText('praetor_mcp_raw_secret')).toBeInTheDocument();
    expect(await screen.findByText('External Agent')).toBeInTheDocument();
    expect((screen.getByLabelText('mcp.promptLabel') as HTMLTextAreaElement).value).toContain(
      'praetor_mcp_raw_secret',
    );
  });

  test('copies MCP values when navigator.clipboard is unavailable', async () => {
    const originalClipboard = navigator.clipboard;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = mock(() => true);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    try {
      renderSettings();
      fireEvent.click(screen.getByRole('button', { name: /mcp.title/ }));
      const copyButton = await screen.findByRole('button', { name: /mcp.copyUrl/ });
      await act(async () => {
        fireEvent.click(copyButton);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      expect(execCommand).toHaveBeenCalledWith('copy');
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        Reflect.deleteProperty(document, 'execCommand');
      }
    }
  });

  test('requires confirmation before revoking a token from the list', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /mcp.title/ }));

    expect(await screen.findByText('Agent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /mcp.revoke/ }));

    expect(onRevokeMcpToken).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('mcp.revokeDialogTitle')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /mcp.revokeConfirm/ }));

    await waitFor(() => expect(onRevokeMcpToken).toHaveBeenCalledWith('mcp-token-1'));
    await waitFor(() => expect(screen.queryByText('Agent')).not.toBeInTheDocument());
  });
});

describe('<UserSettings /> RIL preferences tab', () => {
  const rilTransferOptions = ['In office', 'Remote working'];

  // renderSettings() deliberately omits rilTransferOptions, so render directly here. A per-test
  // `settings` override lets each case seed (or not seed) the stored weekday defaults.
  const renderRilSettings = (
    rilSettings: Settings = settings,
    options: string[] = rilTransferOptions,
    update: (updates: Partial<Settings>) => Promise<void> = onUpdate,
  ) =>
    render(
      <UserSettings
        settings={rilSettings}
        rilTransferOptions={options}
        onUpdate={update}
        onUpdatePassword={onUpdatePassword}
        onListMcpTokens={onListMcpTokens}
        onCreateMcpToken={onCreateMcpToken}
        onRevokeMcpToken={onRevokeMcpToken}
        onGetPersonalAccessToken={onGetPersonalAccessToken}
        onRenewPersonalAccessToken={onRenewPersonalAccessToken}
        onTotpSetup={onTotpSetup}
        onTotpConfirm={onTotpConfirm}
        onTotpDisable={onTotpDisable}
        onRegenerateTotpBackupCodes={onRegenerateTotpBackupCodes}
        onGetTotpStatus={onGetTotpStatus}
      />,
    );

  beforeEach(() => {
    for (const m of [
      onUpdate,
      onUpdatePassword,
      onListMcpTokens,
      onCreateMcpToken,
      onRevokeMcpToken,
      onGetPersonalAccessToken,
      onRenewPersonalAccessToken,
    ]) {
      m.mockClear();
    }
  });

  test('hides the RIL tab when no transfer options are configured', () => {
    // renderSettings defaults rilTransferOptions to [], so the tab must not appear.
    renderSettings();
    expect(screen.queryByRole('button', { name: /ril.title/ })).not.toBeInTheDocument();
  });

  test('shows the RIL tab when transfer options are configured', () => {
    renderRilSettings();
    expect(screen.getByRole('button', { name: /ril.title/ })).toBeInTheDocument();
  });

  test('opening the RIL tab reveals a select for each Monday..Friday weekday', () => {
    renderRilSettings();
    fireEvent.click(screen.getByRole('button', { name: /ril.title/ }));

    // The selects are keyed by id ril-transfer-monday..friday; the i18n mock does not localize
    // the Intl weekday labels, so target the controls by their stable ids.
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) {
      const trigger = document.getElementById(`ril-transfer-${day}`);
      expect(trigger).not.toBeNull();
      expect(trigger?.tagName).toBe('BUTTON');
    }
    expect(Array.from(document.querySelectorAll('[id^="ril-transfer-"]'))).toHaveLength(5);
  });

  test('pre-populates a weekday select from settings.rilWeekdayTransferDefaults', () => {
    renderRilSettings({ ...settings, rilWeekdayTransferDefaults: { friday: 'Remote working' } });
    fireEvent.click(screen.getByRole('button', { name: /ril.title/ }));

    // Controlled Radix Select renders the selected option's text inside the trigger button.
    expect(document.getElementById('ril-transfer-friday')).toHaveTextContent('Remote working');
    // An unset weekday falls back to the "no default" sentinel label.
    expect(document.getElementById('ril-transfer-monday')).toHaveTextContent('ril.noDefault');
  });

  test('selecting a transfer option for Monday pushes it through onUpdate', async () => {
    renderRilSettings({ ...settings, rilWeekdayTransferDefaults: { monday: 'In office' } });
    fireEvent.click(screen.getByRole('button', { name: /ril.title/ }));

    const mondayTrigger = document.getElementById('ril-transfer-monday') as HTMLButtonElement;
    // Seeded value is reflected before the change.
    expect(mondayTrigger).toHaveTextContent('In office');

    fireEvent.click(mondayTrigger);
    fireEvent.click(screen.getByRole('option', { name: 'Remote working' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        rilWeekdayTransferDefaults: { monday: 'Remote working' },
      }),
    );
  });

  test('choosing "No default" drops the weekday key from the persisted defaults', async () => {
    renderRilSettings({ ...settings, rilWeekdayTransferDefaults: { monday: 'In office' } });
    fireEvent.click(screen.getByRole('button', { name: /ril.title/ }));

    const mondayTrigger = document.getElementById('ril-transfer-monday') as HTMLButtonElement;
    fireEvent.click(mondayTrigger);
    fireEvent.click(screen.getByRole('option', { name: 'ril.noDefault' }));

    // The sentinel maps to "remove the key", so the resulting object has no monday entry.
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ rilWeekdayTransferDefaults: {} }));
  });

  test('serializes weekday saves and rolls back only the failed day', async () => {
    // Each save is deferred so we control ordering: serialization must hold Tuesday's PUT until
    // Monday's settles, and a failed Monday save must roll back only Monday — keeping Tuesday.
    const deferreds: Array<{ resolve: () => void; reject: (reason?: unknown) => void }> = [];
    let calls = 0;
    const update = mock((_updates: Partial<Settings>): Promise<void> => {
      calls += 1;
      return new Promise<void>((resolve, reject) => {
        deferreds.push({ resolve: () => resolve(), reject });
      });
    });

    renderRilSettings(settings, rilTransferOptions, update);
    fireEvent.click(screen.getByRole('button', { name: /ril.title/ }));

    const mondayTrigger = document.getElementById('ril-transfer-monday') as HTMLButtonElement;
    fireEvent.click(mondayTrigger);
    fireEvent.click(screen.getByRole('option', { name: 'Remote working' }));
    await waitFor(() => expect(calls).toBe(1));

    // Change Tuesday while Monday's PUT is still in flight: its save must be queued, not fired.
    const tuesdayTrigger = document.getElementById('ril-transfer-tuesday') as HTMLButtonElement;
    fireEvent.click(tuesdayTrigger);
    fireEvent.click(screen.getByRole('option', { name: 'In office' }));
    await waitFor(() => expect(tuesdayTrigger).toHaveTextContent('In office')); // optimistic
    expect(calls).toBe(1); // serialized: Tuesday's PUT waits for Monday's

    // Fail Monday's PUT. Its day rolls back; Tuesday stays, and its queued PUT now fires.
    deferreds[0].reject(new Error('save failed'));
    await waitFor(() =>
      expect(document.getElementById('ril-transfer-monday')).toHaveTextContent('ril.noDefault'),
    );
    expect(tuesdayTrigger).toHaveTextContent('In office');
    await waitFor(() => expect(calls).toBe(2));
    // The queued save is recomputed from the live map at send time: it carries Tuesday's edit
    // through (last write wins) but drops Monday, whose save failed and was rolled back.
    const secondPayload = (update.mock.calls[1][0] as Partial<Settings>).rilWeekdayTransferDefaults;
    expect(secondPayload?.tuesday).toBe('In office');
    expect(secondPayload?.monday).toBeUndefined();
    deferreds[1].resolve();
  });
});

describe('<UserSettings /> non-local auth', () => {
  beforeEach(() => {
    for (const m of [
      onUpdate,
      onUpdatePassword,
      onListMcpTokens,
      onCreateMcpToken,
      onRevokeMcpToken,
      onGetPersonalAccessToken,
      onRenewPersonalAccessToken,
    ]) {
      m.mockClear();
    }
  });

  test('Profile tab: shows lock banner and disables identity inputs for LDAP users', () => {
    renderSettings({ authMethod: 'ldap', authProviderName: null });

    expect(screen.getByText('userProfile.lockedBanner')).toBeInTheDocument();

    const fullNameInput = screen.getByDisplayValue('Alice') as HTMLInputElement;
    const emailInput = screen.getByDisplayValue('alice@example.com') as HTMLInputElement;

    expect(fullNameInput.disabled).toBe(true);
    expect(fullNameInput.readOnly).toBe(true);
    expect(emailInput.disabled).toBe(true);
    expect(emailInput.readOnly).toBe(true);

    expect(screen.queryByRole('button', { name: /general.saveChanges/ })).not.toBeInTheDocument();
  });

  test('Profile tab: submitting the form is a no-op for non-local users', async () => {
    const { container } = renderSettings({ authMethod: 'oidc', authProviderName: 'Acme SSO' });

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await act(async () => {
      await Promise.resolve();
    });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test('Security tab: replaces the password card with a lock banner; PAT card still renders', async () => {
    renderSettings({ authMethod: 'saml', authProviderName: 'Corporate SSO' });

    fireEvent.click(screen.getByText('security.title'));

    expect(await screen.findByText('password.lockedBanner')).toBeInTheDocument();

    expect(screen.queryByLabelText('password.currentPassword')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('password.newPassword')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('password.confirmNewPassword')).not.toBeInTheDocument();

    await waitFor(() => expect(onGetPersonalAccessToken).toHaveBeenCalled());
    expect(screen.getByText('security.personalAccessToken.title')).toBeInTheDocument();
  });

  test('Language change for non-local users only sends the language field', async () => {
    renderSettings({ authMethod: 'ldap' });

    fireEvent.click(screen.getByRole('button', { name: /language.title/ }));
    fireEvent.click(screen.getByText('language.italian'));

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalledWith({ language: 'it' });
  });
});

describe('<UserSettings /> Two-Factor Authentication card', () => {
  beforeEach(() => {
    for (const m of [
      onUpdate,
      onUpdatePassword,
      onListMcpTokens,
      onCreateMcpToken,
      onRevokeMcpToken,
      onGetPersonalAccessToken,
      onRenewPersonalAccessToken,
      onTotpSetup,
      onTotpConfirm,
      onTotpDisable,
      onRegenerateTotpBackupCodes,
      onGetTotpStatus,
    ]) {
      m.mockClear();
    }
  });

  test('lazily loads the 2FA status when the Security tab opens and renders the disabled badge', async () => {
    const getStatus = mock(() => Promise.resolve({ enabled: false, applicable: true }));
    renderSettings({ onGetTotpStatus: getStatus });

    // Not loaded until the Security tab is opened.
    expect(getStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('security.title'));

    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));

    // The 2FA card and its disabled-state status badge render once the status resolves.
    expect(screen.getByText('twoFactor.title')).toBeInTheDocument();
    expect(await screen.findByText('twoFactor.statusDisabled')).toBeInTheDocument();
    // Disabled status offers a Set-up affordance, not the manage actions.
    expect(screen.getByRole('button', { name: /twoFactor.setUp/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /twoFactor.disable/ })).not.toBeInTheDocument();
  });

  test('renders the enabled badge plus Disable and Regenerate actions when 2FA is enabled', async () => {
    const getStatus = mock(() => Promise.resolve({ enabled: true, applicable: true }));
    renderSettings({ onGetTotpStatus: getStatus });

    fireEvent.click(screen.getByText('security.title'));

    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));

    expect(await screen.findByText('twoFactor.statusEnabled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /twoFactor.disable/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /twoFactor.regenerateBackupCodes/ }),
    ).toBeInTheDocument();
    // The enabled state replaces the Set-up button with the manage actions.
    expect(screen.queryByRole('button', { name: /twoFactor.setUp/ })).not.toBeInTheDocument();
  });

  test('shows the IdP-managed banner and no Set-up button for OIDC users', async () => {
    // For SSO users the card is IdP-managed regardless of the (irrelevant) status payload.
    renderSettings({ authMethod: 'oidc', authProviderName: 'Acme SSO' });

    fireEvent.click(screen.getByText('security.title'));

    expect(await screen.findByText('twoFactor.idpManagedTitle')).toBeInTheDocument();
    expect(screen.getByText('twoFactor.idpManagedDescription')).toBeInTheDocument();
    // No enroll/manage affordances are offered when the IdP owns 2FA.
    expect(screen.queryByRole('button', { name: /twoFactor.setUp/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /twoFactor.disable/ })).not.toBeInTheDocument();
    // The status badge is suppressed for the IdP-managed branch.
    expect(screen.queryByText('twoFactor.statusDisabled')).not.toBeInTheDocument();
    expect(screen.queryByText('twoFactor.statusEnabled')).not.toBeInTheDocument();
  });

  test('shows the IdP-managed banner when the status reports it is not applicable', async () => {
    const getStatus = mock(() => Promise.resolve({ enabled: false, applicable: false }));
    renderSettings({ onGetTotpStatus: getStatus });

    fireEvent.click(screen.getByText('security.title'));

    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));

    expect(await screen.findByText('twoFactor.idpManagedTitle')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /twoFactor.setUp/ })).not.toBeInTheDocument();
  });

  test('clicking Set up opens the wizard dialog and kicks off the setup call', async () => {
    const getStatus = mock(() => Promise.resolve({ enabled: false, applicable: true }));
    renderSettings({ onGetTotpStatus: getStatus });

    fireEvent.click(screen.getByText('security.title'));
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));

    const setUpButton = await screen.findByRole('button', { name: /twoFactor.setUp/ });
    fireEvent.click(setUpButton);

    // The wizard dialog mounts and runs onSetup once on activation.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(onTotpSetup).toHaveBeenCalledTimes(1));
    // The scan step (wizard-only content) renders the manual key once setup resolves.
    expect(await screen.findByText('twoFactor.manualKeyLabel')).toBeInTheDocument();
    expect(screen.getByText(totpSetupResult.secret)).toBeInTheDocument();
  });

  test('disable dialog accepts an alphanumeric backup code, not only a 6-digit TOTP', async () => {
    const getStatus = mock(() => Promise.resolve({ enabled: true, applicable: true }));
    // LDAP user: the disable dialog shows only the code field (no password). The backend /disable
    // accepts a backup code, so the field must not be restricted to digits — otherwise a user who
    // lost their authenticator but holds backup codes can never turn 2FA off from the UI.
    renderSettings({ authMethod: 'ldap', onGetTotpStatus: getStatus });

    fireEvent.click(screen.getByText('security.title'));
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole('button', { name: /twoFactor.disable/ }));
    await screen.findByText('twoFactor.disableTitle');

    const codeInput = document.getElementById('totp-disable-code') as HTMLInputElement;
    // The old digits-only input stripped non-digits, leaving '' and a permanently-disabled submit.
    fireEvent.change(codeInput, { target: { value: 'abcde-fghij' } });
    expect(codeInput.value).toBe('abcde-fghij');

    const confirmButton = screen.getByRole('button', { name: 'twoFactor.confirmDisable' });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(onTotpDisable).toHaveBeenCalledTimes(1));
    expect(onTotpDisable).toHaveBeenCalledWith({ code: 'abcde-fghij' });
  });
});
