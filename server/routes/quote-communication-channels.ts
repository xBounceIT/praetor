import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requireAnyPermission } from '../middleware/auth.ts';
import * as channelsRepo from '../repositories/quoteCommunicationChannelsRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import { badRequest, requireNonEmptyString } from '../utils/validation.ts';

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const channelSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    icon: { type: 'string', enum: [...channelsRepo.QUOTE_COMMUNICATION_CHANNEL_ICONS] },
    isDefault: { type: 'boolean' },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    clientQuoteCount: { type: 'number' },
    supplierQuoteCount: { type: 'number' },
    totalQuoteCount: { type: 'number' },
  },
  required: [
    'id',
    'name',
    'icon',
    'isDefault',
    'clientQuoteCount',
    'supplierQuoteCount',
    'totalQuoteCount',
  ],
} as const;

const channelBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    icon: { type: 'string', enum: [...channelsRepo.QUOTE_COMMUNICATION_CHANNEL_ICONS] },
  },
  required: ['name'],
} as const;

const viewPermissions = ['sales.client_quotes.view', 'sales.supplier_quotes.view'];
const createPermissions = ['sales.client_quotes.create', 'sales.supplier_quotes.create'];
const updatePermissions = ['sales.client_quotes.update', 'sales.supplier_quotes.update'];
const deletePermissions = ['sales.client_quotes.delete', 'sales.supplier_quotes.delete'];

const resolveIcon = (
  value: unknown,
  fallback: channelsRepo.QuoteCommunicationChannelIcon,
): channelsRepo.QuoteCommunicationChannelIcon | null =>
  value === undefined || value === null
    ? fallback
    : channelsRepo.isQuoteCommunicationChannelIcon(value)
      ? value
      : null;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requireAnyPermission(...viewPermissions),
      ],
      schema: {
        tags: ['quote-communication-channels'],
        summary: 'List quote communication channels',
        response: {
          200: { type: 'array', items: channelSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => await channelsRepo.listAllWithCounts(),
  );

  fastify.post(
    '/',
    {
      onRequest: [requireAnyPermission(...createPermissions)],
      schema: {
        tags: ['quote-communication-channels'],
        summary: 'Create quote communication channel',
        body: channelBodySchema,
        response: {
          201: channelSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, icon } = request.body as { name: unknown; icon?: unknown };
      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);
      const resolvedIcon = resolveIcon(
        icon,
        channelsRepo.DEFAULT_CUSTOM_QUOTE_COMMUNICATION_CHANNEL_ICON,
      );
      if (!resolvedIcon) return badRequest(reply, 'Invalid communication channel icon');

      if (await channelsRepo.existsByName(nameResult.value, null)) {
        return badRequest(reply, 'Communication channel with this name already exists');
      }

      const id = generatePrefixedId('qcc');
      try {
        const created = await channelsRepo.create(id, nameResult.value, resolvedIcon);
        await logAudit({
          request,
          action: 'quote_communication_channel.created',
          entityType: 'quote_communication_channel',
          entityId: created.id,
          details: { targetLabel: created.name },
        });
        return reply.code(201).send(created);
      } catch (err) {
        const dup = getUniqueViolation(err);
        if (dup) {
          return badRequest(reply, 'Communication channel with this name already exists');
        }
        throw err;
      }
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [requireAnyPermission(...updatePermissions)],
      schema: {
        tags: ['quote-communication-channels'],
        summary: 'Update quote communication channel',
        params: idParamSchema,
        body: channelBodySchema,
        response: {
          200: channelSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { name, icon } = request.body as { name: unknown; icon?: unknown };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const current = await channelsRepo.findById(idResult.value);
      if (!current) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Communication channel not found',
          action: 'quote_communication_channel.update.not_found',
          entityType: 'quote_communication_channel',
          entityId: idResult.value,
        });
      }

      if (current.isDefault) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Default communication channels cannot be modified',
          action: 'quote_communication_channel.update.conflict',
          entityType: 'quote_communication_channel',
          entityId: idResult.value,
          details: { targetLabel: current.name, secondaryLabel: 'default_channel' },
        });
      }

      const resolvedIcon = resolveIcon(icon, current.icon);
      if (!resolvedIcon) return badRequest(reply, 'Invalid communication channel icon');

      if (await channelsRepo.existsByName(nameResult.value, idResult.value)) {
        return badRequest(reply, 'Communication channel with this name already exists');
      }

      const updated = await channelsRepo.update(idResult.value, nameResult.value, resolvedIcon);
      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Communication channel not found',
          action: 'quote_communication_channel.update.not_found',
          entityType: 'quote_communication_channel',
          entityId: idResult.value,
        });
      }

      await logAudit({
        request,
        action: 'quote_communication_channel.updated',
        entityType: 'quote_communication_channel',
        entityId: updated.id,
        details: { targetLabel: updated.name, fromValue: current.name, toValue: updated.name },
      });

      const withCounts = (await channelsRepo.listAllWithCounts()).find(
        (channel) => channel.id === updated.id,
      );
      return withCounts ?? updated;
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [requireAnyPermission(...deletePermissions)],
      schema: {
        tags: ['quote-communication-channels'],
        summary: 'Delete quote communication channel',
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

      const current = await channelsRepo.findById(idResult.value);
      if (!current) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Communication channel not found',
          action: 'quote_communication_channel.delete.not_found',
          entityType: 'quote_communication_channel',
          entityId: idResult.value,
        });
      }

      if (current.isDefault) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Default communication channels cannot be deleted',
          action: 'quote_communication_channel.delete.conflict',
          entityType: 'quote_communication_channel',
          entityId: idResult.value,
          details: { targetLabel: current.name, secondaryLabel: 'default_channel' },
        });
      }

      const totalChannels = await channelsRepo.countAll();
      if (totalChannels <= 1) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Cannot delete the last communication channel',
          action: 'quote_communication_channel.delete.conflict',
          entityType: 'quote_communication_channel',
          entityId: idResult.value,
          details: { targetLabel: current.name, secondaryLabel: 'last_channel' },
        });
      }

      const counts = await channelsRepo.countReferences(idResult.value);
      if (counts.totalQuoteCount > 0) {
        return replyError(request, reply, {
          statusCode: 409,
          message: `Cannot delete channel "${current.name}" because ${counts.totalQuoteCount} quote(s) are using it`,
          action: 'quote_communication_channel.delete.conflict',
          entityType: 'quote_communication_channel',
          entityId: idResult.value,
          details: {
            targetLabel: current.name,
            secondaryLabel: 'in_use_by_quotes',
            counts: {
              clientQuotes: counts.clientQuoteCount,
              supplierQuotes: counts.supplierQuoteCount,
            },
          },
        });
      }

      const deleted = await channelsRepo.deleteById(idResult.value);
      if (!deleted) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Communication channel not found',
          action: 'quote_communication_channel.delete.not_found',
          entityType: 'quote_communication_channel',
          entityId: idResult.value,
        });
      }
      await logAudit({
        request,
        action: 'quote_communication_channel.deleted',
        entityType: 'quote_communication_channel',
        entityId: idResult.value,
        details: { targetLabel: current.name },
      });
      return reply.code(204).send();
    },
  );
}
