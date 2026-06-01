import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken } from '../middleware/auth.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import * as viewsRepo from '../repositories/viewsRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { getForeignKeyViolation } from '../utils/db-errors.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import { badRequest, requireNonEmptyString, validateEnum } from '../utils/validation.ts';

const SAVED_VIEW_KINDS = ['table', 'dashboard'] as const;
const SHARE_PERMISSIONS = ['read', 'write'] as const;

// ---------------------------------------------------------------------------
// JSON schemas (OpenAPI / response serialization). `config` is opaque jsonb, so
// it's declared as a free-form object; the structural validation below is what
// actually guards what lands in the column.
// ---------------------------------------------------------------------------

const idParamSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

const listQuerySchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: SAVED_VIEW_KINDS },
    scopeKey: { type: 'string' },
  },
  required: ['kind', 'scopeKey'],
} as const;

const savedViewSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    ownerId: { type: 'string' },
    ownerName: { type: 'string' },
    kind: { type: 'string', enum: SAVED_VIEW_KINDS },
    scopeKey: { type: 'string' },
    name: { type: 'string' },
    config: { type: 'object', additionalProperties: true },
    access: { type: 'string', enum: ['owner', 'read', 'write'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
  },
  required: [
    'id',
    'ownerId',
    'ownerName',
    'kind',
    'scopeKey',
    'name',
    'config',
    'access',
    'createdAt',
    'updatedAt',
  ],
} as const;

const createBodySchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: SAVED_VIEW_KINDS },
    scopeKey: { type: 'string' },
    name: { type: 'string' },
    config: { type: 'object', additionalProperties: true },
  },
  required: ['kind', 'scopeKey', 'name', 'config'],
} as const;

const updateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    config: { type: 'object', additionalProperties: true },
  },
} as const;

const shareSchema = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    permission: { type: 'string', enum: SHARE_PERMISSIONS },
  },
  required: ['userId', 'permission'],
} as const;

const sharesBodySchema = {
  type: 'object',
  properties: {
    shares: { type: 'array', items: shareSchema },
  },
  required: ['shares'],
} as const;

const sharesResponseSchema = {
  type: 'object',
  properties: {
    shares: { type: 'array', items: shareSchema },
  },
  required: ['shares'],
} as const;

const directoryUserSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    username: { type: 'string' },
    avatarInitials: { type: 'string' },
  },
  required: ['id', 'name', 'username', 'avatarInitials'],
} as const;

// ---------------------------------------------------------------------------
// Config validation — a small server-side mirror of the frontend validators
// (`isValidStoredView`/`parseSortState`/`parseFilterState` for tables,
// `isValidWidgetState` for dashboards) so junk never lands in the jsonb column.
// Validators only assert structure; they don't normalize geometry (that's the
// frontend's `normalizeLayout` job on read).
// ---------------------------------------------------------------------------

const MAX_CONFIG_BYTES = 100_000;

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === 'string');

const isValidSortState = (v: unknown): boolean => {
  if (v === null || v === undefined) return true;
  if (typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.colId === 'string' && (o.px === 'asc' || o.px === 'desc');
};

const isValidFilterState = (v: unknown): boolean => {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((value) => isStringArray(value));
};

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isValidWidgetState = (v: unknown): boolean => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    o.id !== '' &&
    isFiniteNumber(o.x) &&
    isFiniteNumber(o.y) &&
    isFiniteNumber(o.w) &&
    isFiniteNumber(o.h) &&
    (o.x as number) >= 0 &&
    (o.y as number) >= 0 &&
    (o.w as number) >= 1 &&
    (o.h as number) >= 1 &&
    typeof o.hidden === 'boolean'
  );
};

const isValidTableConfig = (config: Record<string, unknown>): boolean =>
  isStringArray(config.hiddenColIds) &&
  isValidSortState(config.sortState) &&
  isValidFilterState(config.filterState);

const isValidDashboardConfig = (config: Record<string, unknown>): boolean =>
  Array.isArray(config.layout) && config.layout.every(isValidWidgetState);

// Returns the validated config object, or an error message describing why it's rejected.
const validateConfig = (
  kind: (typeof SAVED_VIEW_KINDS)[number],
  raw: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'config must be an object' };
  }
  // Guard against a pathological payload bloating the jsonb column.
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_CONFIG_BYTES) {
    return { ok: false, message: 'config exceeds the maximum allowed size' };
  }
  const config = raw as Record<string, unknown>;
  const valid = kind === 'table' ? isValidTableConfig(config) : isValidDashboardConfig(config);
  if (!valid) {
    return { ok: false, message: `config is not a valid ${kind} view payload` };
  }
  return { ok: true, value: config };
};

// Centralizes the find-access + 404/403 boilerplate the mutating /:id handlers share.
// Returns the access record on success; otherwise sends the matching error reply (awaited so
// the audit row is written before the response) and returns null for the caller to `return` on.
// `actionBase` namespaces the audit actions: `${actionBase}.not_found` / `${actionBase}.denied`.
async function authorizeViewAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  viewId: string,
  userId: string,
  need: 'owner' | 'write',
  actionBase: string,
): Promise<Awaited<ReturnType<typeof viewsRepo.findAccess>> | null> {
  const found = await viewsRepo.findAccess(viewId, userId);
  if (found.ownerId === null) {
    await replyError(request, reply, {
      statusCode: 404,
      message: 'Saved view not found',
      action: `${actionBase}.not_found`,
      entityType: 'saved_view',
      entityId: viewId,
    });
    return null;
  }
  const allowed =
    need === 'owner'
      ? found.access === 'owner'
      : found.access === 'owner' || found.access === 'write';
  if (!allowed) {
    await replyError(request, reply, {
      statusCode: 403,
      message: 'Insufficient permissions',
      action: `${actionBase}.denied`,
      entityType: 'saved_view',
      entityId: viewId,
      details: { secondaryLabel: 'view_access_denied' },
    });
    return null;
  }
  return found;
}

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // Saved views are a per-user productivity feature available to any authenticated user.
  // Ownership / share permission is enforced in-handler via viewsRepo.findAccess.
  fastify.addHook('onRequest', authenticateToken);

  // GET /?kind&scopeKey - Own views + views shared with me, for the given scope.
  fastify.get(
    '/',
    {
      onRequest: [fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT)],
      schema: {
        tags: ['views'],
        summary: 'List saved views (own + shared) for a scope',
        querystring: listQuerySchema,
        response: {
          200: { type: 'array', items: savedViewSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const query = request.query as { kind?: unknown; scopeKey?: unknown };

      const kindResult = validateEnum(query.kind, SAVED_VIEW_KINDS, 'kind');
      if (!kindResult.ok) return badRequest(reply, kindResult.message);
      const scopeKeyResult = requireNonEmptyString(query.scopeKey, 'scopeKey');
      if (!scopeKeyResult.ok) return badRequest(reply, scopeKeyResult.message);

      return viewsRepo.listForUser(request.user.id, kindResult.value, scopeKeyResult.value);
    },
  );

  // GET /directory - Minimal user list for the share picker (any auth user).
  fastify.get(
    '/directory',
    {
      onRequest: [fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT)],
      schema: {
        tags: ['views'],
        summary: 'List users for the share picker',
        response: {
          200: { type: 'array', items: directoryUserSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      return usersRepo.listDirectory();
    },
  );

  // POST / - Create a view owned by the current user.
  fastify.post(
    '/',
    {
      schema: {
        tags: ['views'],
        summary: 'Create a saved view',
        body: createBodySchema,
        response: {
          201: savedViewSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const body = request.body as {
        kind?: unknown;
        scopeKey?: unknown;
        name?: unknown;
        config?: unknown;
      };

      const kindResult = validateEnum(body.kind, SAVED_VIEW_KINDS, 'kind');
      if (!kindResult.ok) return badRequest(reply, kindResult.message);
      const scopeKeyResult = requireNonEmptyString(body.scopeKey, 'scopeKey');
      if (!scopeKeyResult.ok) return badRequest(reply, scopeKeyResult.message);
      const nameResult = requireNonEmptyString(body.name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);
      const configResult = validateConfig(kindResult.value, body.config);
      if (!configResult.ok) return badRequest(reply, configResult.message);

      const id = generatePrefixedId('sv');
      const created = await viewsRepo.create({
        id,
        ownerId: request.user.id,
        kind: kindResult.value,
        scopeKey: scopeKeyResult.value,
        name: nameResult.value,
        config: configResult.value,
      });

      await logAudit({
        request,
        action: 'saved_view.created',
        entityType: 'saved_view',
        entityId: id,
        details: { targetLabel: created.name, secondaryLabel: created.scopeKey },
      });
      return reply.code(201).send(created);
    },
  );

  // PUT /:id - Update a view (owner or write recipient).
  fastify.put(
    '/:id',
    {
      schema: {
        tags: ['views'],
        summary: 'Update a saved view',
        params: idParamSchema,
        body: updateBodySchema,
        response: {
          200: savedViewSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const viewAccess = await authorizeViewAccess(
        request,
        reply,
        idResult.value,
        request.user.id,
        'write',
        'saved_view.update',
      );
      if (!viewAccess) return;

      const body = request.body as { name?: unknown; config?: unknown };
      const patch: viewsRepo.UpdateSavedViewInput = {};

      if (Object.hasOwn(body, 'name')) {
        const nameResult = requireNonEmptyString(body.name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);
        patch.name = nameResult.value;
      }
      // Validate a config patch against the view's own kind so a table config can't be
      // written onto a dashboard view (or vice versa).
      if (Object.hasOwn(body, 'config')) {
        const kind = await viewsRepo.getViewKind(idResult.value);
        if (!kind) {
          return replyError(request, reply, {
            statusCode: 404,
            message: 'Saved view not found',
            action: 'saved_view.update.not_found',
            entityType: 'saved_view',
            entityId: idResult.value,
          });
        }
        const configResult = validateConfig(kind, body.config);
        if (!configResult.ok) return badRequest(reply, configResult.message);
        patch.config = configResult.value;
      }

      const updated = await viewsRepo.update(idResult.value, patch);
      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Saved view not found',
          action: 'saved_view.update.not_found',
          entityType: 'saved_view',
          entityId: idResult.value,
        });
      }

      await logAudit({
        request,
        action: 'saved_view.updated',
        entityType: 'saved_view',
        entityId: idResult.value,
        details: { targetLabel: updated.name, secondaryLabel: updated.scopeKey },
      });
      // viewsRepo.update reports the owner-perspective access:'owner'; report the CALLER's real
      // access instead, since a 'write' recipient can reach this handler too — otherwise the client
      // would show them owner-only controls (delete/share) for a view they can only edit.
      return { ...updated, access: viewAccess.access ?? updated.access };
    },
  );

  // DELETE /:id - Delete a view (owner only).
  fastify.delete(
    '/:id',
    {
      schema: {
        tags: ['views'],
        summary: 'Delete a saved view',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (
        !(await authorizeViewAccess(
          request,
          reply,
          idResult.value,
          request.user.id,
          'owner',
          'saved_view.delete',
        ))
      ) {
        return;
      }

      await viewsRepo.deleteById(idResult.value);

      await logAudit({
        request,
        action: 'saved_view.deleted',
        entityType: 'saved_view',
        entityId: idResult.value,
      });
      return reply.code(204).send();
    },
  );

  // GET /:id/shares - List a view's shares (owner only).
  fastify.get(
    '/:id/shares',
    {
      schema: {
        tags: ['views'],
        summary: 'List shares for a saved view',
        params: idParamSchema,
        response: {
          200: sharesResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (
        !(await authorizeViewAccess(
          request,
          reply,
          idResult.value,
          request.user.id,
          'owner',
          'saved_view.shares_view',
        ))
      ) {
        return;
      }

      const shares = await viewsRepo.getShares(idResult.value);
      return { shares };
    },
  );

  // PUT /:id/shares - Replace a view's shares (owner only).
  fastify.put(
    '/:id/shares',
    {
      schema: {
        tags: ['views'],
        summary: 'Replace shares for a saved view',
        params: idParamSchema,
        body: sharesBodySchema,
        response: {
          200: sharesResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const access = await authorizeViewAccess(
        request,
        reply,
        idResult.value,
        request.user.id,
        'owner',
        'saved_view.shares_update',
      );
      if (!access) return;
      const { ownerId } = access;

      const body = request.body as { shares?: unknown };
      if (!Array.isArray(body.shares)) {
        return badRequest(reply, 'shares must be an array');
      }

      const shares: viewsRepo.SavedViewShare[] = [];
      for (let i = 0; i < body.shares.length; i++) {
        const entry = body.shares[i];
        if (!entry || typeof entry !== 'object') {
          return badRequest(reply, `shares[${i}] must be an object`);
        }
        const { userId, permission } = entry as { userId?: unknown; permission?: unknown };
        const userIdResult = requireNonEmptyString(userId, `shares[${i}].userId`);
        if (!userIdResult.ok) return badRequest(reply, userIdResult.message);
        // Reject the owner sharing with themselves — it has no meaning and would shadow ownership.
        if (userIdResult.value === ownerId) {
          return badRequest(reply, `shares[${i}].userId cannot be the view owner`);
        }
        const permissionResult = validateEnum(
          permission,
          SHARE_PERMISSIONS,
          `shares[${i}].permission`,
        );
        if (!permissionResult.ok) return badRequest(reply, permissionResult.message);
        shares.push({ userId: userIdResult.value, permission: permissionResult.value });
      }

      try {
        await viewsRepo.replaceShares(idResult.value, shares);
      } catch (err) {
        // An unknown userId trips the saved_view_shares → users FK (SQLSTATE 23503).
        if (getForeignKeyViolation(err)) {
          return replyError(request, reply, {
            statusCode: 400,
            message: 'One or more share recipients do not exist',
            action: 'saved_view.shares_update.invalid',
            entityType: 'saved_view',
            entityId: idResult.value,
            details: { secondaryLabel: 'fk_violation' },
          });
        }
        throw err;
      }

      await logAudit({
        request,
        action: 'saved_view.shares_updated',
        entityType: 'saved_view',
        entityId: idResult.value,
        details: { counts: { shares: shares.length } },
      });

      const persisted = await viewsRepo.getShares(idResult.value);
      return { shares: persisted };
    },
  );
}
