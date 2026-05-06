import type { PublicSsoProvider, SsoProvider } from '../../types';
import { fetchApi } from './client';

export const ssoApi = {
  listPublicProviders: (): Promise<PublicSsoProvider[]> => fetchApi('/sso/providers/public'),

  listProviders: (): Promise<SsoProvider[]> => fetchApi('/sso/providers'),

  createProvider: (provider: Partial<SsoProvider>): Promise<SsoProvider> =>
    fetchApi('/sso/providers', {
      method: 'POST',
      body: JSON.stringify(provider),
    }),

  updateProvider: (id: string, provider: Partial<SsoProvider>): Promise<SsoProvider> =>
    fetchApi(`/sso/providers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(provider),
    }),

  deleteProvider: (id: string): Promise<void> =>
    fetchApi(`/sso/providers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};
