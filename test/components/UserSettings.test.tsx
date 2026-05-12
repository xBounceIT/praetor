import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PersonalAccessToken, Settings } from '../../services/api';
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
      createdAt: 1000,
      lastUsedAt: null,
    },
  ]),
);
const onCreateMcpToken = mock((_name: string) =>
  Promise.resolve({
    token: {
      id: 'mcp-token-2',
      name: 'External Agent',
      tokenPrefix: 'praetor_mcp_efgh',
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

const renderSettings = (
  overrides: {
    onGetPersonalAccessToken?: () => Promise<PersonalAccessToken>;
    onRenewPersonalAccessToken?: () => Promise<PersonalAccessToken>;
  } = {},
) =>
  render(
    <UserSettings
      settings={settings}
      onUpdate={onUpdate}
      onUpdatePassword={onUpdatePassword}
      onListMcpTokens={onListMcpTokens}
      onCreateMcpToken={onCreateMcpToken}
      onRevokeMcpToken={onRevokeMcpToken}
      onGetPersonalAccessToken={overrides.onGetPersonalAccessToken ?? onGetPersonalAccessToken}
      onRenewPersonalAccessToken={
        overrides.onRenewPersonalAccessToken ?? onRenewPersonalAccessToken
      }
    />,
  );

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

    await waitFor(() => expect(onCreateMcpToken).toHaveBeenCalledWith('External Agent'));
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
      fireEvent.click(await screen.findByRole('button', { name: /mcp.copyUrl/ }));

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
