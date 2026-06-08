import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  type StoredWebhookHeader,
  WEBHOOK_AUTH_TYPES,
  WEBHOOK_HTTP_METHODS,
} from '../db/schema/webhooks.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as webhooksRepo from '../repositories/webhooksRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import * as webhooksService from '../services/webhooks.ts';
import { logAudit } from '../utils/audit.ts';
import { MASKED_SECRET } from '../utils/crypto.ts';
import { replyError } from '../utils/replyError.ts';
import {
  badRequest,
  parseBooleanField,
  requireNonEmptyString,
  validateEnum,
} from '../utils/validation.ts';

const MAX_CUSTOM_HEADERS = 50;

// Mirror the varchar widths in server/db/schema/webhooks.ts. Without these, an over-length value
// passes AJV and the semantic validator, reaches Postgres, and overflows the column — surfacing as
// a 500 instead of a clean 400. (`description`/`authSecret` are `text` columns, so unbounded.)
const MAX_NAME_LEN = 255;
const MAX_URL_LEN = 2000;
const MAX_AUTH_FIELD_LEN = 255;

const customHeaderSchema = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    value: { type: 'string' },
  },
  required: ['key', 'value'],
  additionalProperties: false,
} as const;

// Full webhook as returned to the admin UI. `authSecret` is always masked here (never the
// ciphertext), so the response can be rendered without ever exposing the stored credential.
const webhookResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    url: { type: 'string' },
    httpMethod: { type: 'string', enum: [...WEBHOOK_HTTP_METHODS] },
    authType: { type: 'string', enum: [...WEBHOOK_AUTH_TYPES] },
    authUsername: { type: 'string' },
    authHeaderName: { type: 'string' },
    authSecret: { type: 'string' },
    customHeaders: { type: 'array', items: customHeaderSchema },
    enabled: { type: 'boolean' },
  },
  required: [
    'id',
    'name',
    'description',
    'url',
    'httpMethod',
    'authType',
    'authUsername',
    'authHeaderName',
    'authSecret',
    'customHeaders',
    'enabled',
  ],
} as const;

const webhookBodyProperties = {
  name: { type: 'string', maxLength: MAX_NAME_LEN },
  description: { type: 'string' },
  url: { type: 'string', maxLength: MAX_URL_LEN },
  httpMethod: { type: 'string', enum: [...WEBHOOK_HTTP_METHODS] },
  authType: { type: 'string', enum: [...WEBHOOK_AUTH_TYPES] },
  authUsername: { type: 'string', maxLength: MAX_AUTH_FIELD_LEN },
  authHeaderName: { type: 'string', maxLength: MAX_AUTH_FIELD_LEN },
  authSecret: { type: 'string' },
  customHeaders: { type: 'array', items: customHeaderSchema, maxItems: MAX_CUSTOM_HEADERS },
  enabled: { type: 'boolean' },
} as const;

const webhookBodySchema = {
  type: 'object',
  properties: webhookBodyProperties,
  additionalProperties: false,
} as const;

const idParamsSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

const isValidWebhookUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const parseCustomHeaders = (
  value: unknown,
): { ok: true; value: StoredWebhookHeader[] } | { ok: false; message: string } => {
  if (!Array.isArray(value)) {
    return { ok: false, message: 'customHeaders must be an array' };
  }
  if (value.length > MAX_CUSTOM_HEADERS) {
    return { ok: false, message: `customHeaders cannot exceed ${MAX_CUSTOM_HEADERS} entries` };
  }
  const headers: StoredWebhookHeader[] = [];
  for (let i = 0; i < value.length; i++) {
    const entry = value[i] as { key?: unknown; value?: unknown };
    const key = requireNonEmptyString(entry?.key, `customHeaders[${i}].key`);
    if (!key.ok) return { ok: false, message: key.message };
    if (typeof entry?.value !== 'string') {
      return { ok: false, message: `customHeaders[${i}].value must be a string` };
    }
    headers.push({ key: key.value, value: entry.value });
  }
  return { ok: true, value: headers };
};

// Validate + normalize a create/update body into a service input. Fastify/AJV has already enforced
// the JSON shape (types, enum membership, additionalProperties); this layer adds the semantics AJV
// can't express: required-on-create, URL scheme, per-entry header checks, and trimming. `authSecret`
// is intentionally NOT trimmed — surrounding whitespace can be meaningful in a credential, so the
// value is stored exactly as sent (the UI signals "keep the stored secret" by omitting the field).
const validateWebhookBody = (
  body: Record<string, unknown>,
  reply: FastifyReply,
  options: { isCreate: boolean },
): webhooksService.WebhookInput | null => {
  const input: webhooksService.WebhookInput = {};

  if (options.isCreate || body.name !== undefined) {
    const name = requireNonEmptyString(body.name, 'name');
    if (!name.ok) {
      badRequest(reply, name.message);
      return null;
    }
    input.name = name.value;
  }

  if (options.isCreate || body.url !== undefined) {
    const url = requireNonEmptyString(body.url, 'url');
    if (!url.ok) {
      badRequest(reply, url.message);
      return null;
    }
    if (!isValidWebhookUrl(url.value)) {
      badRequest(reply, 'url must be a valid http(s) URL');
      return null;
    }
    input.url = url.value;
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      badRequest(reply, 'description must be a string');
      return null;
    }
    input.description = body.description.trim();
  }

  if (body.httpMethod !== undefined) {
    const method = validateEnum(body.httpMethod, WEBHOOK_HTTP_METHODS, 'httpMethod');
    if (!method.ok) {
      badRequest(reply, method.message);
      return null;
    }
    input.httpMethod = method.value;
  }

  if (body.authType !== undefined) {
    const authType = validateEnum(body.authType, WEBHOOK_AUTH_TYPES, 'authType');
    if (!authType.ok) {
      badRequest(reply, authType.message);
      return null;
    }
    input.authType = authType.value;
  }

  if (body.authUsername !== undefined) {
    if (typeof body.authUsername !== 'string') {
      badRequest(reply, 'authUsername must be a string');
      return null;
    }
    input.authUsername = body.authUsername.trim();
  }

  if (body.authHeaderName !== undefined) {
    if (typeof body.authHeaderName !== 'string') {
      badRequest(reply, 'authHeaderName must be a string');
      return null;
    }
    input.authHeaderName = body.authHeaderName.trim();
  }

  if (body.authSecret !== undefined) {
    if (typeof body.authSecret !== 'string') {
      badRequest(reply, 'authSecret must be a string');
      return null;
    }
    input.authSecret = body.authSecret;
  }

  if (body.customHeaders !== undefined) {
    const headers = parseCustomHeaders(body.customHeaders);
    if (!headers.ok) {
      badRequest(reply, headers.message);
      return null;
    }
    input.customHeaders = headers.value;
  }

  const enabled = parseBooleanField(body, 'enabled');
  if (!enabled.ok) {
    badRequest(reply, enabled.message);
    return null;
  }
  if (enabled.value !== undefined) input.enabled = enabled.value;

  // An api-key scheme needs the header to send the key under. On create there is no stored header to
  // fall back on, so require it here. On update the header is optional in the body: the service
  // preserves the existing one (and rejects a switch to api_key that would leave it empty), so a
  // partial update that merely echoes authType must not be forced to resend the header every time.
  if (
    options.isCreate &&
    input.authType === 'api_key' &&
    !(input.authHeaderName && input.authHeaderName.length > 0)
  ) {
    badRequest(reply, 'authHeaderName is required when authType is api_key');
    return null;
  }

  return input;
};

// Replace the stored ciphertext with the mask sentinel so the real credential never leaves the
// server. An empty secret (auth type none, or not yet set) stays empty so the UI shows no secret.
const serializeForResponse = (webhook: webhooksRepo.Webhook) => ({
  ...webhook,
  authSecret: webhook.authSecret ? MASKED_SECRET : '',
});

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('administration.webhooks.view')],
      schema: {
        tags: ['webhooks'],
        summary: 'List webhook targets',
        response: {
          200: { type: 'array', items: webhookResponseSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => {
      const items = await webhooksRepo.list();
      return items.map(serializeForResponse);
    },
  );

  fastify.get(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('administration.webhooks.view')],
      schema: {
        tags: ['webhooks'],
        summary: 'Get a webhook target by id',
        params: idParamsSchema,
        response: {
          200: webhookResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const webhook = await webhooksRepo.findById(id);
      if (!webhook) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Webhook not found',
          action: 'webhook.get.not_found',
          entityType: 'webhook',
          entityId: id,
        });
      }
      return serializeForResponse(webhook);
    },
  );

  fastify.post(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('administration.webhooks.create')],
      schema: {
        tags: ['webhooks'],
        summary: 'Create a webhook target',
        body: webhookBodySchema,
        response: {
          201: webhookResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const input = validateWebhookBody(request.body as Record<string, unknown>, reply, {
        isCreate: true,
      });
      if (!input) return reply;

      const created = await webhooksService.createWebhook(input);
      await logAudit({
        request,
        action: 'webhook.created',
        entityType: 'webhook',
        entityId: created.id,
        details: { targetLabel: created.name, secondaryLabel: created.authType },
      });
      reply.code(201);
      return serializeForResponse(created);
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('administration.webhooks.update')],
      schema: {
        tags: ['webhooks'],
        summary: 'Update a webhook target',
        params: idParamsSchema,
        body: webhookBodySchema,
        response: {
          200: webhookResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = validateWebhookBody(request.body as Record<string, unknown>, reply, {
        isCreate: false,
      });
      if (!input) return reply;

      const updated = await webhooksService.updateWebhook(id, input);
      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Webhook not found',
          action: 'webhook.update.not_found',
          entityType: 'webhook',
          entityId: id,
        });
      }
      await logAudit({
        request,
        action: 'webhook.updated',
        entityType: 'webhook',
        entityId: updated.id,
        details: { targetLabel: updated.name, secondaryLabel: updated.authType },
      });
      return serializeForResponse(updated);
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('administration.webhooks.delete')],
      schema: {
        tags: ['webhooks'],
        summary: 'Delete a webhook target',
        params: idParamsSchema,
        response: {
          204: { type: 'null' },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await webhooksRepo.deleteById(id);
      if (!deleted) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Webhook not found',
          action: 'webhook.delete.not_found',
          entityType: 'webhook',
          entityId: id,
        });
      }
      await logAudit({
        request,
        action: 'webhook.deleted',
        entityType: 'webhook',
        entityId: id,
      });
      return reply.code(204).send();
    },
  );
}
