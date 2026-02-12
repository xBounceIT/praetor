import type { GeneralSettings } from '../../types';
import { fetchApi } from './client';
import { normalizeGeneralSettings } from './normalizers';

export const generalSettingsApi = {
  get: (): Promise<GeneralSettings> =>
    fetchApi<GeneralSettings>('/general-settings').then(normalizeGeneralSettings),

  update: (settings: Partial<GeneralSettings>): Promise<GeneralSettings> =>
    fetchApi<GeneralSettings>('/general-settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }).then(normalizeGeneralSettings),
};
