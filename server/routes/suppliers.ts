import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission, requireAnyPermission } from '../middleware/auth.ts';
import {
  requireNonEmptyString,
  optionalNonEmptyString,
  optionalEmail,
  parseBoolean,
  badRequest,
} from '../utils/validation.ts';
import { standardErrorResponses } from '../schemas/common.ts';

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
  required: ['name'],
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
        requireAnyPermission(
          'crm.suppliers.view',
          'crm.suppliers_all.view',
          'catalog.external_listing.view',
          'suppliers.quotes.view',
        ),
      ],
      schema: {
        tags: ['suppliers'],
        summary: 'List suppliers',
        response: {
          200: { type: 'array', items: supplierSchema },
          ...standardErrorResponses,
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

      const vatNumberResult = optionalNonEmptyString(vatNumber, 'vatNumber');
      if (!vatNumberResult.ok) return badRequest(reply, vatNumberResult.message);

      const taxCodeResult = optionalNonEmptyString(taxCode, 'taxCode');
      if (!taxCodeResult.ok) return badRequest(reply, taxCodeResult.message);

      const paymentTermsResult = optionalNonEmptyString(paymentTerms, 'paymentTerms');
      if (!paymentTermsResult.ok) return badRequest(reply, paymentTermsResult.message);

      const notesResult = optionalNonEmptyString(notes, 'notes');
      if (!notesResult.ok) return badRequest(reply, notesResult.message);

      const id = 's-' + Date.now();
      await query(
        `INSERT INTO suppliers (
        id, name, is_disabled, supplier_code, contact_name, email, phone,
        address, vat_number, tax_code, payment_terms, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
        ],
      );

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
      } = request.body as {
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

      const s = result.rows[0];
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
      const result = await query('DELETE FROM suppliers WHERE id = $1 RETURNING id', [
        idResult.value,
      ]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Supplier not found' });
      }

      return reply.code(204).send();
    },
  );
}
