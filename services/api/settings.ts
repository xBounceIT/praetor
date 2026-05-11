import { fetchApi } from './client';
import type { PersonalAccessToken, Settings } from './contracts';

export type McpToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type CreatedMcpToken = {
  token: McpToken;
  rawToken: string;
};

export const settingsApi = {
  get: (): Promise<Settings> => fetchApi('/settings'),

  update: (settings: Partial<Settings>): Promise<Settings> =>
    fetchApi('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  updatePassword: (currentPassword: string, newPassword: string): Promise<{ message: string }> =>
    fetchApi('/settings/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  listMcpTokens: (): Promise<McpToken[]> => fetchApi('/settings/mcp-tokens'),

  createMcpToken: (name: string): Promise<CreatedMcpToken> =>
    fetchApi('/settings/mcp-tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  revokeMcpToken: (id: string): Promise<{ message: string }> =>
    fetchApi(`/settings/mcp-tokens/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getPersonalAccessToken: (): Promise<PersonalAccessToken> =>
    fetchApi('/settings/personal-access-token'),

  renewPersonalAccessToken: (): Promise<PersonalAccessToken> =>
    fetchApi('/settings/personal-access-token/renew', {
      method: 'POST',
    }),
};
