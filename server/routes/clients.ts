import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import { messageResponseSchema, standardErrorResponses } from '../schemas/common.ts';
import {
  bumpNamespaceVersion,
  cacheGetSetJson,
  setCacheHeader,
  shouldBypassCache,
  TTL_LIST_SECONDS,
} from '../services/cache.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import {
  badRequest,
  optionalEmail,
  optionalNonEmptyString,
  requireNonEmptyString,
  validateClientIdentifier,
} from '../utils/validation.ts';

const OFFICE_COUNT_RANGE_VALUES = ['1', '2...5', '6...10', '>10'] as const;
const OFFICE_COUNT_RANGE_SET = new Set<string>(OFFICE_COUNT_RANGE_VALUES);
const SECTOR_VALUES = [
  'FINANCE',
  'TELCO',
  'UTILITIES',
  'ENERGY',
  'SERVICES',
  'GDO',
  'HEALTH',
  'INDUSTRY',
  'PA',
  'TRASPORTI',
  'ALTRO',
] as const;
const SECTOR_SET = new Set<string>(SECTOR_VALUES);
const NUMBER_OF_EMPLOYEES_VALUES = ['< 50', '50..250', '251..1000', '> 1000'] as const;
const NUMBER_OF_EMPLOYEES_SET = new Set<string>(NUMBER_OF_EMPLOYEES_VALUES);
const REVENUE_VALUES = ['< 10', '11..50', '51..1000', '> 1000'] as const;
const REVENUE_SET = new Set<string>(REVENUE_VALUES);

type OfficeCountRange = (typeof OFFICE_COUNT_RANGE_VALUES)[number];
type Sector = (typeof SECTOR_VALUES)[number];
type NumberOfEmployees = (typeof NUMBER_OF_EMPLOYEES_VALUES)[number];
type Revenue = (typeof REVENUE_VALUES)[number];

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const clientSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    isDisabled: { type: 'boolean' },
    type: { type: 'string' },
    contactName: { type: ['string', 'null'] },
    clientCode: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    address: { type: ['string', 'null'] },
    atecoCode: { type: ['string', 'null'] },
    website: { type: ['string', 'null'] },
    sector: { type: ['string', 'null'] },
    numberOfEmployees: { type: ['string', 'null'] },
    revenue: { type: ['string', 'null'] },
    fiscalCode: { type: ['string', 'null'] },
    officeCountRange: { type: ['string', 'null'] },
    vatNumber: { type: ['string', 'null'] },
    taxCode: { type: ['string', 'null'] },
    billingCode: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
  },
  required: ['id', 'name'],
} as const;

const clientCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string' },
    contactName: { type: 'string' },
    clientCode: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    address: { type: 'string' },
    description: { type: 'string' },
    atecoCode: { type: 'string' },
    website: { type: 'string' },
    sector: { type: 'string', enum: SECTOR_VALUES },
    numberOfEmployees: { type: 'string', enum: NUMBER_OF_EMPLOYEES_VALUES },
    revenue: { type: 'string', enum: REVENUE_VALUES },
    fiscalCode: { type: 'string' },
    officeCountRange: { type: 'string' },
    vatNumber: { type: 'string' },
    taxCode: { type: 'string' },
    billingCode: { type: 'string' },
  },
  required: ['name'],
} as const;

const clientUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: ['string', 'null'] },
    isDisabled: { type: 'boolean' },
    type: { type: ['string', 'null'] },
    contactName: { type: ['string', 'null'] },
    clientCode: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    address: { type: ['string', 'null'] },
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
    billingCode: { type: ['string', 'null'] },
  },
} as const;

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

const hasPermission = (request: FastifyRequest, permission: string) =>
  request.user?.permissions?.includes(permission) ?? false;

const parseRequiredOfficeCountRange = (
  value: unknown,
): { ok: true; value: OfficeCountRange } | { ok: false; message: string } => {
  const result = requireNonEmptyString(value, 'officeCountRange');
  if (!result.ok) return result;
  if (!OFFICE_COUNT_RANGE_SET.has(result.value)) {
    return {
      ok: false,
      message: `officeCountRange must be one of: ${OFFICE_COUNT_RANGE_VALUES.join(', ')}`,
    };
  }

  return { ok: true, value: result.value as OfficeCountRange };
};

const parseOptionalEnum = <T extends string>(
  value: unknown,
  fieldName: string,
  allowedSet: Set<string>,
  allowedValues: readonly T[],
): { ok: true; value: T | null } | { ok: false; message: string } => {
  const result = optionalNonEmptyString(value, fieldName);
  if (!result.ok) return result;
  if (result.value === null) return { ok: true, value: null };
  if (!allowedSet.has(result.value)) {
    return { ok: false, message: `${fieldName} must be one of: ${allowedValues.join(', ')}` };
  }
  return { ok: true, value: result.value as T };
};

const parseOptionalSector = (value: unknown) =>
  parseOptionalEnum(value, 'sector', SECTOR_SET, SECTOR_VALUES);

const parseOptionalNumberOfEmployees = (value: unknown) =>
  parseOptionalEnum(
    value,
    'numberOfEmployees',
    NUMBER_OF_EMPLOYEES_SET,
    NUMBER_OF_EMPLOYEES_VALUES,
  );

const parseOptionalRevenue = (value: unknown) =>
  parseOptionalEnum(value, 'revenue', REVENUE_SET, REVENUE_VALUES);

const resolveFiscalCode = ({
  vatNumber,
  fiscalCode,
  taxCode,
}: {
  vatNumber: string | null;
  fiscalCode: string | null;
  taxCode: string | null;
}) => vatNumber || fiscalCode || taxCode || null;

const mapClientRow = (c: Record<string, unknown>) => {
  const fiscalCode = (c.fiscal_code as string | null) || null;
  const createdAt = c.created_at ? new Date(c.created_at as string).getTime() : undefined;

  return {
    id: c.id,
    name: c.name,
    description: c.description,
    isDisabled: c.is_disabled,
    type: c.type,
    contactName: c.contact_name,
    clientCode: c.client_code,
    email: c.email,
    phone: c.phone,
    address: c.address,
    atecoCode: c.ateco_code,
    website: c.website,
    sector: c.sector,
    numberOfEmployees: c.number_of_employees,
    revenue: c.revenue,
    fiscalCode,
    officeCountRange: c.office_count_range,
    // Legacy compatibility aliases
    vatNumber: fiscalCode,
    taxCode: fiscalCode,
    billingCode: c.billing_code,
    createdAt,
  };
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List all clients
  fastify.get(
    '/',
    {
      onRequest: [
        authenticateToken,
        requireAnyPermission(
          'crm.clients.view',
          'crm.clients_all.view',
          'timesheets.tracker.view',
          'timesheets.recurring.view',
          'projects.manage.view',
          'projects.tasks.view',
          'sales.client_quotes.view',
          'accounting.clients_orders.view',
          'accounting.clients_invoices.view',
          'catalog.special_bids.view',
          'catalog.internal_listing.view',
          'catalog.external_listing.view',
          'finances.payments.view',
          'finances.expenses.view',
          'suppliers.quotes.view',
          'administration.user_management.view',
          'administration.user_management.update',
        ),
      ],
      schema: {
        tags: ['clients'],
        summary: 'List clients',
        response: {
          200: { type: 'array', items: clientSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const canViewAllClients = hasPermission(request, 'crm.clients_all.view');
      const canViewClientDetails = hasPermission(request, 'crm.clients.view');
      const scopeKey = canViewAllClients ? 'all' : `user:${request.user.id}`;
      const detailsKey = canViewClientDetails ? 'full' : 'nameOnly';
      const bypass = shouldBypassCache(request);

      const { status, value } = await cacheGetSetJson(
        'clients',
        `v=4:scope=${scopeKey}:details=${detailsKey}`,
        TTL_LIST_SECONDS,
        async () => {
          let queryText = 'SELECT * FROM clients ORDER BY name';
          const queryParams: (string | null)[] = [];

          if (!canViewAllClients) {
            queryText = `
                SELECT c.id, c.name
                FROM clients c
                INNER JOIN user_clients uc ON c.id = uc.client_id
                WHERE uc.user_id = $1
                ORDER BY c.name
            `;
            queryParams.push(request.user.id);
          }

          const result = await query(queryText, queryParams);
          return result.rows.map((c) => {
            if (!canViewClientDetails) {
              return {
                id: c.id,
                name: c.name,
                description: null,
              };
            }

            return mapClientRow(c);
          });
        },
        { bypass },
      );

      setCacheHeader(reply, status);
      return value;
    },
  );

  // POST / - Create client (manager only)
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
        contactName,
        clientCode,
        email,
        phone,
        address,
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
        billingCode,
      } = request.body as {
        name: unknown;
        type: unknown;
        contactName: unknown;
        clientCode: unknown;
        email: unknown;
        phone: unknown;
        address: unknown;
        description: unknown;
        atecoCode: unknown;
        website: unknown;
        sector: unknown;
        numberOfEmployees: unknown;
        revenue: unknown;
        fiscalCode: unknown;
        officeCountRange: unknown;
        vatNumber: unknown;
        taxCode: unknown;
        billingCode: unknown;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

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

      if (!resolvedFiscalCode) {
        return badRequest(reply, 'Fiscal code is required');
      }

      const officeCountRangeResult = parseRequiredOfficeCountRange(officeCountRange);
      if (!officeCountRangeResult.ok) {
        return badRequest(reply, officeCountRangeResult.message);
      }

      const emailResult = optionalEmail(email, 'email');
      if (!emailResult.ok) return badRequest(reply, emailResult.message);

      const descriptionResult = optionalNonEmptyString(description, 'description');
      if (!descriptionResult.ok) return badRequest(reply, descriptionResult.message);

      const atecoCodeResult = optionalNonEmptyString(atecoCode, 'atecoCode');
      if (!atecoCodeResult.ok) return badRequest(reply, atecoCodeResult.message);

      const websiteResult = optionalNonEmptyString(website, 'website');
      if (!websiteResult.ok) return badRequest(reply, websiteResult.message);

      const sectorResult = parseOptionalSector(sector);
      if (!sectorResult.ok) return badRequest(reply, sectorResult.message);

      const numberOfEmployeesResult = parseOptionalNumberOfEmployees(numberOfEmployees);
      if (!numberOfEmployeesResult.ok) return badRequest(reply, numberOfEmployeesResult.message);

      const revenueResult = parseOptionalRevenue(revenue);
      if (!revenueResult.ok) return badRequest(reply, revenueResult.message);

      // Check for existing fiscal code
      const existingFiscalCode = await query(
        'SELECT id FROM clients WHERE LOWER(fiscal_code) = LOWER($1)',
        [resolvedFiscalCode],
      );
      if (existingFiscalCode.rows.length > 0) {
        return badRequest(reply, 'Fiscal code already exists');
      }

      // Check for existing client ID
      if (clientCodeResult.value) {
        const existingCode = await query('SELECT id FROM clients WHERE client_code = $1', [
          clientCodeResult.value,
        ]);
        if (existingCode.rows.length > 0) {
          return badRequest(reply, 'Client ID already exists');
        }
      }

      const id = 'c-' + Date.now();

      try {
        const created = await query(
          `
            INSERT INTO clients (
                id, name, is_disabled, type, contact_name, client_code,
                email, phone, address, description, ateco_code, website, sector,
                number_of_employees, revenue, fiscal_code, office_count_range, billing_code
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING *
        `,
          [
            id,
            nameResult.value,
            false,
            type || 'company',
            contactName,
            clientCodeResult.value,
            emailResult.value,
            phone,
            address,
            descriptionResult.value,
            atecoCodeResult.value,
            websiteResult.value,
            sectorResult.value,
            numberOfEmployeesResult.value,
            revenueResult.value,
            resolvedFiscalCode,
            officeCountRangeResult.value,
            billingCode,
          ],
        );

        const c = created.rows[0];

        await bumpNamespaceVersion('clients');
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

  // PUT /:id - Update client (manager only)
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
      const {
        name,
        isDisabled,
        type,
        contactName,
        clientCode,
        email,
        phone,
        address,
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
        billingCode,
      } = request.body as {
        name: unknown;
        isDisabled: unknown;
        type: unknown;
        contactName: unknown;
        clientCode: unknown;
        email: unknown;
        phone: unknown;
        address: unknown;
        description: unknown;
        atecoCode: unknown;
        website: unknown;
        sector: unknown;
        numberOfEmployees: unknown;
        revenue: unknown;
        fiscalCode: unknown;
        officeCountRange: unknown;
        vatNumber: unknown;
        taxCode: unknown;
        billingCode: unknown;
      };
      const body = request.body ?? {};
      const hasName = Object.hasOwn(body, 'name');
      const hasClientCode = Object.hasOwn(body, 'clientCode');
      const hasFiscalCode = Object.hasOwn(body, 'fiscalCode');
      const hasOfficeCountRange = Object.hasOwn(body, 'officeCountRange');
      const hasDescription = Object.hasOwn(body, 'description');
      const hasAtecoCode = Object.hasOwn(body, 'atecoCode');
      const hasWebsite = Object.hasOwn(body, 'website');
      const hasSector = Object.hasOwn(body, 'sector');
      const hasNumberOfEmployees = Object.hasOwn(body, 'numberOfEmployees');
      const hasRevenue = Object.hasOwn(body, 'revenue');
      const hasVatNumber = Object.hasOwn(body, 'vatNumber');
      const hasTaxCode = Object.hasOwn(body, 'taxCode');
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      let nameValue: string | null = null;
      if (hasName) {
        const nameResult = requireNonEmptyString(name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);
        nameValue = nameResult.value;
      }

      let clientCodeValue: string | null = null;
      if (hasClientCode) {
        const clientCodeResult = validateClientIdentifier(clientCode, 'clientCode');
        if (!clientCodeResult.ok) return badRequest(reply, clientCodeResult.message);
        clientCodeValue = clientCodeResult.value;
      }

      let fiscalCodeValue: string | null = null;
      if (hasFiscalCode) {
        const fiscalCodeResult = optionalNonEmptyString(fiscalCode, 'fiscalCode');
        if (!fiscalCodeResult.ok) return badRequest(reply, fiscalCodeResult.message);
        fiscalCodeValue = fiscalCodeResult.value;
      }

      let vatNumberValue: string | null = null;
      if (hasVatNumber) {
        const vatNumberResult = optionalNonEmptyString(vatNumber, 'vatNumber');
        if (!vatNumberResult.ok) return badRequest(reply, vatNumberResult.message);
        vatNumberValue = vatNumberResult.value;
      }

      let taxCodeValue: string | null = null;
      if (hasTaxCode) {
        const taxCodeResult = optionalNonEmptyString(taxCode, 'taxCode');
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

      let officeCountRangeValue: OfficeCountRange | null = null;
      if (hasOfficeCountRange) {
        const officeCountRangeResult = parseRequiredOfficeCountRange(officeCountRange);
        if (!officeCountRangeResult.ok) return badRequest(reply, officeCountRangeResult.message);
        officeCountRangeValue = officeCountRangeResult.value;
      }

      const emailResult = optionalEmail(email, 'email');
      if (!emailResult.ok) return badRequest(reply, emailResult.message);

      let descriptionValue: string | null = null;
      if (hasDescription) {
        const descriptionResult = optionalNonEmptyString(description, 'description');
        if (!descriptionResult.ok) return badRequest(reply, descriptionResult.message);
        descriptionValue = descriptionResult.value;
      }

      let atecoCodeValue: string | null = null;
      if (hasAtecoCode) {
        const atecoCodeResult = optionalNonEmptyString(atecoCode, 'atecoCode');
        if (!atecoCodeResult.ok) return badRequest(reply, atecoCodeResult.message);
        atecoCodeValue = atecoCodeResult.value;
      }

      let websiteValue: string | null = null;
      if (hasWebsite) {
        const websiteResult = optionalNonEmptyString(website, 'website');
        if (!websiteResult.ok) return badRequest(reply, websiteResult.message);
        websiteValue = websiteResult.value;
      }

      let sectorValue: Sector | null = null;
      if (hasSector) {
        const sectorResult = parseOptionalSector(sector);
        if (!sectorResult.ok) return badRequest(reply, sectorResult.message);
        sectorValue = sectorResult.value;
      }

      let numberOfEmployeesValue: NumberOfEmployees | null = null;
      if (hasNumberOfEmployees) {
        const numberOfEmployeesResult = parseOptionalNumberOfEmployees(numberOfEmployees);
        if (!numberOfEmployeesResult.ok) return badRequest(reply, numberOfEmployeesResult.message);
        numberOfEmployeesValue = numberOfEmployeesResult.value;
      }

      let revenueValue: Revenue | null = null;
      if (hasRevenue) {
        const revenueResult = parseOptionalRevenue(revenue);
        if (!revenueResult.ok) return badRequest(reply, revenueResult.message);
        revenueValue = revenueResult.value;
      }

      // Check for existing fiscal code on other clients
      if (resolvedFiscalCode) {
        const existingFiscalCode = await query(
          'SELECT id FROM clients WHERE LOWER(fiscal_code) = LOWER($1) AND id <> $2',
          [resolvedFiscalCode, idResult.value],
        );
        if (existingFiscalCode.rows.length > 0) {
          return badRequest(reply, 'Fiscal code already exists');
        }
      }

      // Check for existing client ID on other clients
      if (clientCodeValue) {
        const existingCode = await query(
          'SELECT id FROM clients WHERE client_code = $1 AND id <> $2',
          [clientCodeValue, idResult.value],
        );
        if (existingCode.rows.length > 0) {
          return badRequest(reply, 'Client ID already exists');
        }
      }

      try {
        const result = await query(
          `
            UPDATE clients SET 
                name = COALESCE($1, name), 
                is_disabled = COALESCE($2, is_disabled),
                type = COALESCE($3, type),
                contact_name = COALESCE($4, contact_name),
                client_code = COALESCE($5, client_code),
                email = COALESCE($6, email),
                phone = COALESCE($7, phone),
                address = COALESCE($8, address),
                description = COALESCE($9, description),
                ateco_code = COALESCE($10, ateco_code),
                website = COALESCE($11, website),
                sector = COALESCE($12, sector),
                number_of_employees = COALESCE($13, number_of_employees),
                revenue = COALESCE($14, revenue),
                fiscal_code = COALESCE($15, fiscal_code),
                office_count_range = COALESCE($16, office_count_range),
                billing_code = COALESCE($17, billing_code)
            WHERE id = $18
            RETURNING *
        `,
          [
            nameValue,
            isDisabled,
            type,
            contactName,
            clientCodeValue,
            emailResult.value,
            phone,
            address,
            descriptionValue,
            atecoCodeValue,
            websiteValue,
            sectorValue,
            numberOfEmployeesValue,
            revenueValue,
            resolvedFiscalCode,
            officeCountRangeValue,
            billingCode,
            idResult.value,
          ],
        );

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Client not found' });
        }

        const c = result.rows[0];

        await bumpNamespaceVersion('clients');
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

  // DELETE /:id - Delete client (manager only)
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
      const result = await query('DELETE FROM clients WHERE id = $1 RETURNING id', [
        idResult.value,
      ]);
      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Client not found' });
      }

      await bumpNamespaceVersion('clients');
      return { message: 'Client deleted' };
    },
  );
}
