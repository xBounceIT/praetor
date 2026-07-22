import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as generalSettingsRepo from '../repositories/generalSettingsRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { normalizeGeminiModelPath } from '../utils/ai-models.ts';
import {
  fetchLocalAi,
  localAiEndpointUrl,
  localAiHeaders,
  normalizeLocalAiBaseUrl,
} from '../utils/local-ai-endpoint.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { badRequest, optionalNonEmptyString, validateEnum } from '../utils/validation.ts';

const googleModelExists = async (apiKey: string, modelPath: string): Promise<boolean> => {
  const url = new URL(`/v1beta/${modelPath}`, 'https://generativelanguage.googleapis.com');
  url.searchParams.set('key', apiKey);
  const res = await fetch(url, { method: 'GET' });
  if (res.status === 404) return false;
  return res.ok;
};

type OpenRouterModel = { id: string; name?: string };

const listOpenRouterModels = async (apiKey: string): Promise<OpenRouterModel[]> => {
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
};

const openrouterModelExists = async (
  apiKey: string,
  modelId: string,
): Promise<OpenRouterModel | null> => {
  const models = await listOpenRouterModels(apiKey);
  const match = models.find((m) => m.id === modelId.trim());
  return match || null;
};

type AnthropicModel = { id: string; display_name?: string };

const anthropicModelExists = async (
  apiKey: string,
  modelId: string,
): Promise<AnthropicModel | null> => {
  const normalizedModelId = modelId.trim();
  const url = new URL(
    `/v1/models/${encodeURIComponent(normalizedModelId)}`,
    'https://api.anthropic.com',
  );
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Anthropic model request failed: HTTP ${res.status}`);
  }
  return (await res.json()) as AnthropicModel;
};

type OpenAiModel = { id: string };

const openaiModelExists = async (apiKey: string, modelId: string): Promise<OpenAiModel | null> => {
  const normalizedModelId = modelId.trim();
  const res = await fetch(
    `https://api.openai.com/v1/models/${encodeURIComponent(normalizedModelId)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OpenAI model request failed: HTTP ${res.status}`);
  const model = (await res.json()) as { id?: string };
  return model.id ? { id: model.id } : null;
};

const localModelExists = async (
  baseUrl: string,
  apiKey: string,
  modelId: string,
): Promise<OpenRouterModel | null> => {
  const res = await fetchLocalAi(localAiEndpointUrl(baseUrl, 'models'), {
    method: 'GET',
    headers: localAiHeaders(apiKey),
    redirect: 'error',
  });
  if (!res.ok) throw new Error(`Local AI models request failed: HTTP ${res.status}`);
  const data = (await res.json()) as { data?: OpenRouterModel[] };
  return data.data?.find(({ id }) => id === modelId.trim()) || null;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // POST /validate-model - Admin-only utility used by General Settings UI.
  fastify.post(
    '/validate-model',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.general.update'),
      ],
      schema: {
        tags: ['ai'],
        summary: 'Validate that a model exists on the selected provider',
        body: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            modelId: { type: 'string' },
            apiKey: { type: 'string' },
            baseUrl: { type: 'string' },
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
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { provider, modelId, apiKey, baseUrl } = request.body as {
        provider: string;
        modelId: string;
        apiKey?: string;
        baseUrl?: string;
      };

      const providerResult = validateEnum(
        provider,
        ['gemini', 'openrouter', 'anthropic', 'openai', 'local'],
        'provider',
      );
      if (!providerResult.ok) return badRequest(reply, providerResult.message);

      const modelIdResult = optionalNonEmptyString(modelId, 'modelId');
      if (!modelIdResult.ok) return badRequest(reply, modelIdResult.message);
      const resolvedModelId = (modelIdResult as { ok: true; value: string | null }).value || '';
      if (!resolvedModelId) return badRequest(reply, 'modelId is required');

      let keyToUse = '';
      let localBaseUrl = '';
      const savedSettings =
        apiKey === undefined || (providerResult.value === 'local' && baseUrl === undefined)
          ? await generalSettingsRepo.getWithAiApiKey(providerResult.value)
          : null;
      if (apiKey !== undefined) {
        if (typeof apiKey !== 'string') return badRequest(reply, 'apiKey must be a string');
        keyToUse = apiKey;
      } else {
        const settingsKeys = {
          gemini: savedSettings?.geminiApiKey ?? '',
          openrouter: savedSettings?.openrouterApiKey ?? '',
          anthropic: savedSettings?.anthropicApiKey ?? '',
          openai: savedSettings?.openaiApiKey ?? '',
          local: savedSettings?.localApiKey ?? '',
        };
        keyToUse = settingsKeys[providerResult.value];
      }
      if (providerResult.value === 'local') localBaseUrl = savedSettings?.localBaseUrl ?? '';

      if (providerResult.value === 'local' && baseUrl !== undefined) {
        if (typeof baseUrl !== 'string') return badRequest(reply, 'baseUrl must be a string');
        const baseUrlResult = normalizeLocalAiBaseUrl(baseUrl);
        if (!baseUrlResult.ok) return badRequest(reply, baseUrlResult.message);
        localBaseUrl = baseUrlResult.value;
      }

      if (providerResult.value === 'local' && !localBaseUrl) {
        return badRequest(reply, 'baseUrl is required for local AI');
      }

      if (providerResult.value !== 'local' && !keyToUse.trim()) {
        return reply.send({
          ok: false,
          code: 'MISSING_API_KEY',
          message: 'API key is required to check model availability.',
        });
      }

      try {
        if (providerResult.value === 'local') {
          const match = await localModelExists(localBaseUrl, keyToUse, resolvedModelId);
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
        }

        if (providerResult.value === 'gemini') {
          const normalizedModelIdResult = normalizeGeminiModelPath(resolvedModelId);
          if (!normalizedModelIdResult.ok) {
            return badRequest(reply, normalizedModelIdResult.message);
          }
          const normalizedModelId = normalizedModelIdResult.value;
          const exists = await googleModelExists(keyToUse, normalizedModelId);
          return reply.send(
            exists
              ? { ok: true, normalizedModelId }
              : { ok: false, code: 'NOT_FOUND', message: 'Model not found.', normalizedModelId },
          );
        }

        if (providerResult.value === 'openrouter') {
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
        }

        if (providerResult.value === 'openai') {
          const match = await openaiModelExists(keyToUse, resolvedModelId);
          return reply.send(
            match
              ? { ok: true, normalizedModelId: match.id }
              : {
                  ok: false,
                  code: 'NOT_FOUND',
                  message: 'Model not found.',
                  normalizedModelId: resolvedModelId,
                },
          );
        }

        const match = await anthropicModelExists(keyToUse, resolvedModelId);
        return reply.send(
          match
            ? {
                ok: true,
                normalizedModelId: match.id,
                name: match.display_name || '',
              }
            : {
                ok: false,
                code: 'NOT_FOUND',
                message: 'Model not found.',
                normalizedModelId: resolvedModelId,
              },
        );
      } catch (err) {
        const msg =
          providerResult.value === 'local'
            ? 'Unable to verify model with the Local AI endpoint.'
            : err instanceof Error
              ? err.message
              : 'Unable to verify model.';
        return reply.send({ ok: false, code: 'PROVIDER_ERROR', message: msg });
      }
    },
  );
}
