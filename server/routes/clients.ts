import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import * as clientProfileOptionsRepo from '../repositories/clientProfileOptionsRepo.ts';
import * as clientsRepo from '../repositories/clientsRepo.ts';
import * as userAssignmentsRepo from '../repositories/userAssignmentsRepo.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { requestHasPermission as hasPermission } from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
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
          'timesheets.recurring.view',
          'projects.manage.view',
          'projects.tasks.view',
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
          200: { type: 'array', items: clientSchema },
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
      onRequest: [authenticateToken, requirePermission('crm.clients.create')],
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
      const {
        name,
        type,
        contacts,
        contactName,
        clientCode,
        email,
        phone,
        address,
        addressCountry,
        addressState,
        addressCap,
        addressProvince,
        addressCivicNumber,
        addressLine,
        description,
        atecoCode,
        website,
        sector,
        numberOfEmployees,
        revenue,
        fiscalCode,
        officeCountRange,
        vatNumber,
        taxCode,
      } = request.body as Record<string, unknown>;

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const contactsResult = parseContacts(contacts);
      if (!contactsResult.ok) return badRequest(reply, contactsResult.message);

      const clientCodeResult = validateClientIdentifier(clientCode, 'clientCode');
      if (!clientCodeResult.ok) return badRequest(reply, clientCodeResult.message);

      const fiscalCodeResult = optionalNonEmptyString(fiscalCode, 'fiscalCode');
      if (!fiscalCodeResult.ok) return badRequest(reply, fiscalCodeResult.message);

      const vatNumberResult = optionalNonEmptyString(vatNumber, 'vatNumber');
      if (!vatNumberResult.ok) return badRequest(reply, vatNumberResult.message);

      const taxCodeResult = optionalNonEmptyString(taxCode, 'taxCode');
      if (!taxCodeResult.ok) return badRequest(reply, taxCodeResult.message);

      const resolvedFiscalCode = resolveFiscalCode({
        vatNumber: vatNumberResult.value,
        fiscalCode: fiscalCodeResult.value,
        taxCode: taxCodeResult.value,
      });
      if (!resolvedFiscalCode) return badRequest(reply, 'Fiscal code is required');

      const addressResult = optionalNonEmptyString(address, 'address');
      if (!addressResult.ok) return badRequest(reply, addressResult.message);
      const addressCountryResult = optionalNonEmptyString(addressCountry, 'addressCountry');
      if (!addressCountryResult.ok) return badRequest(reply, addressCountryResult.message);
      const addressStateResult = optionalNonEmptyString(addressState, 'addressState');
      if (!addressStateResult.ok) return badRequest(reply, addressStateResult.message);
      const addressCapResult = optionalNonEmptyString(addressCap, 'addressCap');
      if (!addressCapResult.ok) return badRequest(reply, addressCapResult.message);
      const addressProvinceResult = optionalNonEmptyString(addressProvince, 'addressProvince');
      if (!addressProvinceResult.ok) return badRequest(reply, addressProvinceResult.message);
      const addressCivicNumberResult = optionalNonEmptyString(
        addressCivicNumber,
        'addressCivicNumber',
      );
      if (!addressCivicNumberResult.ok) return badRequest(reply, addressCivicNumberResult.message);
      const addressLineResult = optionalNonEmptyString(addressLine, 'addressLine');
      if (!addressLineResult.ok) return badRequest(reply, addressLineResult.message);

      const descriptionResult = optionalNonEmptyString(description, 'description');
      if (!descriptionResult.ok) return badRequest(reply, descriptionResult.message);

      const atecoCodeResult = optionalNonEmptyString(atecoCode, 'atecoCode');
      if (!atecoCodeResult.ok) return badRequest(reply, atecoCodeResult.message);

      const websiteResult = optionalNonEmptyString(website, 'website');
      if (!websiteResult.ok) return badRequest(reply, websiteResult.message);

      const sectorResult = optionalNonEmptyString(sector, 'sector');
      if (!sectorResult.ok) return badRequest(reply, sectorResult.message);

      const numberOfEmployeesResult = optionalNonEmptyString(
        numberOfEmployees,
        'numberOfEmployees',
      );
      if (!numberOfEmployeesResult.ok) return badRequest(reply, numberOfEmployeesResult.message);

      const revenueResult = optionalNonEmptyString(revenue, 'revenue');
      if (!revenueResult.ok) return badRequest(reply, revenueResult.message);

      const officeCountRangeResult = optionalNonEmptyString(officeCountRange, 'officeCountRange');
      if (!officeCountRangeResult.ok) return badRequest(reply, officeCountRangeResult.message);

      const explicitContactNameResult = optionalNonEmptyString(contactName, 'contactName');
      if (!explicitContactNameResult.ok)
        return badRequest(reply, explicitContactNameResult.message);

      const explicitEmailResult = optionalEmail(email, 'email');
      if (!explicitEmailResult.ok) return badRequest(reply, explicitEmailResult.message);

      const explicitPhoneResult = optionalNonEmptyString(phone, 'phone');
      if (!explicitPhoneResult.ok) return badRequest(reply, explicitPhoneResult.message);

      const [fiscalCodeConflict, clientCodeConflict] = await Promise.all([
        clientsRepo.findByFiscalCode(resolvedFiscalCode, null),
        clientCodeResult.value
          ? clientsRepo.findByClientCode(clientCodeResult.value, null)
          : Promise.resolve(false),
      ]);
      if (fiscalCodeConflict) {
        return badRequest(reply, 'Fiscal code already exists');
      }
      if (clientCodeConflict) {
        return badRequest(reply, 'Client ID already exists');
      }

      const id = 'c-' + Date.now();
      const contactsValue = contactsResult.value;
      const primaryFromContacts = buildPrimaryFieldsFromContacts(contactsValue);

      try {
        const client = await clientsRepo.create({
          id,
          name: nameResult.value,
          type: typeof type === 'string' && type ? type : 'company',
          contacts: contactsValue,
          contactName: explicitContactNameResult.value ?? primaryFromContacts.contactName,
          clientCode: clientCodeResult.value,
          email: explicitEmailResult.value ?? primaryFromContacts.email,
          phone: explicitPhoneResult.value ?? primaryFromContacts.phone,
          address: addressResult.value,
          addressCountry: addressCountryResult.value,
          addressState: addressStateResult.value,
          addressCap: addressCapResult.value,
          addressProvince: addressProvinceResult.value,
          addressCivicNumber: addressCivicNumberResult.value,
          addressLine: addressLineResult.value,
          description: descriptionResult.value,
          atecoCode: atecoCodeResult.value,
          website: websiteResult.value,
          sector: sectorResult.value,
          numberOfEmployees: numberOfEmployeesResult.value,
          revenue: revenueResult.value,
          fiscalCode: resolvedFiscalCode,
          officeCountRange: officeCountRangeResult.value,
        });

        if (request.user?.id) {
          await userAssignmentsRepo.assignClientToUser(request.user.id, id);
        }
        await userAssignmentsRepo.assignClientToTopManagers(id);
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
        const dup = getUniqueViolation(err);
        if (dup) {
          if (dup.constraint === 'idx_clients_fiscal_code_unique') {
            return badRequest(reply, 'Fiscal code already exists');
          }
          if (dup.constraint === 'idx_clients_client_code_unique') {
            return badRequest(reply, 'Client ID already exists');
          }
          if (dup.detail?.includes('client_code')) {
            return badRequest(reply, 'Client ID already exists');
          }
          return badRequest(reply, 'Fiscal code already exists');
        }
        throw err;
      }
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('crm.clients.update')],
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

      const hasFiscalUpdate = hasVatNumber || hasFiscalCode || hasTaxCode;
      let resolvedFiscalCode: string | null = null;
      if (hasFiscalUpdate) {
        resolvedFiscalCode = resolveFiscalCode({
          vatNumber: vatNumberValue,
          fiscalCode: fiscalCodeValue,
          taxCode: taxCodeValue,
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
        return reply.code(404).send({ error: 'Client not found' });
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
          fiscalCode: hasFiscalUpdate ? resolvedFiscalCode : null,
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
          return reply.code(404).send({ error: 'Client not found' });
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
          hasFiscalUpdate ? 'fiscalCode' : null,
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
        const dup = getUniqueViolation(err);
        if (dup) {
          if (dup.constraint === 'idx_clients_fiscal_code_unique') {
            return badRequest(reply, 'Fiscal code already exists');
          }
          if (dup.constraint === 'idx_clients_client_code_unique') {
            return badRequest(reply, 'Client ID already exists');
          }
          if (dup.detail?.includes('client_code')) {
            return badRequest(reply, 'Client ID already exists');
          }
          return badRequest(reply, 'Fiscal code already exists');
        }
        throw err;
      }
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('crm.clients.delete')],
      schema: {
        tags: ['clients'],
        summary: 'Delete client',
        params: idParamSchema,
        response: {
          200: messageResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const deleted = await clientsRepo.deleteById(idResult.value);
      if (!deleted) {
        return reply.code(404).send({ error: 'Client not found' });
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
      return { message: 'Client deleted' };
    },
  );

  fastify.get(
    '/profile-options/:category',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requireAnyPermission('crm.clients.view', 'crm.clients_all.view'),
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
      onRequest: [authenticateToken, requirePermission('crm.clients.update')],
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
      onRequest: [authenticateToken, requirePermission('crm.clients.update')],
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

      const existing = await clientProfileOptionsRepo.findByCategoryAndId(
        categoryResult.value,
        idResult.value,
      );
      if (!existing) {
        return reply.code(404).send({ error: 'Profile option not found' });
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
            previousValue: existing.value,
          },
          tx,
        ),
      );

      if (!updated) {
        return reply.code(404).send({ error: 'Profile option not found' });
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
      onRequest: [authenticateToken, requirePermission('crm.clients.update')],
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
          200: messageResponseSchema,
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

      const existing = await clientProfileOptionsRepo.findByCategoryAndId(
        categoryResult.value,
        idResult.value,
      );
      if (!existing) {
        return reply.code(404).send({ error: 'Profile option not found' });
      }

      const usageCount = await clientProfileOptionsRepo.getUsageCount(
        categoryResult.value,
        idResult.value,
      );
      if (usageCount > 0) {
        return reply.code(409).send({
          error: `Cannot delete option "${existing.value}" because it is used by ${usageCount} client(s)`,
        });
      }

      await clientProfileOptionsRepo.deleteById(idResult.value);

      await logAudit({
        request,
        action: 'client.profile_option.deleted',
        entityType: 'client_profile_option',
        entityId: idResult.value,
        details: {
          targetLabel: existing.value,
          secondaryLabel: categoryResult.value,
        },
      });

      return { message: 'Profile option deleted' };
    },
  );
}
