import type { EmailConfig } from '../../types';
import { fetchApi } from './client';

export const emailApi = {
  getConfig: (): Promise<EmailConfig> => fetchApi('/email/config'),

  updateConfig: (config: Partial<EmailConfig>): Promise<EmailConfig> =>
    fetchApi('/email/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  sendTestEmail: (
    recipientEmail: string,
  ): Promise<{
    success: boolean;
    code: string;
    params?: Record<string, string>;
    messageId?: string;
  }> =>
    fetchApi('/email/test', {
      method: 'POST',
      body: JSON.stringify({ recipientEmail }),
    }),

  testConnection: (): Promise<{ success: boolean; message: string }> =>
    fetchApi('/email/test-connection', { method: 'POST' }),
};
