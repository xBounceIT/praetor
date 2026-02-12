import { fetchApi } from './client';

export const aiApi = {
  validateModel: (data: {
    provider: 'gemini' | 'openrouter';
    modelId: string;
    apiKey?: string;
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
