import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Settings } from '../../services/api';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

const UserSettings = (await import('../../components/UserSettings')).default;

const settings: Settings = {
  fullName: 'Alice',
  email: 'alice@example.com',
  language: 'en',
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
      name: 'Codex',
      tokenPrefix: 'praetor_mcp_efgh',
      createdAt: 2000,
      lastUsedAt: null,
    },
    rawToken: 'praetor_mcp_raw_secret',
  }),
);
const onRevokeMcpToken = mock((_id: string) => Promise.resolve());

const renderSettings = () =>
  render(
    <UserSettings
      settings={settings}
      onUpdate={onUpdate}
      onUpdatePassword={onUpdatePassword}
      onListMcpTokens={onListMcpTokens}
      onCreateMcpToken={onCreateMcpToken}
      onRevokeMcpToken={onRevokeMcpToken}
    />,
  );

describe('<UserSettings /> MCP tokens', () => {
  beforeEach(() => {
    for (const m of [
      onUpdate,
      onUpdatePassword,
      onListMcpTokens,
      onCreateMcpToken,
      onRevokeMcpToken,
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

  test('shows the MCP endpoint URL and Codex setup prompt', async () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /mcp.title/ }));

    const endpointUrl = screen.getByLabelText('mcp.urlLabel') as HTMLInputElement;
    expect(endpointUrl.value).toContain('/api/mcp');

    const setupPrompt = screen.getByLabelText('mcp.promptLabel') as HTMLTextAreaElement;
    expect(setupPrompt.value).toContain('MCP server URL:');
    expect(setupPrompt.value).toContain('<paste your Praetor MCP token here>');
  });

  test('creates a token and displays the raw token once', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /mcp.title/ }));

    fireEvent.change(await screen.findByPlaceholderText('mcp.namePlaceholder'), {
      target: { value: 'Codex' },
    });
    fireEvent.click(screen.getByRole('button', { name: /mcp.create/ }));

    await waitFor(() => expect(onCreateMcpToken).toHaveBeenCalledWith('Codex'));
    expect(await screen.findByText('praetor_mcp_raw_secret')).toBeInTheDocument();
    expect(await screen.findByText('Codex')).toBeInTheDocument();
    expect((screen.getByLabelText('mcp.promptLabel') as HTMLTextAreaElement).value).toContain(
      'praetor_mcp_raw_secret',
    );
  });

  test('revokes a token from the list', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /mcp.title/ }));

    expect(await screen.findByText('Agent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /mcp.revoke/ }));

    await waitFor(() => expect(onRevokeMcpToken).toHaveBeenCalledWith('mcp-token-1'));
    await waitFor(() => expect(screen.queryByText('Agent')).not.toBeInTheDocument());
  });
});
