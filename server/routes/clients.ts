import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { assignClientToTopManagers, assignClientToUser } from '../utils/top-manager-assignments.ts';
import {
  badRequest,
  optionalEmail,
  optionalNonEmptyString,
  requireNonEmptyString,
  validateClientIdentifier,
} from '../utils/validation.ts';

const PROFILE_OPTION_CATEGORIES = [
  'sector',
  'numberOfEmployees',
  'revenue',
  'officeCountRange',
] as const;

type ProfileOptionCategory = (typeof PROFILE_OPTION_CATEGORIES)[number];

type ClientContactInput = {
  fullName: unknown;
  role?: unknown;
  email?: unknown;
  phone?: unknown;
};

type ClientContact = {
  fullName: string;
  role?: string;
  email?: string;
  phone?: string;
};

const PROFILE_OPTION_CATEGORY_SET = new Set<string>(PROFILE_OPTION_CATEGORIES);

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

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

const hasPermission = (request: FastifyRequest, permission: string) =>
  request.user?.permissions?.includes(permission) ?? false;

const toNumber = (v: unknown): number | undefined => {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const toOptionalTrimmedString = (
  value: unknown,
  fieldName: string,
): { ok: true; value: string | null } | { ok: false; message: string } =>
  optionalNonEmptyString(value, fieldName);

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

const parseContactsFromDb = (value: unknown): ClientContact[] => {
  if (!Array.isArray(value)) return [];

  const contacts: ClientContact[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const fullName =
      typeof item.fullName === 'string'
        ? item.fullName.trim()
        : typeof item.name === 'string'
          ? item.name.trim()
          : '';
    if (!fullName) continue;

    const role = typeof item.role === 'string' ? item.role.trim() : '';
    const email = typeof item.email === 'string' ? item.email.trim() : '';
    const phone = typeof item.phone === 'string' ? item.phone.trim() : '';

    contacts.push({
      fullName,
      role: role || undefined,
      email: email || undefined,
      phone: phone || undefined,
    });
  }

  return contacts;
};

const formatAddress = ({
  civicNumber,
  line,
  cap,
  state,
  province,
  country,
}: {
  civicNumber: string | null;
  line: string | null;
  cap: string | null;
  state: string | null;
  province: string | null;
  country: string | null;
}) => {
  const street = [line, civicNumber].filter(Boolean).join(' ').trim();
  const locality = [cap, state].filter(Boolean).join(' ').trim();
  const provinceChunk = province ? `(${province})` : '';
  return [street, [locality, provinceChunk].filter(Boolean).join(' ').trim(), country]
    .filter((chunk) => chunk && chunk.trim().length > 0)
    .join(', ');
};

const getPrimaryContact = (contacts: ClientContact[]) => contacts[0] ?? null;

const mapClientRow = (c: Record<string, unknown>) => {
  const fiscalCode = (c.fiscal_code as string | null) || null;
  const createdAt = c.created_at ? new Date(c.created_at as string).getTime() : undefined;
  const contacts = parseContactsFromDb(c.contacts);
  const primaryContact = getPrimaryContact(contacts);

  const addressCountry = (c.address_country as string | null) || null;
  const addressState = (c.address_state as string | null) || null;
  const addressCap = (c.address_cap as string | null) || null;
  const addressProvince = (c.address_province as string | null) || null;
  const addressCivicNumber = (c.address_civic_number as string | null) || null;
  const addressLine = (c.address_line as string | null) || null;

  const computedAddress = formatAddress({
    civicNumber: addressCivicNumber,
    line: addressLine,
    cap: addressCap,
    state: addressState,
    province: addressProvince,
    country: addressCountry,
  });

  return {
    id: c.id,
    name: c.name,
    description: c.description,
    isDisabled: c.is_disabled,
    type: c.type,
    contacts,
    contactName: (c.contact_name as string | null) || primaryContact?.fullName || null,
    clientCode: c.client_code,
    email: (c.email as string | null) || primaryContact?.email || null,
    phone: (c.phone as string | null) || primaryContact?.phone || null,
    address: (c.address as string | null) || computedAddress || null,
    addressCountry,
    addressState,
    addressCap,
    addressProvince,
    addressCivicNumber,
    addressLine,
    atecoCode: c.ateco_code,
    website: c.website,
    sector: c.sector,
    numberOfEmployees: c.number_of_employees,
    revenue: c.revenue,
    fiscalCode,
    officeCountRange: c.office_count_range,
    totalSentQuotes: toNumber(c.total_sent_quotes),
    totalAcceptedOrders: toNumber(c.total_accepted_orders),
    vatNumber: fiscalCode,
    taxCode: fiscalCode,
    createdAt,
  };
};

const mapProfileOptionRow = (row: Record<string, unknown>) => ({
  id: String(row.id),
  category: String(row.category),
  value: String(row.value),
  sortOrder: Number(row.sort_order ?? 0),
  usageCount: Number(row.usage_count ?? 0),
  createdAt: row.created_at ? new Date(String(row.created_at)).getTime() : null,
  updatedAt: row.updated_at ? new Date(String(row.updated_at)).getTime() : null,
});

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
  const primary = getPrimaryContact(contacts);
  return {
    contactName: primary?.fullName ?? null,
    email: primary?.email ?? null,
    phone: primary?.phone ?? null,
  };
};

const getUsageCountExpression = (category: ProfileOptionCategory) => {
  switch (category) {
    case 'sector':
      return '(SELECT COUNT(*) FROM clients c WHERE c.sector = o.value)';
    case 'numberOfEmployees':
      return '(SELECT COUNT(*) FROM clients c WHERE c.number_of_employees = o.value)';
    case 'revenue':
      return '(SELECT COUNT(*) FROM clients c WHERE c.revenue = o.value)';
    case 'officeCountRange':
      return '(SELECT COUNT(*) FROM clients c WHERE c.office_count_range = o.value)';
    default:
      return '0';
  }
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
          'catalog.special_bids.view',
          'catalog.internal_listing.view',
          'catalog.external_listing.view',
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

      let queryText = `
        SELECT c.*,
          COALESCE(sq.total_sent_quotes, 0) as total_sent_quotes,
          COALESCE(so.total_accepted_orders, 0) as total_accepted_orders
        FROM clients c
        LEFT JOIN (
          SELECT q.client_id,
            SUM(
              (SELECT COALESCE(SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0)), 0)
               FROM quote_items qi WHERE qi.quote_id = q.id)
              * (1 - COALESCE(q.discount, 0) / 100.0)
            ) as total_sent_quotes
          FROM quotes q
          WHERE q.status = 'sent'
          GROUP BY q.client_id
        ) sq ON sq.client_id = c.id
        LEFT JOIN (
          SELECT s.client_id,
            SUM(
              (SELECT COALESCE(SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0)), 0)
               FROM sale_items si WHERE si.sale_id = s.id)
              * (1 - COALESCE(s.discount, 0) / 100.0)
            ) as total_accepted_orders
          FROM sales s
          WHERE s.status = 'confirmed'
          GROUP BY s.client_id
        ) so ON so.client_id = c.id
        ORDER BY c.name
      `;

      const queryParams: (string | null)[] = [];

      if (!canViewAllClients) {
        queryText = `
          SELECT c.id, c.name, c.description, c.is_disabled, c.type,
            c.contacts, c.contact_name, c.client_code, c.email, c.phone, c.address,
            c.address_country, c.address_state, c.address_cap, c.address_province,
            c.address_civic_number, c.address_line,
            c.ateco_code, c.website, c.sector, c.number_of_employees,
            c.revenue, c.fiscal_code, c.office_count_range, c.created_at,
            NULL::numeric as total_sent_quotes,
            NULL::numeric as total_accepted_orders
          FROM clients c
          INNER JOIN user_clients uc ON c.id = uc.client_id
          WHERE uc.user_id = $1
          ORDER BY c.name
        `;
        queryParams.push(request.user.id);
      }

      const result = await query(queryText, queryParams);
      return result.rows.map((row) => {
        if (!canViewClientDetails) {
          return {
            id: row.id,
            name: row.name,
            description: null,
          };
        }

        return mapClientRow(row);
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

      const addressResult = toOptionalTrimmedString(address, 'address');
      if (!addressResult.ok) return badRequest(reply, addressResult.message);
      const addressCountryResult = toOptionalTrimmedString(addressCountry, 'addressCountry');
      if (!addressCountryResult.ok) return badRequest(reply, addressCountryResult.message);
      const addressStateResult = toOptionalTrimmedString(addressState, 'addressState');
      if (!addressStateResult.ok) return badRequest(reply, addressStateResult.message);
      const addressCapResult = toOptionalTrimmedString(addressCap, 'addressCap');
      if (!addressCapResult.ok) return badRequest(reply, addressCapResult.message);
      const addressProvinceResult = toOptionalTrimmedString(addressProvince, 'addressProvince');
      if (!addressProvinceResult.ok) return badRequest(reply, addressProvinceResult.message);
      const addressCivicNumberResult = toOptionalTrimmedString(
        addressCivicNumber,
        'addressCivicNumber',
      );
      if (!addressCivicNumberResult.ok) return badRequest(reply, addressCivicNumberResult.message);
      const addressLineResult = toOptionalTrimmedString(addressLine, 'addressLine');
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

      const existingFiscalCode = await query(
        'SELECT id FROM clients WHERE LOWER(fiscal_code) = LOWER($1)',
        [resolvedFiscalCode],
      );
      if (existingFiscalCode.rows.length > 0) {
        return badRequest(reply, 'Fiscal code already exists');
      }

      if (clientCodeResult.value) {
        const existingCode = await query('SELECT id FROM clients WHERE client_code = $1', [
          clientCodeResult.value,
        ]);
        if (existingCode.rows.length > 0) {
          return badRequest(reply, 'Client ID already exists');
        }
      }

      const id = 'c-' + Date.now();
      const contactsValue = contactsResult.value;
      const primaryFromContacts = buildPrimaryFieldsFromContacts(contactsValue);

      try {
        const created = await query(
          `
            INSERT INTO clients (
                id, name, is_disabled, type, contacts, contact_name, client_code,
                email, phone, address, address_country, address_state, address_cap,
                address_province, address_civic_number, address_line,
                description, ateco_code, website, sector,
                number_of_employees, revenue, fiscal_code, office_count_range
            ) VALUES (
                $1, $2, $3, $4, $5::jsonb, $6, $7,
                $8, $9, $10, $11, $12, $13,
                $14, $15, $16,
                $17, $18, $19, $20,
                $21, $22, $23, $24
            )
            RETURNING *
          `,
          [
            id,
            nameResult.value,
            false,
            type || 'company',
            JSON.stringify(contactsValue),
            explicitContactNameResult.value ?? primaryFromContacts.contactName,
            clientCodeResult.value,
            explicitEmailResult.value ?? primaryFromContacts.email,
            explicitPhoneResult.value ?? primaryFromContacts.phone,
            addressResult.value,
            addressCountryResult.value,
            addressStateResult.value,
            addressCapResult.value,
            addressProvinceResult.value,
            addressCivicNumberResult.value,
            addressLineResult.value,
            descriptionResult.value,
            atecoCodeResult.value,
            websiteResult.value,
            sectorResult.value,
            numberOfEmployeesResult.value,
            revenueResult.value,
            resolvedFiscalCode,
            officeCountRangeResult.value,
          ],
        );

        const c = created.rows[0];

        if (request.user?.id) {
          await assignClientToUser(request.user.id, id);
        }
        await assignClientToTopManagers(id);
        await logAudit({
          request,
          action: 'client.created',
          entityType: 'client',
          entityId: id,
          details: {
            targetLabel: c.name as string,
            secondaryLabel: (c.client_code as string | null) ?? undefined,
          },
        });
        return reply.code(201).send(mapClientRow(c));
      } catch (err) {
        const error = err as DatabaseError;
        if (error.code === '23505') {
          if (error.constraint === 'idx_clients_fiscal_code_unique') {
            return badRequest(reply, 'Fiscal code already exists');
          }
          if (error.constraint === 'idx_clients_client_code_unique') {
            return badRequest(reply, 'Client ID already exists');
          }
          if (error.detail?.includes('client_code')) {
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

      const phoneResult = optionalNonEmptyString(body.phone, 'phone');
      if (!phoneResult.ok) return badRequest(reply, phoneResult.message);

      const contactNameResult = optionalNonEmptyString(body.contactName, 'contactName');
      if (!contactNameResult.ok) return badRequest(reply, contactNameResult.message);

      const addressResult = optionalNonEmptyString(body.address, 'address');
      if (!addressResult.ok) return badRequest(reply, addressResult.message);

      const addressCountryResult = optionalNonEmptyString(body.addressCountry, 'addressCountry');
      if (!addressCountryResult.ok) return badRequest(reply, addressCountryResult.message);

      const addressStateResult = optionalNonEmptyString(body.addressState, 'addressState');
      if (!addressStateResult.ok) return badRequest(reply, addressStateResult.message);

      const addressCapResult = optionalNonEmptyString(body.addressCap, 'addressCap');
      if (!addressCapResult.ok) return badRequest(reply, addressCapResult.message);

      const addressProvinceResult = optionalNonEmptyString(body.addressProvince, 'addressProvince');
      if (!addressProvinceResult.ok) return badRequest(reply, addressProvinceResult.message);

      const addressCivicNumberResult = optionalNonEmptyString(
        body.addressCivicNumber,
        'addressCivicNumber',
      );
      if (!addressCivicNumberResult.ok) return badRequest(reply, addressCivicNumberResult.message);

      const addressLineResult = optionalNonEmptyString(body.addressLine, 'addressLine');
      if (!addressLineResult.ok) return badRequest(reply, addressLineResult.message);

      const descriptionResult = optionalNonEmptyString(body.description, 'description');
      if (!descriptionResult.ok) return badRequest(reply, descriptionResult.message);

      const atecoCodeResult = optionalNonEmptyString(body.atecoCode, 'atecoCode');
      if (!atecoCodeResult.ok) return badRequest(reply, atecoCodeResult.message);

      const websiteResult = optionalNonEmptyString(body.website, 'website');
      if (!websiteResult.ok) return badRequest(reply, websiteResult.message);

      const sectorResult = optionalNonEmptyString(body.sector, 'sector');
      if (!sectorResult.ok) return badRequest(reply, sectorResult.message);

      const numberOfEmployeesResult = optionalNonEmptyString(
        body.numberOfEmployees,
        'numberOfEmployees',
      );
      if (!numberOfEmployeesResult.ok) return badRequest(reply, numberOfEmployeesResult.message);

      const revenueResult = optionalNonEmptyString(body.revenue, 'revenue');
      if (!revenueResult.ok) return badRequest(reply, revenueResult.message);

      const officeCountRangeResult = optionalNonEmptyString(
        body.officeCountRange,
        'officeCountRange',
      );
      if (!officeCountRangeResult.ok) return badRequest(reply, officeCountRangeResult.message);

      if (resolvedFiscalCode) {
        const existingFiscalCode = await query(
          'SELECT id FROM clients WHERE LOWER(fiscal_code) = LOWER($1) AND id <> $2',
          [resolvedFiscalCode, idResult.value],
        );
        if (existingFiscalCode.rows.length > 0) {
          return badRequest(reply, 'Fiscal code already exists');
        }
      }

      if (clientCodeValue) {
        const existingCode = await query(
          'SELECT id FROM clients WHERE client_code = $1 AND id <> $2',
          [clientCodeValue, idResult.value],
        );
        if (existingCode.rows.length > 0) {
          return badRequest(reply, 'Client ID already exists');
        }
      }

      const currentResult = await query(
        'SELECT contacts, contact_name, email, phone FROM clients WHERE id = $1',
        [idResult.value],
      );
      if (currentResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Client not found' });
      }

      const currentContacts = parseContactsFromDb(currentResult.rows[0].contacts);
      const effectiveContacts = hasContacts ? contactsResult.value : currentContacts;
      const primaryFromContacts = buildPrimaryFieldsFromContacts(effectiveContacts);

      const finalContactName = hasContactName
        ? contactNameResult.value
        : hasContacts
          ? primaryFromContacts.contactName
          : null;
      const finalEmail = hasEmail
        ? emailResult.value
        : hasContacts
          ? primaryFromContacts.email
          : null;
      const finalPhone = hasPhone
        ? phoneResult.value
        : hasContacts
          ? primaryFromContacts.phone
          : null;
      const shouldUpdateContactName = hasContactName || hasContacts;
      const shouldUpdateEmail = hasEmail || hasContacts;
      const shouldUpdatePhone = hasPhone || hasContacts;

      try {
        const result = await query(
          `
            UPDATE clients SET
                name = COALESCE($1, name),
                is_disabled = COALESCE($2, is_disabled),
                type = COALESCE($3, type),
                contacts = COALESCE($4::jsonb, contacts),
                contact_name = CASE WHEN $25 THEN $5 ELSE contact_name END,
                client_code = COALESCE($6, client_code),
                email = CASE WHEN $26 THEN $7 ELSE email END,
                phone = CASE WHEN $27 THEN $8 ELSE phone END,
                address = COALESCE($9, address),
                address_country = COALESCE($10, address_country),
                address_state = COALESCE($11, address_state),
                address_cap = COALESCE($12, address_cap),
                address_province = COALESCE($13, address_province),
                address_civic_number = COALESCE($14, address_civic_number),
                address_line = COALESCE($15, address_line),
                description = COALESCE($16, description),
                ateco_code = COALESCE($17, ateco_code),
                website = COALESCE($18, website),
                sector = CASE WHEN $28 THEN $19 ELSE sector END,
                number_of_employees = CASE WHEN $29 THEN $20 ELSE number_of_employees END,
                revenue = CASE WHEN $30 THEN $21 ELSE revenue END,
                fiscal_code = COALESCE($22, fiscal_code),
                office_count_range = CASE WHEN $31 THEN $23 ELSE office_count_range END
            WHERE id = $24
            RETURNING *
          `,
          [
            hasName ? nameValue : null,
            hasIsDisabled ? body.isDisabled : null,
            hasType ? body.type : null,
            hasContacts ? JSON.stringify(effectiveContacts) : null,
            finalContactName,
            hasClientCode ? clientCodeValue : null,
            finalEmail,
            finalPhone,
            hasAddress ? addressResult.value : null,
            hasAddressCountry ? addressCountryResult.value : null,
            hasAddressState ? addressStateResult.value : null,
            hasAddressCap ? addressCapResult.value : null,
            hasAddressProvince ? addressProvinceResult.value : null,
            hasAddressCivicNumber ? addressCivicNumberResult.value : null,
            hasAddressLine ? addressLineResult.value : null,
            hasDescription ? descriptionResult.value : null,
            hasAtecoCode ? atecoCodeResult.value : null,
            hasWebsite ? websiteResult.value : null,
            hasSector ? sectorResult.value : null,
            hasNumberOfEmployees ? numberOfEmployeesResult.value : null,
            hasRevenue ? revenueResult.value : null,
            hasFiscalUpdate ? resolvedFiscalCode : null,
            hasOfficeCountRange ? officeCountRangeResult.value : null,
            idResult.value,
            shouldUpdateContactName,
            shouldUpdateEmail,
            shouldUpdatePhone,
            hasSector,
            hasNumberOfEmployees,
            hasRevenue,
            hasOfficeCountRange,
          ],
        );

        const c = result.rows[0];
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
            targetLabel: c.name as string,
            secondaryLabel: (c.client_code as string | null) ?? undefined,
          },
        });
        return mapClientRow(c);
      } catch (err) {
        const error = err as DatabaseError;
        if (error.code === '23505') {
          if (error.constraint === 'idx_clients_fiscal_code_unique') {
            return badRequest(reply, 'Fiscal code already exists');
          }
          if (error.constraint === 'idx_clients_client_code_unique') {
            return badRequest(reply, 'Client ID already exists');
          }
          if (error.detail?.includes('client_code')) {
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

      const result = await query(
        'DELETE FROM clients WHERE id = $1 RETURNING id, name, client_code',
        [idResult.value],
      );
      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Client not found' });
      }

      await logAudit({
        request,
        action: 'client.deleted',
        entityType: 'client',
        entityId: idResult.value,
        details: {
          targetLabel: result.rows[0].name as string,
          secondaryLabel: (result.rows[0].client_code as string | null) ?? undefined,
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

      const usageCountExpr = getUsageCountExpression(categoryResult.value);
      const result = await query(
        `SELECT
           o.id,
           o.category,
           o.value,
           o.sort_order,
           o.created_at,
           o.updated_at,
           ${usageCountExpr} as usage_count
         FROM client_profile_options o
         WHERE o.category = $1
         ORDER BY o.sort_order ASC, o.value ASC`,
        [categoryResult.value],
      );

      return result.rows.map(mapProfileOptionRow);
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
      const existing = await query(
        'SELECT id FROM client_profile_options WHERE category = $1 AND LOWER(value) = LOWER($2)',
        [categoryResult.value, valueResult.value],
      );
      if (existing.rows.length > 0) {
        return badRequest(reply, 'Option with this value already exists for this category');
      }

      const computedSortOrderResult = await query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort_order FROM client_profile_options WHERE category = $1',
        [categoryResult.value],
      );
      const nextSortOrder = Number(computedSortOrderResult.rows[0]?.next_sort_order ?? 1);
      const id = `cpo-${crypto.randomUUID()}`;

      const insertResult = await query(
        `INSERT INTO client_profile_options (id, category, value, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING id, category, value, sort_order, created_at, updated_at`,
        [id, categoryResult.value, valueResult.value, sortOrderValue ?? nextSortOrder],
      );

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

      return reply.code(201).send(mapProfileOptionRow({ ...insertResult.rows[0], usage_count: 0 }));
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

      const existingResult = await query(
        'SELECT id, value FROM client_profile_options WHERE id = $1 AND category = $2',
        [idResult.value, categoryResult.value],
      );
      if (existingResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Profile option not found' });
      }

      const duplicateResult = await query(
        `SELECT id
         FROM client_profile_options
         WHERE category = $1 AND LOWER(value) = LOWER($2) AND id <> $3`,
        [categoryResult.value, valueResult.value, idResult.value],
      );
      if (duplicateResult.rows.length > 0) {
        return badRequest(reply, 'Option with this value already exists for this category');
      }

      const sortOrderValue = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : null;
      await query(
        `UPDATE client_profile_options
         SET value = $1,
             sort_order = COALESCE($2, sort_order),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND category = $4`,
        [valueResult.value, sortOrderValue, idResult.value, categoryResult.value],
      );

      const valueFieldByCategory: Record<ProfileOptionCategory, string> = {
        sector: 'sector',
        numberOfEmployees: 'number_of_employees',
        revenue: 'revenue',
        officeCountRange: 'office_count_range',
      };

      const previousValue = String(existingResult.rows[0].value);
      if (previousValue !== valueResult.value) {
        const fieldName = valueFieldByCategory[categoryResult.value];
        await query(
          `UPDATE clients
           SET ${fieldName} = $1
           WHERE ${fieldName} = $2`,
          [valueResult.value, previousValue],
        );
      }

      const usageCountExpr = getUsageCountExpression(categoryResult.value);
      const updatedResult = await query(
        `SELECT
           o.id,
           o.category,
           o.value,
           o.sort_order,
           o.created_at,
           o.updated_at,
           ${usageCountExpr} as usage_count
         FROM client_profile_options o
         WHERE o.id = $1`,
        [idResult.value],
      );

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

      return mapProfileOptionRow(updatedResult.rows[0]);
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

      const existingResult = await query(
        'SELECT id, category, value FROM client_profile_options WHERE id = $1 AND category = $2',
        [idResult.value, categoryResult.value],
      );
      if (existingResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Profile option not found' });
      }

      const usageCountExpr = getUsageCountExpression(categoryResult.value);
      const usageResult = await query(
        `SELECT ${usageCountExpr} as usage_count
         FROM client_profile_options o
         WHERE o.id = $1`,
        [idResult.value],
      );
      const usageCount = Number(usageResult.rows[0]?.usage_count ?? 0);
      if (usageCount > 0) {
        return reply.code(409).send({
          error: `Cannot delete option "${existingResult.rows[0].value}" because it is used by ${usageCount} client(s)`,
        });
      }

      await query('DELETE FROM client_profile_options WHERE id = $1', [idResult.value]);

      await logAudit({
        request,
        action: 'client.profile_option.deleted',
        entityType: 'client_profile_option',
        entityId: idResult.value,
        details: {
          targetLabel: String(existingResult.rows[0].value),
          secondaryLabel: categoryResult.value,
        },
      });

      return { message: 'Profile option deleted' };
    },
  );
}
