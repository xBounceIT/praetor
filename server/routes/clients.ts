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
    vatNumber: { type: ['string', 'null'] },
    taxCode: { type: ['string', 'null'] },
    billingCode: { type: ['string', 'null'] },
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
    vatNumber: { type: 'string' },
    taxCode: { type: 'string' },
    billingCode: { type: 'string' },
  },
  required: ['name'],
} as const;

const clientUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    isDisabled: { type: 'boolean' },
    type: { type: 'string' },
    contactName: { type: 'string' },
    clientCode: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    address: { type: 'string' },
    vatNumber: { type: 'string' },
    taxCode: { type: 'string' },
    billingCode: { type: 'string' },
  },
} as const;

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

const hasPermission = (request: FastifyRequest, permission: string) =>
  request.user?.permissions?.includes(permission) ?? false;

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
        `v=1:scope=${scopeKey}:details=${detailsKey}`,
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

            return {
              id: c.id,
              name: c.name,
              isDisabled: c.is_disabled,
              type: c.type,
              contactName: c.contact_name,
              clientCode: c.client_code,
              email: c.email,
              phone: c.phone,
              address: c.address,
              vatNumber: c.vat_number,
              taxCode: c.tax_code,
              billingCode: c.billing_code,
            };
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
        vatNumber: unknown;
        taxCode: unknown;
        billingCode: unknown;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const clientCodeResult = validateClientIdentifier(clientCode, 'clientCode');
      if (!clientCodeResult.ok) return badRequest(reply, clientCodeResult.message);

      const vatNumberResult = optionalNonEmptyString(vatNumber, 'vatNumber');
      if (!vatNumberResult.ok) return badRequest(reply, vatNumberResult.message);

      const taxCodeResult = optionalNonEmptyString(taxCode, 'taxCode');
      if (!taxCodeResult.ok) return badRequest(reply, taxCodeResult.message);

      if (!vatNumberResult.value && !taxCodeResult.value) {
        return badRequest(reply, 'Either VAT Number or Fiscal Code is required');
      }

      const emailResult = optionalEmail(email, 'email');
      if (!emailResult.ok) return badRequest(reply, emailResult.message);

      // Check for existing VAT number
      if (vatNumberResult.value) {
        const existingVat = await query(
          'SELECT id FROM clients WHERE LOWER(vat_number) = LOWER($1)',
          [vatNumberResult.value],
        );
        if (existingVat.rows.length > 0) {
          return badRequest(reply, 'VAT number already exists');
        }
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
        await query(
          `
            INSERT INTO clients (
                id, name, is_disabled, type, contact_name, client_code,
                email, phone, address, vat_number, tax_code, billing_code
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
            vatNumberResult.value,
            taxCodeResult.value,
            billingCode,
          ],
        );

        await bumpNamespaceVersion('clients');
        return reply.code(201).send({
          id,
          name: nameResult.value,
          isDisabled: false,
          type,
          contactName,
          clientCode: clientCodeResult.value,
          email: emailResult.value,
          phone,
          address,
          vatNumber: vatNumberResult.value,
          taxCode: taxCodeResult.value,
          billingCode,
        });
      } catch (err) {
        const error = err as DatabaseError;
        if (error.code === '23505') {
          // Unique violation
          if (error.constraint === 'idx_clients_vat_number_unique') {
            return badRequest(reply, 'VAT number already exists');
          }
          if (error.constraint === 'idx_clients_client_code_unique') {
            return badRequest(reply, 'Client ID already exists');
          }
          // Fallback or generic unique error
          if (error.detail?.includes('client_code')) {
            return badRequest(reply, 'Client ID already exists');
          }
          return badRequest(reply, 'VAT number already exists');
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
        vatNumber: unknown;
        taxCode: unknown;
        billingCode: unknown;
      };
      const body = request.body ?? {};
      const hasName = Object.hasOwn(body, 'name');
      const hasClientCode = Object.hasOwn(body, 'clientCode');
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

      if ((hasVatNumber || hasTaxCode) && !vatNumberValue && !taxCodeValue) {
        return badRequest(reply, 'Either VAT Number or Fiscal Code is required');
      }

      const emailResult = optionalEmail(email, 'email');
      if (!emailResult.ok) return badRequest(reply, emailResult.message);

      // Check for existing VAT number on other clients
      if (vatNumberValue) {
        const existingVat = await query(
          'SELECT id FROM clients WHERE LOWER(vat_number) = LOWER($1) AND id <> $2',
          [vatNumberValue, idResult.value],
        );
        if (existingVat.rows.length > 0) {
          return badRequest(reply, 'VAT number already exists');
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
                vat_number = COALESCE($9, vat_number),
                tax_code = COALESCE($10, tax_code),
                billing_code = COALESCE($11, billing_code)
            WHERE id = $12 
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
            vatNumberValue,
            taxCodeValue,
            billingCode,
            idResult.value,
          ],
        );

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Client not found' });
        }

        const c = result.rows[0];

        await bumpNamespaceVersion('clients');
        return {
          id: c.id,
          name: c.name,
          isDisabled: c.is_disabled,
          type: c.type,
          contactName: c.contact_name,
          clientCode: c.client_code,
          email: c.email,
          phone: c.phone,
          address: c.address,
          vatNumber: c.vat_number,
          taxCode: c.tax_code,
          billingCode: c.billing_code,
        };
      } catch (err) {
        const error = err as DatabaseError;
        if (error.code === '23505') {
          // Unique violation
          if (error.constraint === 'idx_clients_vat_number_unique') {
            return badRequest(reply, 'VAT number already exists');
          }
          if (error.constraint === 'idx_clients_client_code_unique') {
            return badRequest(reply, 'Client ID already exists');
          }
          if (error.detail?.includes('client_code')) {
            return badRequest(reply, 'Client ID already exists');
          }
          return badRequest(reply, 'VAT number already exists');
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
