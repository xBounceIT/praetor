import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { RESALE_BILLING_FREQUENCIES } from '../db/schema/resales.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import * as resalesRepo from '../repositories/resalesRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { getAuditChangedFields, logAudit } from '../utils/audit.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import {
  badRequest,
  optionalDateString,
  optionalEnum,
  optionalNonEmptyString,
  parseBooleanField,
  parseDateString,
  parseLocalizedNonNegativeNumber,
  requireNonEmptyString,
} from '../utils/validation.ts';

const RESALE_CATEGORY_NAME_UNIQUE_INDEX = 'idx_resale_categories_name_unique';
const RESALE_CATEGORY_NAME_CONFLICT_MESSAGE = 'Category name must be unique';

const isResaleCategoryNameConflict = (error: unknown): boolean =>
  getUniqueViolation(error)?.constraint === RESALE_CATEGORY_NAME_UNIQUE_INDEX;

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const activityParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    activityId: { type: 'string' },
  },
  required: ['id', 'activityId'],
} as const;

const categorySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    createdAt: { type: ['number', 'null'] },
    updatedAt: { type: ['number', 'null'] },
    activityCount: { type: 'number' },
    hasLinkedActivities: { type: 'boolean' },
  },
  required: ['id', 'name', 'activityCount', 'hasLinkedActivities'],
} as const;

const activitySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    resaleId: { type: 'string' },
    name: { type: 'string' },
    billingFrequency: { type: 'string', enum: RESALE_BILLING_FREQUENCIES },
    categoryId: { type: 'string' },
    categoryName: { type: 'string' },
    cost: { type: 'number' },
    revenue: { type: 'number' },
    released: { type: 'boolean' },
    dueDate: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
  },
  required: [
    'id',
    'resaleId',
    'name',
    'billingFrequency',
    'categoryId',
    'categoryName',
    'cost',
    'revenue',
    'released',
    'createdAt',
    'updatedAt',
  ],
} as const;

const resaleSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    clientOrderId: { type: 'string' },
    supplierOrderId: { type: 'string' },
    clientName: { type: 'string' },
    supplierName: { type: 'string' },
    supplierOrderCost: { type: 'number' },
    activityCostTotal: { type: 'number' },
    resaleRevenue: { type: 'number' },
    costVariance: { type: 'number' },
    startDate: { type: ['string', 'null'] },
    dueDate: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    activities: { type: 'array', items: activitySchema },
  },
  required: [
    'id',
    'clientOrderId',
    'supplierOrderId',
    'clientName',
    'supplierName',
    'supplierOrderCost',
    'activityCostTotal',
    'resaleRevenue',
    'costVariance',
    'startDate',
    'createdAt',
    'updatedAt',
    'activities',
  ],
} as const;

const orderOptionSchema = {
  type: 'object',
  properties: {
    clientOrderId: { type: 'string' },
    clientName: { type: 'string' },
    supplierOrders: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          supplierName: { type: 'string' },
          total: { type: 'number' },
        },
        required: ['id', 'supplierName', 'total'],
      },
    },
  },
  required: ['clientOrderId', 'clientName', 'supplierOrders'],
} as const;

const resaleUpdateBodySchema = {
  type: 'object',
  properties: {
    clientOrderId: { type: 'string' },
    supplierOrderId: { type: 'string' },
    startDate: { type: ['string', 'null'] },
    dueDate: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
  },
} as const;

const activityCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    billingFrequency: { type: 'string', enum: RESALE_BILLING_FREQUENCIES },
    categoryId: { type: 'string' },
    cost: { anyOf: [{ type: 'number' }, { type: 'string' }] },
    revenue: { anyOf: [{ type: 'number' }, { type: 'string' }] },
    released: { type: 'boolean' },
    dueDate: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
  },
  required: ['name', 'billingFrequency', 'categoryId', 'cost', 'revenue'],
} as const;

const resaleCreateBodySchema = {
  type: 'object',
  properties: {
    clientOrderId: { type: 'string' },
    supplierOrderId: { type: 'string' },
    startDate: { type: 'string' },
    dueDate: { type: 'string' },
    notes: { type: ['string', 'null'] },
    activities: {
      type: 'array',
      minItems: 1,
      items: activityCreateBodySchema,
    },
  },
  required: ['clientOrderId', 'supplierOrderId', 'startDate', 'dueDate', 'activities'],
} as const;

const activityUpdateBodySchema = {
  type: 'object',
  properties: activityCreateBodySchema.properties,
} as const;

const categoryBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
  },
  required: ['name'],
} as const;

type ValidatedActivityInput =
  | { ok: true; value: Omit<resalesRepo.NewResaleActivity, 'id' | 'resaleId'> }
  | { ok: false; reply: FastifyReply };

const validateActivityInput = (
  body: Record<string, unknown>,
  reply: FastifyReply,
  mode: 'create' | 'update',
): ValidatedActivityInput => {
  const value: Partial<Omit<resalesRepo.NewResaleActivity, 'id' | 'resaleId'>> = {};

  if (mode === 'create' || Object.hasOwn(body, 'name')) {
    const nameResult = requireNonEmptyString(body.name, 'name');
    if (!nameResult.ok) return { ok: false, reply: badRequest(reply, nameResult.message) };
    value.name = nameResult.value;
  }

  if (mode === 'create' || Object.hasOwn(body, 'billingFrequency')) {
    const frequencyResult = optionalEnum(
      body.billingFrequency,
      RESALE_BILLING_FREQUENCIES,
      'billingFrequency',
    );
    if (!frequencyResult.ok) {
      return { ok: false, reply: badRequest(reply, frequencyResult.message) };
    }
    value.billingFrequency = frequencyResult.value ?? 'one_time';
  }

  if (mode === 'create' || Object.hasOwn(body, 'categoryId')) {
    const categoryIdResult = requireNonEmptyString(body.categoryId, 'categoryId');
    if (!categoryIdResult.ok) {
      return { ok: false, reply: badRequest(reply, categoryIdResult.message) };
    }
    value.categoryId = categoryIdResult.value;
  }

  if (mode === 'create' || Object.hasOwn(body, 'cost')) {
    const costResult = parseLocalizedNonNegativeNumber(body.cost, 'cost');
    if (!costResult.ok) return { ok: false, reply: badRequest(reply, costResult.message) };
    value.cost = costResult.value;
  }

  if (mode === 'create' || Object.hasOwn(body, 'revenue')) {
    const revenueResult = parseLocalizedNonNegativeNumber(body.revenue, 'revenue');
    if (!revenueResult.ok) {
      return { ok: false, reply: badRequest(reply, revenueResult.message) };
    }
    value.revenue = revenueResult.value;
  }

  const releasedResult = parseBooleanField(body, 'released');
  if (!releasedResult.ok) return { ok: false, reply: badRequest(reply, releasedResult.message) };
  if (releasedResult.value !== undefined) value.released = releasedResult.value;
  else if (mode === 'create') value.released = false;

  if (mode === 'create' || Object.hasOwn(body, 'dueDate')) {
    const dueDateResult = optionalDateString(body.dueDate, 'dueDate');
    if (!dueDateResult.ok) return { ok: false, reply: badRequest(reply, dueDateResult.message) };
    value.dueDate = dueDateResult.value;
  }

  if (mode === 'create' || Object.hasOwn(body, 'notes')) {
    const notesResult = optionalNonEmptyString(body.notes, 'notes');
    if (!notesResult.ok) return { ok: false, reply: badRequest(reply, notesResult.message) };
    value.notes = notesResult.value;
  }

  return {
    ok: true,
    value: value as Omit<resalesRepo.NewResaleActivity, 'id' | 'resaleId'>,
  };
};

const ensureValidOrderPair = async (
  clientOrderId: string,
  supplierOrderId: string,
): Promise<boolean> =>
  resalesRepo.isSupplierOrderLinkedToClientOrder(clientOrderId, supplierOrderId);

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  fastify.get(
    '/categories',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requireAnyPermission('projects.resales.view', 'projects.resales.create'),
      ],
      schema: {
        tags: ['resales'],
        summary: 'List resale categories',
        response: {
          200: { type: 'array', items: categorySchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => resalesRepo.listCategories(),
  );

  fastify.post(
    '/categories',
    {
      onRequest: [requirePermission('projects.resales.create')],
      schema: {
        tags: ['resales'],
        summary: 'Create resale category',
        body: categoryBodySchema,
        response: {
          201: categorySchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name } = request.body as { name: unknown };
      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);
      if (await resalesRepo.existsCategoryByName(nameResult.value)) {
        return badRequest(reply, RESALE_CATEGORY_NAME_CONFLICT_MESSAGE);
      }

      const id = generatePrefixedId('rvc');
      let created: resalesRepo.ResaleCategory;
      try {
        created = await resalesRepo.createCategory(id, nameResult.value);
      } catch (error) {
        if (isResaleCategoryNameConflict(error)) {
          return badRequest(reply, RESALE_CATEGORY_NAME_CONFLICT_MESSAGE);
        }
        throw error;
      }
      await logAudit({
        request,
        action: 'resale_category.created',
        entityType: 'resale_category',
        entityId: id,
        details: { targetLabel: created.name },
      });
      return reply.code(201).send(created);
    },
  );

  fastify.put(
    '/categories/:id',
    {
      onRequest: [requirePermission('projects.resales.update')],
      schema: {
        tags: ['resales'],
        summary: 'Update resale category',
        params: idParamSchema,
        body: categoryBodySchema,
        response: {
          200: categorySchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { name } = request.body as { name: unknown };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);
      if (await resalesRepo.existsCategoryByName(nameResult.value, idResult.value)) {
        return badRequest(reply, RESALE_CATEGORY_NAME_CONFLICT_MESSAGE);
      }

      let updated: resalesRepo.ResaleCategory | null;
      try {
        updated = await resalesRepo.updateCategory(idResult.value, nameResult.value);
      } catch (error) {
        if (isResaleCategoryNameConflict(error)) {
          return badRequest(reply, RESALE_CATEGORY_NAME_CONFLICT_MESSAGE);
        }
        throw error;
      }
      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Category not found',
          action: 'resale_category.update.not_found',
          entityType: 'resale_category',
          entityId: idResult.value,
        });
      }
      await logAudit({
        request,
        action: 'resale_category.updated',
        entityType: 'resale_category',
        entityId: idResult.value,
        details: { targetLabel: updated.name },
      });
      return updated;
    },
  );

  fastify.delete(
    '/categories/:id',
    {
      onRequest: [requirePermission('projects.resales.delete')],
      schema: {
        tags: ['resales'],
        summary: 'Delete resale category',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const result = await resalesRepo.deleteCategoryIfUnused(idResult.value);
      if (result.status === 'not_found') {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Category not found',
          action: 'resale_category.delete.not_found',
          entityType: 'resale_category',
          entityId: idResult.value,
        });
      }
      if (result.status === 'in_use') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Cannot delete a category used by resale activities',
          action: 'resale_category.delete.conflict',
          entityType: 'resale_category',
          entityId: idResult.value,
          details: {
            secondaryLabel: 'in_use',
            counts: { activities: result.activityCount },
          },
        });
      }

      await logAudit({
        request,
        action: 'resale_category.deleted',
        entityType: 'resale_category',
        entityId: idResult.value,
      });
      return reply.code(204).send();
    },
  );

  fastify.get(
    '/order-options',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requireAnyPermission('projects.resales.view', 'projects.resales.create'),
      ],
      schema: {
        tags: ['resales'],
        summary: 'List client orders and linked supplier orders available for resales',
        response: {
          200: { type: 'array', items: orderOptionSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => resalesRepo.listOrderOptions(),
  );

  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('projects.resales.view'),
      ],
      schema: {
        tags: ['resales'],
        summary: 'List resales',
        response: {
          200: { type: 'array', items: resaleSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => resalesRepo.listAll(),
  );

  fastify.post(
    '/',
    {
      onRequest: [requirePermission('projects.resales.create')],
      schema: {
        tags: ['resales'],
        summary: 'Create resale',
        body: resaleCreateBodySchema,
        response: {
          201: resaleSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        clientOrderId: unknown;
        supplierOrderId: unknown;
        startDate?: unknown;
        dueDate?: unknown;
        notes?: unknown;
        activities?: unknown;
      };
      const clientOrderIdResult = requireNonEmptyString(body.clientOrderId, 'clientOrderId');
      if (!clientOrderIdResult.ok) return badRequest(reply, clientOrderIdResult.message);
      const supplierOrderIdResult = requireNonEmptyString(body.supplierOrderId, 'supplierOrderId');
      if (!supplierOrderIdResult.ok) return badRequest(reply, supplierOrderIdResult.message);
      const startDateResult = parseDateString(body.startDate, 'startDate');
      if (!startDateResult.ok) return badRequest(reply, startDateResult.message);
      const dueDateResult = parseDateString(body.dueDate, 'dueDate');
      if (!dueDateResult.ok) return badRequest(reply, dueDateResult.message);
      const notesResult = optionalNonEmptyString(body.notes, 'notes');
      if (!notesResult.ok) return badRequest(reply, notesResult.message);
      if (!Array.isArray(body.activities) || body.activities.length === 0) {
        return badRequest(reply, 'activities must contain at least one activity');
      }

      const activities: Array<Omit<resalesRepo.NewResaleActivity, 'id' | 'resaleId'>> = [];
      for (const activityBody of body.activities) {
        if (!activityBody || typeof activityBody !== 'object' || Array.isArray(activityBody)) {
          return badRequest(reply, 'activities must contain valid activity objects');
        }
        const activityInput = validateActivityInput(
          activityBody as Record<string, unknown>,
          reply,
          'create',
        );
        if (!activityInput.ok) return activityInput.reply;
        activities.push(activityInput.value);
      }

      const validOrderPair = await ensureValidOrderPair(
        clientOrderIdResult.value,
        supplierOrderIdResult.value,
      );
      if (!validOrderPair) {
        return badRequest(reply, 'supplierOrderId must belong to the selected clientOrderId');
      }
      if (
        await resalesRepo.existsByOrderPair(clientOrderIdResult.value, supplierOrderIdResult.value)
      ) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'A resale already exists for this client/supplier order pair',
          action: 'resale.create.conflict',
          entityType: 'resale',
          details: { secondaryLabel: 'duplicate_order_pair' },
        });
      }

      const id = generatePrefixedId('rv');
      const created = await withDbTransaction(async (tx) => {
        await resalesRepo.create(
          {
            id,
            clientOrderId: clientOrderIdResult.value,
            supplierOrderId: supplierOrderIdResult.value,
            startDate: startDateResult.value,
            dueDate: dueDateResult.value,
            notes: notesResult.value,
          },
          tx,
        );
        await Promise.all(
          activities.map((activity) =>
            resalesRepo.createActivity(
              {
                id: generatePrefixedId('rva'),
                resaleId: id,
                ...activity,
              },
              tx,
            ),
          ),
        );
        return resalesRepo.findById(id, tx);
      });
      if (!created) {
        return reply.code(500).send({ error: 'Unable to load created resale' });
      }
      await logAudit({
        request,
        action: 'resale.created',
        entityType: 'resale',
        entityId: id,
        details: {
          targetLabel: created.clientOrderId,
          secondaryLabel: created.supplierOrderId,
          counts: { activities: activities.length },
        },
      });
      return reply.code(201).send(created);
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('projects.resales.update')],
      schema: {
        tags: ['resales'],
        summary: 'Update resale',
        params: idParamSchema,
        body: resaleUpdateBodySchema,
        response: {
          200: resaleSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const current = await resalesRepo.findById(idResult.value);
      if (!current) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Resale not found',
          action: 'resale.update.not_found',
          entityType: 'resale',
          entityId: idResult.value,
        });
      }

      const patch: resalesRepo.ResaleUpdate = {};
      if (Object.hasOwn(body, 'clientOrderId')) {
        const result = requireNonEmptyString(body.clientOrderId, 'clientOrderId');
        if (!result.ok) return badRequest(reply, result.message);
        patch.clientOrderId = result.value;
      }
      if (Object.hasOwn(body, 'supplierOrderId')) {
        const result = requireNonEmptyString(body.supplierOrderId, 'supplierOrderId');
        if (!result.ok) return badRequest(reply, result.message);
        patch.supplierOrderId = result.value;
      }
      if (Object.hasOwn(body, 'startDate')) {
        const result = optionalDateString(body.startDate, 'startDate');
        if (!result.ok) return badRequest(reply, result.message);
        patch.startDate = result.value;
      }
      if (Object.hasOwn(body, 'dueDate')) {
        const result = optionalDateString(body.dueDate, 'dueDate');
        if (!result.ok) return badRequest(reply, result.message);
        patch.dueDate = result.value;
      }
      if (Object.hasOwn(body, 'notes')) {
        const result = optionalNonEmptyString(body.notes, 'notes');
        if (!result.ok) return badRequest(reply, result.message);
        patch.notes = result.value;
      }

      const nextClientOrderId = patch.clientOrderId ?? current.clientOrderId;
      const nextSupplierOrderId = patch.supplierOrderId ?? current.supplierOrderId;
      const validOrderPair = await ensureValidOrderPair(nextClientOrderId, nextSupplierOrderId);
      if (!validOrderPair) {
        return badRequest(reply, 'supplierOrderId must belong to the selected clientOrderId');
      }
      if (
        await resalesRepo.existsByOrderPair(nextClientOrderId, nextSupplierOrderId, idResult.value)
      ) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'A resale already exists for this client/supplier order pair',
          action: 'resale.update.conflict',
          entityType: 'resale',
          entityId: idResult.value,
          details: { secondaryLabel: 'duplicate_order_pair' },
        });
      }

      const updated = await resalesRepo.update(idResult.value, patch);
      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Resale not found',
          action: 'resale.update.not_found',
          entityType: 'resale',
          entityId: idResult.value,
        });
      }
      await logAudit({
        request,
        action: 'resale.updated',
        entityType: 'resale',
        entityId: idResult.value,
        details: {
          targetLabel: updated.clientOrderId,
          secondaryLabel: updated.supplierOrderId,
          changedFields: getAuditChangedFields(body),
        },
      });
      return updated;
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('projects.resales.delete')],
      schema: {
        tags: ['resales'],
        summary: 'Delete resale',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const deleted = await resalesRepo.deleteById(idResult.value);
      if (!deleted) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Resale not found',
          action: 'resale.delete.not_found',
          entityType: 'resale',
          entityId: idResult.value,
        });
      }
      await logAudit({
        request,
        action: 'resale.deleted',
        entityType: 'resale',
        entityId: idResult.value,
      });
      return reply.code(204).send();
    },
  );

  fastify.post(
    '/:id/activities',
    {
      onRequest: [requirePermission('projects.resales.create')],
      schema: {
        tags: ['resales'],
        summary: 'Create resale activity',
        params: idParamSchema,
        body: activityCreateBodySchema,
        response: {
          201: resaleSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      if (!(await resalesRepo.existsById(idResult.value))) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Resale not found',
          action: 'resale_activity.create.not_found',
          entityType: 'resale',
          entityId: idResult.value,
        });
      }
      const activityInput = validateActivityInput(
        request.body as Record<string, unknown>,
        reply,
        'create',
      );
      if (!activityInput.ok) return activityInput.reply;

      const activityId = generatePrefixedId('rva');
      const updatedResale = await withDbTransaction(async (tx) => {
        await resalesRepo.createActivity(
          {
            id: activityId,
            resaleId: idResult.value,
            ...activityInput.value,
          },
          tx,
        );
        return resalesRepo.findById(idResult.value, tx);
      });
      if (!updatedResale) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Resale not found',
          action: 'resale_activity.create.not_found',
          entityType: 'resale',
          entityId: idResult.value,
        });
      }
      await logAudit({
        request,
        action: 'resale_activity.created',
        entityType: 'resale_activity',
        entityId: activityId,
        details: { targetLabel: activityInput.value.name, secondaryLabel: idResult.value },
      });
      return reply.code(201).send(updatedResale);
    },
  );

  fastify.put(
    '/:id/activities/:activityId',
    {
      onRequest: [requirePermission('projects.resales.update')],
      schema: {
        tags: ['resales'],
        summary: 'Update resale activity',
        params: activityParamSchema,
        body: activityUpdateBodySchema,
        response: {
          200: resaleSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, activityId } = request.params as { id: string; activityId: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const activityIdResult = requireNonEmptyString(activityId, 'activityId');
      if (!activityIdResult.ok) return badRequest(reply, activityIdResult.message);

      const existingResaleId = await resalesRepo.findActivityResaleId(activityIdResult.value);
      if (existingResaleId !== idResult.value) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Resale activity not found',
          action: 'resale_activity.update.not_found',
          entityType: 'resale_activity',
          entityId: activityIdResult.value,
        });
      }

      const activityInput = validateActivityInput(
        request.body as Record<string, unknown>,
        reply,
        'update',
      );
      if (!activityInput.ok) return activityInput.reply;

      const updatedResale = await withDbTransaction(async (tx) => {
        await resalesRepo.updateActivity(activityIdResult.value, activityInput.value, tx);
        return resalesRepo.findById(idResult.value, tx);
      });
      if (!updatedResale) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Resale not found',
          action: 'resale_activity.update.not_found',
          entityType: 'resale',
          entityId: idResult.value,
        });
      }
      await logAudit({
        request,
        action: 'resale_activity.updated',
        entityType: 'resale_activity',
        entityId: activityIdResult.value,
        details: {
          secondaryLabel: idResult.value,
          changedFields: getAuditChangedFields(request.body as Record<string, unknown>),
        },
      });
      return updatedResale;
    },
  );

  fastify.delete(
    '/:id/activities/:activityId',
    {
      onRequest: [requirePermission('projects.resales.delete')],
      schema: {
        tags: ['resales'],
        summary: 'Delete resale activity',
        params: activityParamSchema,
        response: {
          200: resaleSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, activityId } = request.params as { id: string; activityId: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const activityIdResult = requireNonEmptyString(activityId, 'activityId');
      if (!activityIdResult.ok) return badRequest(reply, activityIdResult.message);
      const existingResaleId = await resalesRepo.findActivityResaleId(activityIdResult.value);
      if (existingResaleId !== idResult.value) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Resale activity not found',
          action: 'resale_activity.delete.not_found',
          entityType: 'resale_activity',
          entityId: activityIdResult.value,
        });
      }

      const updatedResale = await withDbTransaction(async (tx) => {
        await resalesRepo.deleteActivityById(activityIdResult.value, tx);
        return resalesRepo.findById(idResult.value, tx);
      });
      if (!updatedResale) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Resale not found',
          action: 'resale_activity.delete.not_found',
          entityType: 'resale',
          entityId: idResult.value,
        });
      }
      await logAudit({
        request,
        action: 'resale_activity.deleted',
        entityType: 'resale_activity',
        entityId: activityIdResult.value,
        details: { secondaryLabel: idResult.value },
      });
      return updatedResale;
    },
  );
}
