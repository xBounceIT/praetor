import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses } from '../schemas/common.ts';
import { cacheGetSetJson } from '../services/cache.ts';
import { badRequest, optionalNonEmptyString, validateEnum } from '../utils/validation.ts';

type AiProvider = 'gemini' | 'openrouter';

type GeneralAiConfig = {
  aiProvider: AiProvider;
  geminiApiKey: string;
  openrouterApiKey: string;
  geminiModelId: string;
  openrouterModelId: string;
};

const getGeneralAiConfig = async (): Promise<GeneralAiConfig> => {
  const result = await query(
    `SELECT ai_provider, gemini_api_key, openrouter_api_key, gemini_model_id, openrouter_model_id
     FROM general_settings
     WHERE id = 1`,
  );
  const row = result.rows[0];
  return {
    aiProvider: (row?.ai_provider || 'gemini') as AiProvider,
    geminiApiKey: row?.gemini_api_key || '',
    openrouterApiKey: row?.openrouter_api_key || '',
    geminiModelId: row?.gemini_model_id || '',
    openrouterModelId: row?.openrouter_model_id || '',
  };
};

const normalizeGeminiModelPath = (modelId: string) => {
  const trimmed = modelId.trim();
  if (trimmed.startsWith('models/') || trimmed.startsWith('tunedModels/')) return trimmed;
  return `models/${trimmed}`;
};

const googleModelExists = async (apiKey: string, modelId: string): Promise<boolean> => {
  const path = normalizeGeminiModelPath(modelId);
  const url = `https://generativelanguage.googleapis.com/v1beta/${path}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: 'GET' });
  if (res.status === 404) return false;
  return res.ok;
};

type OpenRouterModel = { id: string; name?: string };

const listOpenRouterModels = async (apiKey: string): Promise<OpenRouterModel[]> => {
  // The models list is not user-specific. Cache to avoid repeated calls.
  const { value } = await cacheGetSetJson<OpenRouterModel[]>(
    'openrouter-models',
    'v=1',
    60 * 60,
    async () => {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (!res.ok) {
        throw new Error(`OpenRouter models request failed: HTTP ${res.status}`);
      }
      const data = (await res.json()) as { data?: Array<{ id: string; name?: string }> };
      return (data.data || []).map((m) => ({ id: m.id, name: m.name }));
    },
  );
  return value;
};

const openrouterModelExists = async (
  apiKey: string,
  modelId: string,
): Promise<OpenRouterModel | null> => {
  const models = await listOpenRouterModels(apiKey);
  const match = models.find((m) => m.id === modelId.trim());
  return match || null;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // POST /validate-model - Admin-only utility used by General Settings UI.
  fastify.post(
    '/validate-model',
    {
      onRequest: [authenticateToken, requirePermission('administration.general.update')],
      schema: {
        tags: ['ai'],
        summary: 'Validate that a model exists on the selected provider',
        body: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            modelId: { type: 'string' },
            apiKey: { type: 'string' },
          },
          required: ['provider', 'modelId'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              code: { type: 'string' },
              message: { type: 'string' },
              normalizedModelId: { type: 'string' },
              name: { type: 'string' },
            },
            required: ['ok'],
          },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { provider, modelId, apiKey } = request.body as {
        provider: string;
        modelId: string;
        apiKey?: string;
      };

      const providerResult = validateEnum(provider, ['gemini', 'openrouter'], 'provider');
      if (!providerResult.ok) return badRequest(reply, providerResult.message);

      const modelIdResult = optionalNonEmptyString(modelId, 'modelId');
      if (!modelIdResult.ok) return badRequest(reply, modelIdResult.message);
      const resolvedModelId = (modelIdResult as { ok: true; value: string | null }).value || '';
      if (!resolvedModelId) return badRequest(reply, 'modelId is required');

      let keyToUse = '';
      if (apiKey !== undefined) {
        if (typeof apiKey !== 'string') return badRequest(reply, 'apiKey must be a string');
        keyToUse = apiKey;
      } else {
        const cfg = await getGeneralAiConfig();
        keyToUse = providerResult.value === 'gemini' ? cfg.geminiApiKey : cfg.openrouterApiKey;
      }

      if (!keyToUse.trim()) {
        return reply.send({
          ok: false,
          code: 'MISSING_API_KEY',
          message: 'API key is required to check model availability.',
        });
      }

      try {
        if (providerResult.value === 'gemini') {
          const normalizedModelId = normalizeGeminiModelPath(resolvedModelId);
          const exists = await googleModelExists(keyToUse, resolvedModelId);
          return reply.send(
            exists
              ? { ok: true, normalizedModelId }
              : { ok: false, code: 'NOT_FOUND', message: 'Model not found.', normalizedModelId },
          );
        }

        const match = await openrouterModelExists(keyToUse, resolvedModelId);
        return reply.send(
          match
            ? { ok: true, normalizedModelId: match.id, name: match.name || '' }
            : {
                ok: false,
                code: 'NOT_FOUND',
                message: 'Model not found.',
                normalizedModelId: resolvedModelId,
              },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to verify model.';
        return reply.send({ ok: false, code: 'PROVIDER_ERROR', message: msg });
      }
    },
  );
}
