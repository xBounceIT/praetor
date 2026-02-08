import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses } from '../schemas/common.ts';
import { cacheGetSetJson } from '../services/cache.ts';
import { badRequest, optionalNonEmptyString, validateEnum } from '../utils/validation.ts';

type AiProvider = 'gemini' | 'openrouter';

type GeneralAiConfig = {
  enableAiInsights: boolean;
  aiProvider: AiProvider;
  geminiApiKey: string;
  openrouterApiKey: string;
  geminiModelId: string;
  openrouterModelId: string;
};

const getGeneralAiConfig = async (): Promise<GeneralAiConfig> => {
  const result = await query(
    `SELECT enable_ai_insights, ai_provider, gemini_api_key, openrouter_api_key, gemini_model_id, openrouter_model_id
     FROM general_settings
     WHERE id = 1`,
  );
  const row = result.rows[0];
  return {
    enableAiInsights: row?.enable_ai_insights ?? false,
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

const extractFirstJsonObject = (text: string): string | null => {
  const t = text.trim();
  const start = t.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
};

const googleTextFromGenerateContent = (payload: unknown): string => {
  const p = payload as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const parts = p.candidates?.[0]?.content?.parts || [];
  return parts
    .map((x) => x.text || '')
    .join('')
    .trim();
};

const openrouterTextFromCompletion = (payload: unknown): string => {
  const p = payload as { choices?: Array<{ message?: { content?: string } }> };
  return (p.choices?.[0]?.message?.content || '').trim();
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

const ensureAiEnabled = (cfg: GeneralAiConfig, reply: FastifyReply) => {
  if (!cfg.enableAiInsights) {
    reply.code(400).send({ error: 'AI features are disabled by administration.' });
    return false;
  }
  return true;
};

const resolveProviderKeyModel = (cfg: GeneralAiConfig) => {
  if (cfg.aiProvider === 'openrouter') {
    return {
      provider: 'openrouter' as const,
      apiKey: cfg.openrouterApiKey,
      modelId: cfg.openrouterModelId,
    };
  }
  return { provider: 'gemini' as const, apiKey: cfg.geminiApiKey, modelId: cfg.geminiModelId };
};

const geminiGenerateText = async (apiKey: string, modelId: string, prompt: string) => {
  const path = normalizeGeminiModelPath(modelId);
  const url = `https://generativelanguage.googleapis.com/v1beta/${path}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini request failed: HTTP ${res.status}`);
  const data = await res.json();
  return googleTextFromGenerateContent(data);
};

const openrouterGenerateText = async (apiKey: string, modelId: string, prompt: string) => {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a strict assistant. Follow instructions exactly. If asked for JSON, return ONLY valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter request failed: HTTP ${res.status}`);
  const data = await res.json();
  return openrouterTextFromCompletion(data);
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

  // POST /parse-smart-entry - Used by all authenticated users.
  fastify.post(
    '/parse-smart-entry',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['ai'],
        summary: 'Parse natural language time entry into structured fields',
        body: {
          type: 'object',
          properties: { input: { type: 'string' } },
          required: ['input'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              project: { type: 'string' },
              task: { type: 'string' },
              duration: { type: 'number' },
              notes: { type: 'string' },
            },
            required: ['project', 'task', 'duration'],
          },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { input } = request.body as { input: string };
      if (typeof input !== 'string' || !input.trim()) return badRequest(reply, 'input is required');

      const cfg = await getGeneralAiConfig();
      if (!ensureAiEnabled(cfg, reply)) return;

      const { provider, apiKey, modelId } = resolveProviderKeyModel(cfg);
      if (!apiKey.trim())
        return badRequest(reply, `Missing ${provider} API key in General Settings.`);
      if (!modelId.trim())
        return badRequest(reply, `Missing ${provider} model id in General Settings.`);

      const prompt = `Parse this time tracking input: "${input.trim()}".\n\nReturn ONLY a valid JSON object with keys:\n- project: string (default "General" if missing)\n- task: string\n- duration: number (hours, decimal; convert minutes like 30m -> 0.5)\n- notes: string (optional)\n\nNo markdown. No code fences. JSON only.`;

      try {
        const text =
          provider === 'gemini'
            ? await geminiGenerateText(apiKey, modelId, prompt)
            : await openrouterGenerateText(apiKey, modelId, prompt);

        const jsonText = extractFirstJsonObject(text);
        if (!jsonText) return reply.code(502).send({ error: 'AI did not return valid JSON.' });

        const parsed = JSON.parse(jsonText) as {
          project?: unknown;
          task?: unknown;
          duration?: unknown;
          notes?: unknown;
        };

        const project =
          typeof parsed.project === 'string' && parsed.project.trim()
            ? parsed.project.trim()
            : 'General';
        const task = typeof parsed.task === 'string' ? parsed.task.trim() : '';
        const duration =
          typeof parsed.duration === 'number' ? parsed.duration : Number(parsed.duration);
        const notes = typeof parsed.notes === 'string' ? parsed.notes : '';

        if (!task || !Number.isFinite(duration) || duration <= 0) {
          return reply.code(502).send({ error: 'AI returned an invalid result.' });
        }

        return reply.send({ project, task, duration, ...(notes ? { notes } : {}) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'AI request failed';
        return reply.code(502).send({ error: msg });
      }
    },
  );

  // POST /insights - Used by all authenticated users.
  fastify.post(
    '/insights',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['ai'],
        summary: 'Generate short productivity insights from recent time entries',
        body: {
          type: 'object',
          properties: {
            entries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string' },
                  clientName: { type: 'string' },
                  projectName: { type: 'string' },
                  task: { type: 'string' },
                  duration: { type: 'number' },
                  notes: { type: 'string' },
                },
                required: ['date', 'clientName', 'projectName', 'task', 'duration'],
              },
            },
          },
          required: ['entries'],
        },
        response: {
          200: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { entries } = request.body as { entries: unknown };
      if (!Array.isArray(entries)) return badRequest(reply, 'entries must be an array');

      const cfg = await getGeneralAiConfig();
      if (!ensureAiEnabled(cfg, reply)) return;

      const { provider, apiKey, modelId } = resolveProviderKeyModel(cfg);
      if (!apiKey.trim())
        return badRequest(reply, `Missing ${provider} API key in General Settings.`);
      if (!modelId.trim())
        return badRequest(reply, `Missing ${provider} model id in General Settings.`);

      const safeEntries = (entries as Array<Record<string, unknown>>).slice(0, 25).map((e) => ({
        date: String(e.date || ''),
        clientName: String(e.clientName || ''),
        projectName: String(e.projectName || ''),
        task: String(e.task || ''),
        duration: Number(e.duration || 0),
        notes: typeof e.notes === 'string' ? e.notes : '',
      }));

      const prompt = `You are a productivity coach. Analyze these time logs and provide 2-3 concise bullet points of insights or patterns. Keep it short and data-driven.\n\nTime logs JSON:\n${JSON.stringify(
        safeEntries,
      )}\n\nReturn plain text bullets.`;

      try {
        const text =
          provider === 'gemini'
            ? await geminiGenerateText(apiKey, modelId, prompt)
            : await openrouterGenerateText(apiKey, modelId, prompt);

        return reply.send({
          text:
            text ||
            'Keep up the great work! Consistent tracking is the first step to optimization.',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'AI request failed';
        return reply.code(502).send({ error: msg });
      }
    },
  );
}
