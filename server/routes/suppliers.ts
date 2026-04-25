import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  badRequest,
  optionalEmail,
  optionalNonEmptyString,
  parseBoolean,
  requireNonEmptyString,
} from '../utils/validation.ts';

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const supplierSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    isDisabled: { type: 'boolean' },
    supplierCode: { type: ['string', 'null'] },
    contactName: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    address: { type: ['string', 'null'] },
    vatNumber: { type: ['string', 'null'] },
    taxCode: { type: ['string', 'null'] },
    paymentTerms: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
  },
  required: ['id', 'name', 'isDisabled'],
} as const;

const supplierCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    supplierCode: { type: 'string' },
    contactName: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    address: { type: 'string' },
    vatNumber: { type: 'string' },
    taxCode: { type: 'string' },
    paymentTerms: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['name', 'vatNumber'],
} as const;

const supplierUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    isDisabled: { type: 'boolean' },
    supplierCode: { type: 'string' },
    contactName: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    address: { type: 'string' },
    vatNumber: { type: 'string' },
    taxCode: { type: 'string' },
    paymentTerms: { type: 'string' },
    notes: { type: 'string' },
  },
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requireAnyPermission(
          'crm.suppliers.view',
          'crm.suppliers_all.view',
          'sales.supplier_quotes.view',
          'accounting.supplier_orders.view',
          'accounting.supplier_invoices.view',
        ),
      ],
      schema: {
        tags: ['suppliers'],
        summary: 'List suppliers',
        response: {
          200: { type: 'array', items: supplierSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => {
      const result = await query('SELECT * FROM suppliers ORDER BY name');
      return result.rows.map((s) => ({
        id: s.id,
        name: s.name,
        isDisabled: s.is_disabled,
        supplierCode: s.supplier_code,
        contactName: s.contact_name,
        email: s.email,
        phone: s.phone,
        address: s.address,
        vatNumber: s.vat_number,
        taxCode: s.tax_code,
        paymentTerms: s.payment_terms,
        notes: s.notes,
        createdAt: s.created_at ? new Date(s.created_at).getTime() : undefined,
      }));
    },
  );

  fastify.post(
    '/',
    {
      onRequest: [requirePermission('crm.suppliers.create')],
      schema: {
        tags: ['suppliers'],
        summary: 'Create supplier',
        body: supplierCreateBodySchema,
        response: {
          201: supplierSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        name,
        supplierCode,
        contactName,
        email,
        phone,
        address,
        vatNumber,
        taxCode,
        paymentTerms,
        notes,
      } = request.body as {
        name?: string;
        supplierCode?: string;
        contactName?: string;
        email?: string;
        phone?: string;
        address?: string;
        vatNumber?: string;
        taxCode?: string;
        paymentTerms?: string;
        notes?: string;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const emailResult = optionalEmail(email, 'email');
      if (!emailResult.ok) return badRequest(reply, emailResult.message);

      const supplierCodeResult = optionalNonEmptyString(supplierCode, 'supplierCode');
      if (!supplierCodeResult.ok) return badRequest(reply, supplierCodeResult.message);

      const contactNameResult = optionalNonEmptyString(contactName, 'contactName');
      if (!contactNameResult.ok) return badRequest(reply, contactNameResult.message);

      const phoneResult = optionalNonEmptyString(phone, 'phone');
      if (!phoneResult.ok) return badRequest(reply, phoneResult.message);

      const addressResult = optionalNonEmptyString(address, 'address');
      if (!addressResult.ok) return badRequest(reply, addressResult.message);

      const vatNumberResult = requireNonEmptyString(vatNumber, 'vatNumber');
      if (!vatNumberResult.ok) return badRequest(reply, vatNumberResult.message);

      const taxCodeResult = optionalNonEmptyString(taxCode, 'taxCode');
      if (!taxCodeResult.ok) return badRequest(reply, taxCodeResult.message);

      const paymentTermsResult = optionalNonEmptyString(paymentTerms, 'paymentTerms');
      if (!paymentTermsResult.ok) return badRequest(reply, paymentTermsResult.message);

      const notesResult = optionalNonEmptyString(notes, 'notes');
      if (!notesResult.ok) return badRequest(reply, notesResult.message);

      const now = Date.now();
      const id = 's-' + now;
      await query(
        `INSERT INTO suppliers (
        id, name, is_disabled, supplier_code, contact_name, email, phone,
        address, vat_number, tax_code, payment_terms, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, to_timestamp($13 / 1000.0))`,
        [
          id,
          nameResult.value,
          false,
          supplierCodeResult.value,
          contactNameResult.value,
          emailResult.value,
          phoneResult.value,
          addressResult.value,
          vatNumberResult.value,
          taxCodeResult.value,
          paymentTermsResult.value,
          notesResult.value,
          now,
        ],
      );

      await logAudit({
        request,
        action: 'supplier.created',
        entityType: 'supplier',
        entityId: id,
        details: {
          targetLabel: nameResult.value,
          secondaryLabel: supplierCodeResult.value ?? undefined,
        },
      });
      return reply.code(201).send({
        id,
        name: nameResult.value,
        isDisabled: false,
        supplierCode: supplierCodeResult.value,
        contactName: contactNameResult.value,
        email: emailResult.value,
        phone: phoneResult.value,
        address: addressResult.value,
        vatNumber: vatNumberResult.value,
        taxCode: taxCodeResult.value,
        paymentTerms: paymentTermsResult.value,
        notes: notesResult.value,
        createdAt: now,
      });
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('crm.suppliers.update')],
      schema: {
        tags: ['suppliers'],
        summary: 'Update supplier',
        params: idParamSchema,
        body: supplierUpdateBodySchema,
        response: {
          200: supplierSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        isDisabled?: boolean;
        supplierCode?: string;
        contactName?: string;
        email?: string;
        phone?: string;
        address?: string;
        vatNumber?: string;
        taxCode?: string;
        paymentTerms?: string;
        notes?: string;
      };
      const {
        name,
        isDisabled,
        supplierCode,
        contactName,
        email,
        phone,
        address,
        vatNumber,
        taxCode,
        paymentTerms,
        notes,
      } = body;

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const emailResult = optionalEmail(email, 'email');
      if (!emailResult.ok) return badRequest(reply, emailResult.message);

      const nameResult = optionalNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const supplierCodeResult = optionalNonEmptyString(supplierCode, 'supplierCode');
      if (!supplierCodeResult.ok) return badRequest(reply, supplierCodeResult.message);

      const contactNameResult = optionalNonEmptyString(contactName, 'contactName');
      if (!contactNameResult.ok) return badRequest(reply, contactNameResult.message);

      const phoneResult = optionalNonEmptyString(phone, 'phone');
      if (!phoneResult.ok) return badRequest(reply, phoneResult.message);

      const addressResult = optionalNonEmptyString(address, 'address');
      if (!addressResult.ok) return badRequest(reply, addressResult.message);

      const vatNumberResult = optionalNonEmptyString(vatNumber, 'vatNumber');
      if (!vatNumberResult.ok) return badRequest(reply, vatNumberResult.message);

      const taxCodeResult = optionalNonEmptyString(taxCode, 'taxCode');
      if (!taxCodeResult.ok) return badRequest(reply, taxCodeResult.message);

      const paymentTermsResult = optionalNonEmptyString(paymentTerms, 'paymentTerms');
      if (!paymentTermsResult.ok) return badRequest(reply, paymentTermsResult.message);

      const notesResult = optionalNonEmptyString(notes, 'notes');
      if (!notesResult.ok) return badRequest(reply, notesResult.message);

      const isDisabledValue = isDisabled !== undefined ? parseBoolean(isDisabled) : undefined;

      const result = await query(
        `UPDATE suppliers SET
        name = COALESCE($1, name),
        is_disabled = COALESCE($2, is_disabled),
        supplier_code = COALESCE($3, supplier_code),
        contact_name = COALESCE($4, contact_name),
        email = COALESCE($5, email),
        phone = COALESCE($6, phone),
        address = COALESCE($7, address),
        vat_number = COALESCE($8, vat_number),
        tax_code = COALESCE($9, tax_code),
        payment_terms = COALESCE($10, payment_terms),
        notes = COALESCE($11, notes)
       WHERE id = $12
       RETURNING *`,
        [
          nameResult.value,
          isDisabledValue,
          supplierCodeResult.value,
          contactNameResult.value,
          emailResult.value,
          phoneResult.value,
          addressResult.value,
          vatNumberResult.value,
          taxCodeResult.value,
          paymentTermsResult.value,
          notesResult.value,
          idResult.value,
        ],
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Supplier not found' });
      }

      const changedFields = [
        Object.hasOwn(body, 'name') ? 'name' : null,
        Object.hasOwn(body, 'isDisabled') ? 'isDisabled' : null,
        Object.hasOwn(body, 'supplierCode') ? 'supplierCode' : null,
        Object.hasOwn(body, 'contactName') ? 'contactName' : null,
        Object.hasOwn(body, 'email') ? 'email' : null,
        Object.hasOwn(body, 'phone') ? 'phone' : null,
        Object.hasOwn(body, 'address') ? 'address' : null,
        Object.hasOwn(body, 'vatNumber') ? 'vatNumber' : null,
        Object.hasOwn(body, 'taxCode') ? 'taxCode' : null,
        Object.hasOwn(body, 'paymentTerms') ? 'paymentTerms' : null,
        Object.hasOwn(body, 'notes') ? 'notes' : null,
      ].filter((field): field is string => field !== null);

      const s = result.rows[0];

      // Determine specific action based on what changed
      let action = 'supplier.updated';
      if (changedFields.length === 1 && changedFields[0] === 'isDisabled') {
        action = body.isDisabled ? 'supplier.disabled' : 'supplier.enabled';
      }

      await logAudit({
        request,
        action,
        entityType: 'supplier',
        entityId: idResult.value,
        details: {
          targetLabel: s.name as string,
          secondaryLabel: (s.supplier_code as string | null) ?? undefined,
        },
      });
      return {
        id: s.id,
        name: s.name,
        isDisabled: s.is_disabled,
        supplierCode: s.supplier_code,
        contactName: s.contact_name,
        email: s.email,
        phone: s.phone,
        address: s.address,
        vatNumber: s.vat_number,
        taxCode: s.tax_code,
        paymentTerms: s.payment_terms,
        notes: s.notes,
        createdAt: s.created_at ? new Date(s.created_at).getTime() : undefined,
      };
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('crm.suppliers.delete')],
      schema: {
        tags: ['suppliers'],
        summary: 'Delete supplier',
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
      const result = await query(
        'DELETE FROM suppliers WHERE id = $1 RETURNING id, name, supplier_code',
        [idResult.value],
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Supplier not found' });
      }

      await logAudit({
        request,
        action: 'supplier.deleted',
        entityType: 'supplier',
        entityId: idResult.value,
        details: {
          targetLabel: result.rows[0].name as string,
          secondaryLabel: (result.rows[0].supplier_code as string | null) ?? undefined,
        },
      });
      return reply.code(204).send();
    },
  );
}
