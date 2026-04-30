import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withTransaction } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as workUnitsRepo from '../repositories/workUnitsRepo.ts';
import { messageResponseSchema, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { deriveToggleAction, getAuditChangedFields, logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { NotFoundError } from '../utils/http-errors.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { requestHasPermission as hasPermission } from '../utils/permissions.ts';
import {
  badRequest,
  ensureArrayOfStrings,
  optionalNonEmptyString,
  requireNonEmptyArrayOfStrings,
  requireNonEmptyString,
} from '../utils/validation.ts';

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const managerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
  },
  required: ['id', 'name'],
} as const;

const workUnitSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    managers: { type: 'array', items: managerSchema },
    description: { type: ['string', 'null'] },
    isDisabled: { type: 'boolean' },
    userCount: { type: 'number' },
  },
  required: ['id', 'name', 'managers', 'isDisabled', 'userCount'],
} as const;

const workUnitCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    managerIds: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
  },
  required: ['name', 'managerIds'],
} as const;

const workUnitUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    managerIds: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
    isDisabled: { type: 'boolean' },
  },
} as const;

const workUnitUsersBodySchema = {
  type: 'object',
  properties: {
    userIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['userIds'],
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List work units
  fastify.get(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('hr.work_units.view')],
      schema: {
        tags: ['work-units'],
        summary: 'List work units',
        response: {
          200: { type: 'array', items: workUnitSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      if (hasPermission(request, 'hr.work_units_all.view')) {
        return workUnitsRepo.listAll();
      }
      return workUnitsRepo.listManagedBy(request.user.id);
    },
  );

  // POST / - Create work unit
  fastify.post(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('hr.work_units.create')],
      schema: {
        tags: ['work-units'],
        summary: 'Create work unit',
        body: workUnitCreateBodySchema,
        response: {
          201: workUnitSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, managerIds, description } = request.body as {
        name?: string;
        managerIds?: string[];
        description?: string;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const managerIdsResult = requireNonEmptyArrayOfStrings(managerIds, 'managerIds');
      if (!managerIdsResult.ok) return badRequest(reply, managerIdsResult.message);

      const id = generatePrefixedId('wu');
      const w = await withTransaction(async (tx) => {
        await workUnitsRepo.create(
          { id, name: nameResult.value, description: description ?? null },
          tx,
        );
        await workUnitsRepo.addManagers(id, managerIdsResult.value, tx);
        await workUnitsRepo.addUsersToUnit(id, managerIdsResult.value, tx);
        return workUnitsRepo.findById(id, tx);
      });
      if (!w) return reply.code(500).send({ error: 'Work unit not found after create' });

      await logAudit({
        request,
        action: 'work_unit.created',
        entityType: 'work_unit',
        entityId: id,
        details: {
          targetLabel: w.name,
          counts: { users: w.userCount },
        },
      });
      return reply.code(201).send(w);
    },
  );

  // PUT /:id - Update work unit
  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('hr.work_units.update')],
      schema: {
        tags: ['work-units'],
        summary: 'Update work unit',
        params: idParamSchema,
        body: workUnitUpdateBodySchema,
        response: {
          200: workUnitSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { name, managerIds, description, isDisabled } = request.body as {
        name?: string;
        managerIds?: string[];
        description?: string;
        isDisabled?: boolean;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const nameResult = name !== undefined ? optionalNonEmptyString(name, 'name') : null;
      if (nameResult && !nameResult.ok) return badRequest(reply, nameResult.message);

      const managerIdsResult =
        managerIds !== undefined ? ensureArrayOfStrings(managerIds, 'managerIds') : null;
      if (managerIdsResult && !managerIdsResult.ok) {
        return badRequest(reply, managerIdsResult.message);
      }

      let w: workUnitsRepo.WorkUnit | null;
      try {
        w = await withTransaction(async (tx) => {
          const exists = await workUnitsRepo.lockById(idResult.value, tx);
          if (!exists) throw new NotFoundError('Work unit');

          await workUnitsRepo.updateFields(
            idResult.value,
            {
              name: nameResult?.value,
              description,
              isDisabled,
            },
            tx,
          );

          if (managerIdsResult?.ok) {
            await workUnitsRepo.clearManagers(idResult.value, tx);
            await workUnitsRepo.addManagers(idResult.value, managerIdsResult.value, tx);
            await workUnitsRepo.addUsersToUnit(idResult.value, managerIdsResult.value, tx);
          }

          return workUnitsRepo.findById(idResult.value, tx);
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }

      if (!w) return reply.code(404).send({ error: 'Work unit not found' });

      const action = deriveToggleAction(
        getAuditChangedFields({ name, managerIds, description, isDisabled }) ?? [],
        'isDisabled',
        'work_unit.updated',
        'work_unit.disabled',
        'work_unit.enabled',
        isDisabled,
      );

      await logAudit({
        request,
        action,
        entityType: 'work_unit',
        entityId: idResult.value,
        details: {
          targetLabel: w.name,
          counts: { users: w.userCount },
        },
      });
      return w;
    },
  );

  // DELETE /:id - Delete work unit
  fastify.delete(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('hr.work_units.delete')],
      schema: {
        tags: ['work-units'],
        summary: 'Delete work unit',
        params: idParamSchema,
        response: {
          200: messageResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const deleted = await workUnitsRepo.deleteById(idResult.value);
      if (!deleted) {
        return reply.code(404).send({ error: 'Work unit not found' });
      }

      await logAudit({
        request,
        action: 'work_unit.deleted',
        entityType: 'work_unit',
        entityId: idResult.value,
        details: {
          targetLabel: deleted.name,
        },
      });
      return { message: 'Work unit deleted' };
    },
  );

  // GET /:id/users - Get users in work unit
  fastify.get(
    '/:id/users',
    {
      onRequest: [authenticateToken, requirePermission('hr.work_units.view')],
      schema: {
        tags: ['work-units'],
        summary: 'Get users in work unit',
        params: idParamSchema,
        response: {
          200: { type: 'array', items: { type: 'string' } },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (!hasPermission(request, 'hr.work_units_all.view')) {
        const isManager = await workUnitsRepo.isUserManagerOfUnit(request.user.id, idResult.value);
        if (!isManager) {
          return reply.code(403).send({ error: 'Access denied' });
        }
      }

      return workUnitsRepo.findUserIds(idResult.value);
    },
  );

  // POST /:id/users - Update users in work unit
  fastify.post(
    '/:id/users',
    {
      onRequest: [authenticateToken, requirePermission('hr.work_units.update')],
      schema: {
        tags: ['work-units'],
        summary: 'Update work unit users',
        params: idParamSchema,
        body: workUnitUsersBodySchema,
        response: {
          200: messageResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { userIds } = request.body as { userIds?: string[] };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const userIdsResult = ensureArrayOfStrings(userIds, 'userIds');
      if (!userIdsResult.ok) return badRequest(reply, userIdsResult.message);

      const unitName = await workUnitsRepo.findNameById(idResult.value);
      if (unitName === null) {
        return reply.code(404).send({ error: 'Work unit not found' });
      }

      await withTransaction(async (tx) => {
        await workUnitsRepo.clearUsers(idResult.value, tx);
        await workUnitsRepo.addUsersToUnit(idResult.value, userIdsResult.value, tx);
      });

      await logAudit({
        request,
        action: 'work_unit.users_updated',
        entityType: 'work_unit',
        entityId: idResult.value,
        details: {
          targetLabel: unitName,
          counts: { users: userIdsResult.value.length },
        },
      });
      return { message: 'Work unit users updated' };
    },
  );
}
