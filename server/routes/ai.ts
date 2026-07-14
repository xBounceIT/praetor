import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as generalSettingsRepo from '../repositories/generalSettingsRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { normalizeGeminiModelPath } from '../utils/ai-models.ts';
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
      const { provider, modelId, apiKey } = request.body as {
        provider: string;
        modelId: string;
        apiKey?: string;
      };

      const providerResult = validateEnum(
        provider,
        ['gemini', 'openrouter', 'anthropic'],
        'provider',
      );
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
        const settings = await generalSettingsRepo.get();
        if (providerResult.value === 'gemini') {
          keyToUse = settings?.geminiApiKey ?? '';
        } else if (providerResult.value === 'openrouter') {
          keyToUse = settings?.openrouterApiKey ?? '';
        } else {
          keyToUse = settings?.anthropicApiKey ?? '';
        }
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
        const msg = err instanceof Error ? err.message : 'Unable to verify model.';
        return reply.send({ ok: false, code: 'PROVIDER_ERROR', message: msg });
      }
    },
  );
}
