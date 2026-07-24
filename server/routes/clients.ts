import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import {
  authenticateToken,
  requireAnyPermission,
  requireScopedPermission,
} from '../middleware/auth.ts';
import * as clientProfileOptionsRepo from '../repositories/clientProfileOptionsRepo.ts';
import * as clientsRepo from '../repositories/clientsRepo.ts';
import * as userAssignmentsRepo from '../repositories/userAssignmentsRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import {
  type ClientCreateValidationError,
  type ClientProfileOptionMaps,
  createClientWithAssignments,
  getClientIdentifierCandidates,
  validateClientCreateInput,
} from '../services/clientCreation.ts';
import { logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { mapWithConcurrency } from '../utils/concurrency.ts';
import { getForeignKeyViolation } from '../utils/db-errors.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { requestHasPermission as hasPermission, makeAccessChecker } from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import {
  badRequest,
  optionalEmail,
  optionalNonEmptyString,
  parseOptionalStringFields,
  requireNonEmptyString,
  validateClientIdentifier,
} from '../utils/validation.ts';

const PROFILE_OPTION_CATEGORIES = clientProfileOptionsRepo.PROFILE_OPTION_CATEGORIES;
type ProfileOptionCategory = clientProfileOptionsRepo.ProfileOptionCategory;
const PROFILE_OPTION_CATEGORY_SET = new Set<string>(PROFILE_OPTION_CATEGORIES);
const BULK_CLIENT_CREATE_CONCURRENCY = 10;

const loadClientProfileOptionMaps = async (): Promise<ClientProfileOptionMaps> => {
  const maps = {
    sector: new Map(),
    numberOfEmployees: new Map(),
    revenue: new Map(),
    officeCountRange: new Map(),
  };
  for (const option of await clientProfileOptionsRepo.listValues()) {
    maps[option.category].set(option.value.toLowerCase(), option.value);
  }
  return maps;
};

const PATCH_OPTIONAL_STRING_FIELDS = [
  'phone',
  'contactName',
  'address',
  'addressCountry',
  'addressState',
  'addressCap',
  'addressProvince',
  'addressCivicNumber',
  'addressLine',
  'description',
  'atecoCode',
  'website',
  'sector',
  'numberOfEmployees',
  'revenue',
  'officeCountRange',
] as const;

type ClientContactInput = {
  fullName: unknown;
  role?: unknown;
  email?: unknown;
  phone?: unknown;
};

type ClientContact = clientsRepo.ClientContact;

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const profileOptionCategoryParamSchema = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: PROFILE_OPTION_CATEGORIES },
  },
  required: ['category'],
} as const;

const profileOptionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    category: { type: 'string', enum: PROFILE_OPTION_CATEGORIES },
    value: { type: 'string' },
    sortOrder: { type: 'number' },
    usageCount: { type: 'number' },
    createdAt: { type: ['number', 'null'] },
    updatedAt: { type: ['number', 'null'] },
  },
  required: ['id', 'category', 'value', 'sortOrder', 'usageCount'],
} as const;

const profileOptionBodySchema = {
  type: 'object',
  properties: {
    value: { type: 'string' },
    sortOrder: { type: 'number' },
  },
  required: ['value'],
} as const;

const clientContactSchema = {
  type: 'object',
  properties: {
    fullName: { type: 'string' },
    role: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
  },
  required: ['fullName'],
} as const;

const clientSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    isDisabled: { type: 'boolean' },
    isOwnCompany: { type: 'boolean' },
    type: { type: 'string' },
    contacts: { type: 'array', items: clientContactSchema },
    contactName: { type: ['string', 'null'] },
    clientCode: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    address: { type: ['string', 'null'] },
    addressCountry: { type: ['string', 'null'] },
    addressState: { type: ['string', 'null'] },
    addressCap: { type: ['string', 'null'] },
    addressProvince: { type: ['string', 'null'] },
    addressCivicNumber: { type: ['string', 'null'] },
    addressLine: { type: ['string', 'null'] },
    atecoCode: { type: ['string', 'null'] },
    website: { type: ['string', 'null'] },
    sector: { type: ['string', 'null'] },
    numberOfEmployees: { type: ['string', 'null'] },
    revenue: { type: ['string', 'null'] },
    fiscalCode: { type: ['string', 'null'] },
    officeCountRange: { type: ['string', 'null'] },
    vatNumber: { type: ['string', 'null'] },
    taxCode: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    totalSentQuotes: { type: 'number' },
    totalAcceptedOrders: { type: 'number' },
  },
  required: ['id', 'name'],
} as const;

const clientSummarySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
  },
  required: ['id', 'name'],
  additionalProperties: false,
} as const;

// anyOf, not oneOf: the summary shape ({id, name, description}) also validates
// against clientSchema because clientSchema only requires id and name. oneOf
// would mark valid responses as ambiguous under strict JSON Schema/OpenAPI.
const clientListItemSchema = {
  anyOf: [clientSchema, clientSummarySchema],
} as const;

const clientCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string' },
    contacts: { type: 'array', items: clientContactSchema },
    contactName: { type: 'string' },
    clientCode: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    address: { type: 'string' },
    addressCountry: { type: 'string' },
    addressState: { type: 'string' },
    addressCap: { type: 'string' },
    addressProvince: { type: 'string' },
    addressCivicNumber: { type: 'string' },
    addressLine: { type: 'string' },
    description: { type: 'string' },
    atecoCode: { type: 'string' },
    website: { type: 'string' },
    sector: { type: 'string' },
    numberOfEmployees: { type: 'string' },
    revenue: { type: 'string' },
    fiscalCode: { type: 'string' },
    officeCountRange: { type: 'string' },
    vatNumber: { type: 'string' },
    taxCode: { type: 'string' },
  },
  required: ['name'],
} as const;

const bulkClientCreateItemSchema = {
  type: 'object',
  properties: {
    clientCode: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' },
    fiscalCode: { type: 'string' },
    contactName: { type: 'string' },
    contactRole: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    website: { type: 'string' },
    addressCountry: { type: 'string' },
    addressState: { type: 'string' },
    addressCap: { type: 'string' },
    addressProvince: { type: 'string' },
    addressCivicNumber: { type: 'string' },
    addressLine: { type: 'string' },
    atecoCode: { type: 'string' },
    sector: { type: 'string' },
    numberOfEmployees: { type: 'string' },
    revenue: { type: 'string' },
    officeCountRange: { type: 'string' },
    description: { type: 'string' },
  },
  required: [],
  additionalProperties: false,
} as const;

const bulkClientErrorSchema = {
  type: 'object',
  properties: {
    field: { type: 'string' },
    code: {
      type: 'string',
      enum: ['required', 'invalid', 'too_long', 'duplicate', 'unknown_option', 'creation_failed'],
    },
    message: { type: 'string' },
  },
  required: ['code', 'message'],
  additionalProperties: false,
} as const;

const bulkClientResultSchema = {
  anyOf: [
    {
      type: 'object',
      properties: {
        index: { type: 'number' },
        success: { type: 'boolean', const: true },
        client: clientSchema,
      },
      required: ['index', 'success', 'client'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        index: { type: 'number' },
        success: { type: 'boolean', const: false },
        errors: { type: 'array', items: bulkClientErrorSchema, minItems: 1 },
      },
      required: ['index', 'success', 'errors'],
      additionalProperties: false,
    },
  ],
} as const;

const bulkClientResponseSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'object',
      properties: {
        total: { type: 'number' },
        succeeded: { type: 'number' },
        failed: { type: 'number' },
      },
      required: ['total', 'succeeded', 'failed'],
      additionalProperties: false,
    },
    results: { type: 'array', items: bulkClientResultSchema },
  },
  required: ['summary', 'results'],
  additionalProperties: false,
} as const;

const clientUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: ['string', 'null'] },
    isDisabled: { type: 'boolean' },
    type: { type: ['string', 'null'] },
    contacts: { type: 'array', items: clientContactSchema },
    contactName: { type: ['string', 'null'] },
    clientCode: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    address: { type: ['string', 'null'] },
    addressCountry: { type: ['string', 'null'] },
    addressState: { type: ['string', 'null'] },
    addressCap: { type: ['string', 'null'] },
    addressProvince: { type: ['string', 'null'] },
    addressCivicNumber: { type: ['string', 'null'] },
    addressLine: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
    atecoCode: { type: ['string', 'null'] },
    website: { type: ['string', 'null'] },
    sector: { type: ['string', 'null'] },
    numberOfEmployees: { type: ['string', 'null'] },
    revenue: { type: ['string', 'null'] },
    fiscalCode: { type: ['string', 'null'] },
    officeCountRange: { type: ['string', 'null'] },
    vatNumber: { type: ['string', 'null'] },
    taxCode: { type: ['string', 'null'] },
  },
} as const;

const isValidProfileOptionCategory = (value: unknown): value is ProfileOptionCategory =>
  typeof value === 'string' && PROFILE_OPTION_CATEGORY_SET.has(value);

const parseProfileOptionCategory = (
  value: unknown,
): { ok: true; value: ProfileOptionCategory } | { ok: false; message: string } => {
  if (!isValidProfileOptionCategory(value)) {
    return {
      ok: false,
      message: `category must be one of: ${PROFILE_OPTION_CATEGORIES.join(', ')}`,
    };
  }

  return { ok: true, value };
};

const parseContacts = (
  value: unknown,
): { ok: true; value: ClientContact[] } | { ok: false; message: string } => {
  if (value === undefined || value === null) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return { ok: false, message: 'contacts must be an array' };
  }

  const normalized: ClientContact[] = [];
  for (let index = 0; index < value.length; index++) {
    const raw = value[index];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, message: `contacts[${index}] must be an object` };
    }

    const contact = raw as ClientContactInput;
    const fullNameResult = requireNonEmptyString(contact.fullName, `contacts[${index}].fullName`);
    if (!fullNameResult.ok) {
      return { ok: false, message: fullNameResult.message };
    }

    const roleResult = optionalNonEmptyString(contact.role, `contacts[${index}].role`);
    if (!roleResult.ok) {
      return { ok: false, message: roleResult.message };
    }

    const emailResult = optionalEmail(contact.email, `contacts[${index}].email`);
    if (!emailResult.ok) {
      return { ok: false, message: emailResult.message };
    }

    const phoneResult = optionalNonEmptyString(contact.phone, `contacts[${index}].phone`);
    if (!phoneResult.ok) {
      return { ok: false, message: phoneResult.message };
    }

    normalized.push({
      fullName: fullNameResult.value,
      role: roleResult.value ?? undefined,
      email: emailResult.value ?? undefined,
      phone: phoneResult.value ?? undefined,
    });
  }

  return { ok: true, value: normalized };
};

const resolveFiscalCode = ({
  vatNumber,
  fiscalCode,
  taxCode,
}: {
  vatNumber: string | null;
  fiscalCode: string | null;
  taxCode: string | null;
}) => vatNumber || fiscalCode || taxCode || null;

const buildPrimaryFieldsFromContacts = (contacts: ClientContact[]) => {
  const primary = contacts[0] ?? null;
  return {
    contactName: primary?.fullName ?? null,
    email: primary?.email ?? null,
    phone: primary?.phone ?? null,
  };
};

const canAccessClient = makeAccessChecker(
  (userId, clientId) => userAssignmentsRepo.isClientAssignedToUser(userId, clientId),
  'crm.clients_all.view',
);

const CLIENT_UNIQUE_VIOLATION_MESSAGES: Record<clientsRepo.ClientUniqueViolationKind, string> = {
  client_code: 'Client ID already exists',
  fiscal_code: 'Fiscal code already exists',
};

const handleClientUniqueViolation = (err: unknown, reply: FastifyReply): boolean => {
  const kind = clientsRepo.classifyUniqueViolation(err);
  if (!kind) return false;
  badRequest(reply, CLIENT_UNIQUE_VIOLATION_MESSAGES[kind]);
  return true;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requireAnyPermission(
          'crm.clients.view',
          'crm.clients_all.view',
          'timesheets.tracker.view',
          'timesheets.tracker_all.view',
          'timesheets.recurring.view',
          'projects.manage.view',
          'projects.manage_all.view',
          'projects.tasks.view',
          'projects.tasks_all.view',
          'sales.client_quotes.view',
          'sales.client_offers.view',
          'accounting.clients_orders.view',
          'accounting.clients_invoices.view',
          'catalog.internal_listing.view',
          'sales.supplier_quotes.view',
          'administration.user_management.view',
          'administration.user_management.update',
        ),
      ],
      schema: {
        tags: ['clients'],
        summary: 'List clients',
        response: {
          200: { type: 'array', items: clientListItemSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const canViewAllClients = hasPermission(request, 'crm.clients_all.view');
      const canViewClientDetails = hasPermission(request, 'crm.clients.view');

      const clients = await clientsRepo.list(
        canViewAllClients
          ? { canViewAllClients: true }
          : { canViewAllClients: false, userId: request.user.id },
      );

      return clients.map((client) => {
        if (!canViewClientDetails) {
          return {
            id: client.id,
            name: client.name,
            description: null,
          };
        }
        return client;
      });
    },
  );

  fastify.post(
    '/',
    {
      onRequest: [authenticateToken, requireScopedPermission('crm.clients', 'create')],
      schema: {
        tags: ['clients'],
        summary: 'Create client',
        body: clientCreateBodySchema,
        response: {
          201: clientSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const profileOptions = await loadClientProfileOptionMaps();
      const validation = validateClientCreateInput(request.body as Record<string, unknown>, {
        profileOptions,
      });
      if (!validation.ok) return badRequest(reply, validation.errors[0].message);

      const [fiscalCodeConflict, clientCodeConflict] = await Promise.all([
        clientsRepo.findByFiscalCode(validation.value.fiscalCode, null),
        clientsRepo.findByClientCode(validation.value.clientCode ?? '', null),
      ]);
      if (fiscalCodeConflict) {
        return badRequest(reply, 'Fiscal code already exists');
      }
      if (clientCodeConflict) {
        return badRequest(reply, 'Client ID already exists');
      }

      try {
        const { id, client } = await createClientWithAssignments(
          validation.value,
          request.user?.id,
        );

        await logAudit({
          request,
          action: 'client.created',
          entityType: 'client',
          entityId: id,
          details: {
            targetLabel: client.name,
            secondaryLabel: client.clientCode ?? undefined,
          },
        });
        return reply.code(201).send(client);
      } catch (err) {
        if (handleClientUniqueViolation(err, reply)) return reply;
        throw err;
      }
    },
  );

  fastify.post(
    '/bulk',
    {
      bodyLimit: 10 * 1024 * 1024,
      onRequest: [authenticateToken, requireScopedPermission('crm.clients', 'create')],
      schema: {
        tags: ['clients'],
        summary: 'Create multiple clients with per-row results',
        body: {
          type: 'object',
          properties: {
            clients: {
              type: 'array',
              items: bulkClientCreateItemSchema,
              minItems: 1,
              maxItems: 500,
            },
          },
          required: ['clients'],
          additionalProperties: false,
        },
        response: {
          200: bulkClientResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clients: inputs } = request.body as { clients: Record<string, unknown>[] };
      const identifiers = inputs.map(getClientIdentifierCandidates);
      const clientCodeCounts = new Map<string, number>();
      const fiscalCodeCounts = new Map<string, number>();
      for (const identifier of identifiers) {
        if (identifier.clientCode) {
          clientCodeCounts.set(
            identifier.clientCode,
            (clientCodeCounts.get(identifier.clientCode) ?? 0) + 1,
          );
        }
        if (identifier.fiscalCode) {
          fiscalCodeCounts.set(
            identifier.fiscalCode,
            (fiscalCodeCounts.get(identifier.fiscalCode) ?? 0) + 1,
          );
        }
      }

      const [existingIdentifiers, profileOptions] = await Promise.all([
        clientsRepo.findExistingIdentifiers(
          identifiers.flatMap((value) => (value.clientCode ? [value.clientCode] : [])),
          identifiers.flatMap((value) => (value.fiscalCode ? [value.fiscalCode] : [])),
        ),
        loadClientProfileOptionMaps(),
      ]);
      const validations = inputs.map((input) =>
        validateClientCreateInput(input, {
          profileOptions,
          requireContactNameForTopLevelContactDetails: true,
        }),
      );
      const errorsByIndex: ClientCreateValidationError[][] = validations.map((validation) =>
        validation.ok ? [] : [...validation.errors],
      );
      const addError = (index: number, error: ClientCreateValidationError) => {
        if (
          !errorsByIndex[index].some(
            (existing) => existing.field === error.field && existing.code === error.code,
          )
        ) {
          errorsByIndex[index].push(error);
        }
      };

      identifiers.forEach((identifier, index) => {
        if (identifier.clientCode && (clientCodeCounts.get(identifier.clientCode) ?? 0) > 1) {
          addError(index, {
            field: 'clientCode',
            code: 'duplicate',
            message: 'Client ID is duplicated within this batch',
          });
        }
        if (identifier.fiscalCode && (fiscalCodeCounts.get(identifier.fiscalCode) ?? 0) > 1) {
          addError(index, {
            field: 'fiscalCode',
            code: 'duplicate',
            message: 'Fiscal code is duplicated within this batch',
          });
        }
        if (identifier.clientCode && existingIdentifiers.clientCodes.has(identifier.clientCode)) {
          addError(index, {
            field: 'clientCode',
            code: 'duplicate',
            message: 'Client ID already exists',
          });
        }
        if (identifier.fiscalCode && existingIdentifiers.fiscalCodes.has(identifier.fiscalCode)) {
          addError(index, {
            field: 'fiscalCode',
            code: 'duplicate',
            message: 'Fiscal code already exists',
          });
        }
      });

      const results = await mapWithConcurrency(
        inputs,
        BULK_CLIENT_CREATE_CONCURRENCY,
        async (
          _input,
          index,
        ): Promise<
          | { index: number; success: true; client: clientsRepo.Client }
          | { index: number; success: false; errors: ClientCreateValidationError[] }
        > => {
          const validation = validations[index];
          if (!validation.ok || errorsByIndex[index].length > 0) {
            return { index, success: false, errors: errorsByIndex[index] };
          }

          try {
            const { id, client } = await createClientWithAssignments(
              validation.value,
              request.user?.id,
            );
            try {
              await logAudit({
                request,
                action: 'client.created',
                entityType: 'client',
                entityId: id,
                details: {
                  targetLabel: client.name,
                  secondaryLabel: client.clientCode ?? undefined,
                },
              });
            } catch (auditError) {
              request.log.warn({ err: auditError, clientId: id }, 'Failed to audit bulk client');
            }
            return { index, success: true, client };
          } catch (err) {
            const duplicateKind = clientsRepo.classifyUniqueViolation(err);
            if (duplicateKind) {
              return {
                index,
                success: false,
                errors: [
                  duplicateKind === 'client_code'
                    ? {
                        field: 'clientCode',
                        code: 'duplicate',
                        message: 'Client ID already exists',
                      }
                    : {
                        field: 'fiscalCode',
                        code: 'duplicate',
                        message: 'Fiscal code already exists',
                      },
                ],
              };
            }
            request.log.error({ err, index }, 'Failed to create client in bulk operation');
            return {
              index,
              success: false,
              errors: [{ code: 'creation_failed', message: 'Unable to create client' }],
            };
          }
        },
      );

      const succeeded = results.filter((result) => result.success).length;
      return reply.send({
        summary: {
          total: results.length,
          succeeded,
          failed: results.length - succeeded,
        },
        results,
      });
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requireScopedPermission('crm.clients', 'update')],
      schema: {
        tags: ['clients'],
        summary: 'Update client',
        params: idParamSchema,
        body: clientUpdateBodySchema,
        response: {
          200: clientSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Record<string, unknown>;

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (!(await canAccessClient(request, idResult.value, 'crm.clients_all.update'))) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'client.update.denied',
          entityType: 'client',
          entityId: idResult.value,
          details: { secondaryLabel: 'client_access_denied' },
        });
      }
      if (idResult.value === clientsRepo.OWN_COMPANY_CLIENT_ID) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'The company client is managed through Branding',
          action: 'client.update.conflict',
          entityType: 'client',
          entityId: idResult.value,
          details: { secondaryLabel: 'own_company_managed_by_branding' },
        });
      }

      const hasName = Object.hasOwn(body, 'name');
      const hasClientCode = Object.hasOwn(body, 'clientCode');
      const hasFiscalCode = Object.hasOwn(body, 'fiscalCode');
      const hasVatNumber = Object.hasOwn(body, 'vatNumber');
      const hasTaxCode = Object.hasOwn(body, 'taxCode');
      const hasContacts = Object.hasOwn(body, 'contacts');
      const hasContactName = Object.hasOwn(body, 'contactName');
      const hasEmail = Object.hasOwn(body, 'email');
      const hasPhone = Object.hasOwn(body, 'phone');
      const hasAddress = Object.hasOwn(body, 'address');
      const hasAddressCountry = Object.hasOwn(body, 'addressCountry');
      const hasAddressState = Object.hasOwn(body, 'addressState');
      const hasAddressCap = Object.hasOwn(body, 'addressCap');
      const hasAddressProvince = Object.hasOwn(body, 'addressProvince');
      const hasAddressCivicNumber = Object.hasOwn(body, 'addressCivicNumber');
      const hasAddressLine = Object.hasOwn(body, 'addressLine');
      const hasDescription = Object.hasOwn(body, 'description');
      const hasAtecoCode = Object.hasOwn(body, 'atecoCode');
      const hasWebsite = Object.hasOwn(body, 'website');
      const hasSector = Object.hasOwn(body, 'sector');
      const hasNumberOfEmployees = Object.hasOwn(body, 'numberOfEmployees');
      const hasRevenue = Object.hasOwn(body, 'revenue');
      const hasOfficeCountRange = Object.hasOwn(body, 'officeCountRange');
      const hasType = Object.hasOwn(body, 'type');
      const hasIsDisabled = Object.hasOwn(body, 'isDisabled');

      let nameValue: string | null = null;
      if (hasName) {
        const nameResult = requireNonEmptyString(body.name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);
        nameValue = nameResult.value;
      }

      let clientCodeValue: string | null = null;
      if (hasClientCode) {
        const clientCodeResult = validateClientIdentifier(body.clientCode, 'clientCode');
        if (!clientCodeResult.ok) return badRequest(reply, clientCodeResult.message);
        clientCodeValue = clientCodeResult.value;
      }

      let fiscalCodeValue: string | null = null;
      if (hasFiscalCode) {
        const fiscalCodeResult = optionalNonEmptyString(body.fiscalCode, 'fiscalCode');
        if (!fiscalCodeResult.ok) return badRequest(reply, fiscalCodeResult.message);
        fiscalCodeValue = fiscalCodeResult.value;
      }

      let vatNumberValue: string | null = null;
      if (hasVatNumber) {
        const vatNumberResult = optionalNonEmptyString(body.vatNumber, 'vatNumber');
        if (!vatNumberResult.ok) return badRequest(reply, vatNumberResult.message);
        vatNumberValue = vatNumberResult.value;
      }

      let taxCodeValue: string | null = null;
      if (hasTaxCode) {
        const taxCodeResult = optionalNonEmptyString(body.taxCode, 'taxCode');
        if (!taxCodeResult.ok) return badRequest(reply, taxCodeResult.message);
        taxCodeValue = taxCodeResult.value;
      }

      // `fiscal_code` is the legacy shadow column backing `idx_clients_fiscal_code_unique` and
      // `findByFiscalCode` duplicate detection. It must follow the primary identifier
      // (vatNumber, or fiscalCode for legacy callers), but a taxCode-only PUT must NOT
      // overwrite it — otherwise updating taxCode could clobber a vat_number-derived
      // fiscal_code and let duplicate vatNumbers slip past the uniqueness check.
      const hasPrimaryIdentifierUpdate = hasVatNumber || hasFiscalCode;
      let resolvedFiscalCode: string | null = null;
      if (hasPrimaryIdentifierUpdate) {
        resolvedFiscalCode = resolveFiscalCode({
          vatNumber: vatNumberValue,
          fiscalCode: fiscalCodeValue,
          taxCode: null,
        });
        if (!resolvedFiscalCode) {
          return badRequest(reply, 'Fiscal code is required');
        }
      }

      const contactsResult = parseContacts(hasContacts ? body.contacts : undefined);
      if (!contactsResult.ok) return badRequest(reply, contactsResult.message);

      const emailResult = optionalEmail(body.email, 'email');
      if (!emailResult.ok) return badRequest(reply, emailResult.message);

      const optionalFields = parseOptionalStringFields(body, PATCH_OPTIONAL_STRING_FIELDS);
      if (!optionalFields.ok) return badRequest(reply, optionalFields.message);
      const opt = optionalFields.values;

      const [fiscalCodeConflict, clientCodeConflict, current] = await Promise.all([
        resolvedFiscalCode
          ? clientsRepo.findByFiscalCode(resolvedFiscalCode, idResult.value)
          : Promise.resolve(false),
        clientCodeValue
          ? clientsRepo.findByClientCode(clientCodeValue, idResult.value)
          : Promise.resolve(false),
        clientsRepo.findContactsForUpdate(idResult.value),
      ]);
      if (fiscalCodeConflict) {
        return badRequest(reply, 'Fiscal code already exists');
      }
      if (clientCodeConflict) {
        return badRequest(reply, 'Client ID already exists');
      }
      if (!current) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Client not found',
          action: 'client.update.not_found',
          entityType: 'client',
          entityId: idResult.value,
        });
      }

      const effectiveContacts = hasContacts ? contactsResult.value : current.contacts;
      const primaryFromContacts = buildPrimaryFieldsFromContacts(effectiveContacts);

      const finalContactName = hasContactName
        ? (opt.contactName ?? null)
        : hasContacts
          ? primaryFromContacts.contactName
          : null;
      const finalEmail = hasEmail
        ? emailResult.value
        : hasContacts
          ? primaryFromContacts.email
          : null;
      const finalPhone = hasPhone
        ? (opt.phone ?? null)
        : hasContacts
          ? primaryFromContacts.phone
          : null;
      const shouldUpdateContactName = hasContactName || hasContacts;
      const shouldUpdateEmail = hasEmail || hasContacts;
      const shouldUpdatePhone = hasPhone || hasContacts;

      try {
        const client = await clientsRepo.update(idResult.value, {
          name: hasName ? nameValue : null,
          isDisabled: hasIsDisabled ? (body.isDisabled as boolean | null) : null,
          type: hasType ? (body.type as string | null) : null,
          contacts: hasContacts ? effectiveContacts : null,
          clientCode: hasClientCode ? clientCodeValue : null,
          address: opt.address ?? null,
          addressCountry: opt.addressCountry ?? null,
          addressState: opt.addressState ?? null,
          addressCap: opt.addressCap ?? null,
          addressProvince: opt.addressProvince ?? null,
          addressCivicNumber: opt.addressCivicNumber ?? null,
          addressLine: opt.addressLine ?? null,
          description: opt.description ?? null,
          atecoCode: opt.atecoCode ?? null,
          website: opt.website ?? null,
          fiscalCode: hasPrimaryIdentifierUpdate ? resolvedFiscalCode : null,
          vatNumber: vatNumberValue,
          vatNumberProvided: hasVatNumber,
          taxCode: taxCodeValue,
          taxCodeProvided: hasTaxCode,
          contactName: finalContactName,
          contactNameProvided: shouldUpdateContactName,
          email: finalEmail,
          emailProvided: shouldUpdateEmail,
          phone: finalPhone,
          phoneProvided: shouldUpdatePhone,
          sector: opt.sector ?? null,
          sectorProvided: hasSector,
          numberOfEmployees: opt.numberOfEmployees ?? null,
          numberOfEmployeesProvided: hasNumberOfEmployees,
          revenue: opt.revenue ?? null,
          revenueProvided: hasRevenue,
          officeCountRange: opt.officeCountRange ?? null,
          officeCountRangeProvided: hasOfficeCountRange,
        });

        if (!client) {
          return replyError(request, reply, {
            statusCode: 404,
            message: 'Client not found',
            action: 'client.update.not_found',
            entityType: 'client',
            entityId: idResult.value,
          });
        }

        const changedFields = [
          hasName ? 'name' : null,
          hasIsDisabled ? 'isDisabled' : null,
          hasType ? 'type' : null,
          hasContacts ? 'contacts' : null,
          hasContactName ? 'contactName' : null,
          hasClientCode ? 'clientCode' : null,
          hasEmail ? 'email' : null,
          hasPhone ? 'phone' : null,
          hasAddress ? 'address' : null,
          hasAddressCountry ? 'addressCountry' : null,
          hasAddressState ? 'addressState' : null,
          hasAddressCap ? 'addressCap' : null,
          hasAddressProvince ? 'addressProvince' : null,
          hasAddressCivicNumber ? 'addressCivicNumber' : null,
          hasAddressLine ? 'addressLine' : null,
          hasDescription ? 'description' : null,
          hasAtecoCode ? 'atecoCode' : null,
          hasWebsite ? 'website' : null,
          hasSector ? 'sector' : null,
          hasNumberOfEmployees ? 'numberOfEmployees' : null,
          hasRevenue ? 'revenue' : null,
          hasVatNumber || hasFiscalCode || hasTaxCode ? 'fiscalCode' : null,
          hasOfficeCountRange ? 'officeCountRange' : null,
        ].filter((field): field is string => field !== null);

        let action = 'client.updated';
        if (changedFields.length === 1 && changedFields[0] === 'isDisabled') {
          action = body.isDisabled ? 'client.disabled' : 'client.enabled';
        }

        await logAudit({
          request,
          action,
          entityType: 'client',
          entityId: idResult.value,
          details: {
            targetLabel: client.name,
            secondaryLabel: client.clientCode ?? undefined,
          },
        });
        return client;
      } catch (err) {
        if (handleClientUniqueViolation(err, reply)) return reply;
        throw err;
      }
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [authenticateToken, requireScopedPermission('crm.clients', 'delete')],
      schema: {
        tags: ['clients'],
        summary: 'Delete client',
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

      if (!(await canAccessClient(request, idResult.value, 'crm.clients_all.delete'))) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'client.delete.denied',
          entityType: 'client',
          entityId: idResult.value,
          details: { secondaryLabel: 'client_access_denied' },
        });
      }
      if (idResult.value === clientsRepo.OWN_COMPANY_CLIENT_ID) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'The company client is managed through Branding',
          action: 'client.delete.conflict',
          entityType: 'client',
          entityId: idResult.value,
          details: { secondaryLabel: 'own_company_managed_by_branding' },
        });
      }

      let deleted: Awaited<ReturnType<typeof clientsRepo.deleteById>>;
      try {
        deleted = await clientsRepo.deleteById(idResult.value);
      } catch (err) {
        // Financial-doc tables (invoices, quotes, customer_offers, sales) now reference
        // clients with ON DELETE RESTRICT instead of CASCADE - deleting a client with any
        // such document errors at the FK layer. Translate to a 409 so the UI can surface
        // a clear "client has financial documents" message instead of leaking a 500.
        if (getForeignKeyViolation(err)) {
          return replyError(request, reply, {
            statusCode: 409,
            message:
              'Cannot delete client because it has financial documents (invoices, quotes, offers, or sales). Remove them first.',
            action: 'client.delete.conflict',
            entityType: 'client',
            entityId: idResult.value,
            details: { secondaryLabel: 'has_financial_documents' },
          });
        }
        throw err;
      }
      if (!deleted) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Client not found',
          action: 'client.delete.not_found',
          entityType: 'client',
          entityId: idResult.value,
        });
      }

      await logAudit({
        request,
        action: 'client.deleted',
        entityType: 'client',
        entityId: idResult.value,
        details: {
          targetLabel: deleted.name,
          secondaryLabel: deleted.clientCode ?? undefined,
        },
      });
      return reply.code(204).send();
    },
  );

  fastify.get(
    '/profile-options/:category',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requireScopedPermission('crm.clients', 'view'),
      ],
      schema: {
        tags: ['clients'],
        summary: 'List client profile options for category',
        params: profileOptionCategoryParamSchema,
        response: {
          200: { type: 'array', items: profileOptionSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const categoryResult = parseProfileOptionCategory(
        (request.params as { category: string }).category,
      );
      if (!categoryResult.ok) return badRequest(reply, categoryResult.message);

      return clientProfileOptionsRepo.listByCategory(categoryResult.value);
    },
  );

  fastify.post(
    '/profile-options/:category',
    {
      onRequest: [authenticateToken, requireScopedPermission('crm.clients', 'update')],
      schema: {
        tags: ['clients'],
        summary: 'Create client profile option',
        params: profileOptionCategoryParamSchema,
        body: profileOptionBodySchema,
        response: {
          201: profileOptionSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const categoryResult = parseProfileOptionCategory(
        (request.params as { category: string }).category,
      );
      if (!categoryResult.ok) return badRequest(reply, categoryResult.message);

      const { value, sortOrder } = request.body as { value: unknown; sortOrder?: unknown };

      const valueResult = requireNonEmptyString(value, 'value');
      if (!valueResult.ok) return badRequest(reply, valueResult.message);

      const sortOrderValue = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : null;

      const [valueExists, nextSortOrder] = await Promise.all([
        clientProfileOptionsRepo.findByCategoryAndValue(
          categoryResult.value,
          valueResult.value,
          null,
        ),
        clientProfileOptionsRepo.getNextSortOrder(categoryResult.value),
      ]);
      if (valueExists) {
        return badRequest(reply, 'Option with this value already exists for this category');
      }
      const id = generatePrefixedId('cpo');

      const option = await clientProfileOptionsRepo.create({
        id,
        category: categoryResult.value,
        value: valueResult.value,
        sortOrder: sortOrderValue ?? nextSortOrder,
      });

      await logAudit({
        request,
        action: 'client.profile_option.created',
        entityType: 'client_profile_option',
        entityId: id,
        details: {
          targetLabel: valueResult.value,
          secondaryLabel: categoryResult.value,
        },
      });

      return reply.code(201).send(option);
    },
  );

  fastify.put(
    '/profile-options/:category/:id',
    {
      onRequest: [authenticateToken, requireScopedPermission('crm.clients', 'update')],
      schema: {
        tags: ['clients'],
        summary: 'Update client profile option',
        params: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: PROFILE_OPTION_CATEGORIES },
            id: { type: 'string' },
          },
          required: ['category', 'id'],
        },
        body: profileOptionBodySchema,
        response: {
          200: profileOptionSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { category: string; id: string };
      const categoryResult = parseProfileOptionCategory(params.category);
      if (!categoryResult.ok) return badRequest(reply, categoryResult.message);

      const idResult = requireNonEmptyString(params.id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const { value, sortOrder } = request.body as { value: unknown; sortOrder?: unknown };
      const valueResult = requireNonEmptyString(value, 'value');
      if (!valueResult.ok) return badRequest(reply, valueResult.message);

      if (
        !(await clientProfileOptionsRepo.findByCategoryAndId(categoryResult.value, idResult.value))
      ) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Profile option not found',
          action: 'client_profile_option.update.not_found',
          entityType: 'client_profile_option',
          entityId: idResult.value,
        });
      }

      if (
        await clientProfileOptionsRepo.findByCategoryAndValue(
          categoryResult.value,
          valueResult.value,
          idResult.value,
        )
      ) {
        return badRequest(reply, 'Option with this value already exists for this category');
      }

      const sortOrderValue = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : null;
      const updated = await withDbTransaction((tx) =>
        clientProfileOptionsRepo.update(
          categoryResult.value,
          idResult.value,
          {
            value: valueResult.value,
            sortOrder: sortOrderValue,
          },
          tx,
        ),
      );

      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Profile option not found',
          action: 'client_profile_option.update.not_found',
          entityType: 'client_profile_option',
          entityId: idResult.value,
        });
      }

      await logAudit({
        request,
        action: 'client.profile_option.updated',
        entityType: 'client_profile_option',
        entityId: idResult.value,
        details: {
          targetLabel: valueResult.value,
          secondaryLabel: categoryResult.value,
        },
      });

      return updated;
    },
  );

  fastify.delete(
    '/profile-options/:category/:id',
    {
      onRequest: [authenticateToken, requireScopedPermission('crm.clients', 'update')],
      schema: {
        tags: ['clients'],
        summary: 'Delete client profile option',
        params: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: PROFILE_OPTION_CATEGORIES },
            id: { type: 'string' },
          },
          required: ['category', 'id'],
        },
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { category: string; id: string };
      const categoryResult = parseProfileOptionCategory(params.category);
      if (!categoryResult.ok) return badRequest(reply, categoryResult.message);

      const idResult = requireNonEmptyString(params.id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const result = await withDbTransaction((tx) =>
        clientProfileOptionsRepo.deleteUnused(categoryResult.value, idResult.value, tx),
      );
      if (result.status === 'not_found') {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Profile option not found',
          action: 'client_profile_option.delete.not_found',
          entityType: 'client_profile_option',
          entityId: idResult.value,
        });
      }

      if (result.status === 'in_use') {
        return replyError(request, reply, {
          statusCode: 409,
          message: `Cannot delete option "${result.value}" because it is used by ${result.usageCount} client(s)`,
          action: 'client_profile_option.delete.conflict',
          entityType: 'client_profile_option',
          entityId: idResult.value,
          details: {
            targetLabel: result.value,
            secondaryLabel: 'option_in_use',
            counts: { clients: result.usageCount },
          },
        });
      }

      await logAudit({
        request,
        action: 'client.profile_option.deleted',
        entityType: 'client_profile_option',
        entityId: idResult.value,
        details: {
          targetLabel: result.value,
          secondaryLabel: categoryResult.value,
        },
      });

      return reply.code(204).send();
    },
  );
}
