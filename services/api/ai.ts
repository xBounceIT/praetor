import type { AiProvider } from '../../types';
import { fetchApi } from './client';

export const aiApi = {
  validateModel: (data: {
    provider: AiProvider;
    modelId: string;
    apiKey?: string;
    ollamaBaseUrl?: string;
    ollamaBearerToken?: string;
  }): Promise<{
    ok: boolean;
    code?: string;
    message?: string;
    normalizedModelId?: string;
    name?: string;
  }> =>
    fetchApi('/ai/validate-model', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
