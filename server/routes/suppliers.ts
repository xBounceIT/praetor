import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authenticateToken,
  requireAnyPermission,
  requirePermission,
  requireScopedPermission,
} from '../middleware/auth.ts';
import * as suppliersRepo from '../repositories/suppliersRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import {
  createSupplier,
  getSupplierCodeCandidate,
  type SupplierCreateValidationError,
  validateBulkSupplierCreateInput,
} from '../services/supplierCreation.ts';
import { logAudit } from '../utils/audit.ts';
import { mapWithConcurrency } from '../utils/concurrency.ts';
import { getForeignKeyViolation } from '../utils/db-errors.ts';
import { requestHasPermission } from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import {
  badRequest,
  optionalEmail,
  optionalNonEmptyString,
  parseBooleanField,
  requireNonEmptyString,
} from '../utils/validation.ts';

const BULK_SUPPLIER_CREATE_CONCURRENCY = 10;
const SUPPLIER_CODE_EXISTS_MESSAGE = 'Supplier code already exists';

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

type SupplierContactInput = {
  fullName: unknown;
  role?: unknown;
  email?: unknown;
  phone?: unknown;
};

const supplierContactSchema = {
  type: 'object',
  properties: {
    fullName: { type: 'string' },
    role: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
  },
  required: ['fullName'],
} as const;

const supplierSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    isDisabled: { type: 'boolean' },
    supplierCode: { type: ['string', 'null'] },
    contacts: { type: 'array', items: supplierContactSchema },
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
    contacts: { type: 'array', items: supplierContactSchema },
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

const bulkSupplierCreateItemSchema = {
  type: 'object',
  properties: {
    supplierCode: { type: 'string' },
    name: { type: 'string' },
    contactName: { type: 'string' },
    contactRole: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    address: { type: 'string' },
    vatNumber: { type: 'string' },
    taxCode: { type: 'string' },
    paymentTerms: { type: 'string' },
    notes: { type: 'string' },
  },
  required: [],
  additionalProperties: false,
} as const;

const bulkSupplierErrorSchema = {
  type: 'object',
  properties: {
    field: { type: 'string' },
    code: {
      type: 'string',
      enum: ['required', 'invalid', 'too_long', 'duplicate', 'creation_failed'],
    },
    message: { type: 'string' },
  },
  required: ['code', 'message'],
  additionalProperties: false,
} as const;

const bulkSupplierResultSchema = {
  anyOf: [
    {
      type: 'object',
      properties: {
        index: { type: 'integer' },
        success: { type: 'boolean', enum: [true] },
        supplier: supplierSchema,
      },
      required: ['index', 'success', 'supplier'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        index: { type: 'integer' },
        success: { type: 'boolean', enum: [false] },
        errors: { type: 'array', items: bulkSupplierErrorSchema, minItems: 1 },
      },
      required: ['index', 'success', 'errors'],
      additionalProperties: false,
    },
  ],
} as const;

const bulkSupplierResponseSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'object',
      properties: {
        total: { type: 'integer' },
        succeeded: { type: 'integer' },
        failed: { type: 'integer' },
      },
      required: ['total', 'succeeded', 'failed'],
      additionalProperties: false,
    },
    results: { type: 'array', items: bulkSupplierResultSchema },
  },
  required: ['summary', 'results'],
  additionalProperties: false,
} as const;

const supplierUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    isDisabled: { type: 'boolean' },
    supplierCode: { type: 'string' },
    contacts: { type: 'array', items: supplierContactSchema },
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

const parseContacts = (
  value: unknown,
): { ok: true; value: suppliersRepo.SupplierContact[] } | { ok: false; message: string } => {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: 'contacts must be an array' };

  const contacts: suppliersRepo.SupplierContact[] = [];
  for (let index = 0; index < value.length; index++) {
    const raw = value[index];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, message: `contacts[${index}] must be an object` };
    }
    const contact = raw as SupplierContactInput;
    const fullNameResult = requireNonEmptyString(contact.fullName, `contacts[${index}].fullName`);
    if (!fullNameResult.ok) return { ok: false, message: fullNameResult.message };
    const roleResult = optionalNonEmptyString(contact.role, `contacts[${index}].role`);
    if (!roleResult.ok) return { ok: false, message: roleResult.message };
    const emailResult = optionalEmail(contact.email, `contacts[${index}].email`);
    if (!emailResult.ok) return { ok: false, message: emailResult.message };
    const phoneResult = optionalNonEmptyString(contact.phone, `contacts[${index}].phone`);
    if (!phoneResult.ok) return { ok: false, message: phoneResult.message };
    contacts.push({
      fullName: fullNameResult.value,
      role: roleResult.value ?? undefined,
      email: emailResult.value ?? undefined,
      phone: phoneResult.value ?? undefined,
    });
  }
  return { ok: true, value: contacts };
};

const buildPrimaryFields = (contacts: suppliersRepo.SupplierContact[]) => {
  const primary = contacts[0] ?? null;
  return {
    contactName: primary?.fullName ?? null,
    email: primary?.email ?? null,
    phone: primary?.phone ?? null,
  };
};

type LegacyContactPatch = {
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
};

const mergeLegacyPrimaryContact = (
  contacts: suppliersRepo.SupplierContact[],
  patch: LegacyContactPatch,
): suppliersRepo.SupplierContact[] => {
  const remainingContacts =
    Object.hasOwn(patch, 'contactName') && patch.contactName === null
      ? contacts.slice(1)
      : contacts;
  const [primary, ...otherContacts] = remainingContacts;
  if (!primary) return [];

  return [
    {
      ...primary,
      ...(Object.hasOwn(patch, 'contactName') && patch.contactName !== null
        ? { fullName: patch.contactName }
        : {}),
      ...(Object.hasOwn(patch, 'email') ? { email: patch.email ?? undefined } : {}),
      ...(Object.hasOwn(patch, 'phone') ? { phone: patch.phone ?? undefined } : {}),
    },
    ...otherContacts,
  ];
};

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
        description:
          'Returns full supplier records only with crm.suppliers_all.view. Other authorized callers receive only id, name, and isDisabled selector fields.',
        response: {
          200: { type: 'array', items: supplierSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest) =>
      requestHasPermission(request, 'crm.suppliers_all.view')
        ? suppliersRepo.listAll()
        : suppliersRepo.listOptions(),
  );

  fastify.post(
    '/',
    {
      onRequest: [requireScopedPermission('crm.suppliers', 'create')],
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
      const body = request.body as Record<string, unknown>;
      const {
        name,
        supplierCode,
        contacts,
        contactName,
        email,
        phone,
        address,
        vatNumber,
        taxCode,
        paymentTerms,
        notes,
      } = body;

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const hasContacts = Object.hasOwn(body, 'contacts');
      const contactsResult = parseContacts(contacts);
      if (!contactsResult.ok) return badRequest(reply, contactsResult.message);

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

      const contactFields = hasContacts
        ? buildPrimaryFields(contactsResult.value)
        : {
            contactName: contactNameResult.value,
            email: emailResult.value,
            phone: phoneResult.value,
          };
      const creation = await createSupplier({
        name: nameResult.value,
        supplierCode: supplierCodeResult.value,
        contacts: contactsResult.value,
        ...contactFields,
        address: addressResult.value,
        vatNumber: vatNumberResult.value,
        taxCode: taxCodeResult.value,
        paymentTerms: paymentTermsResult.value,
        notes: notesResult.value,
      });
      if (!creation) {
        return replyError(request, reply, {
          statusCode: 409,
          message: SUPPLIER_CODE_EXISTS_MESSAGE,
          action: 'supplier.create.conflict',
          entityType: 'supplier',
          details: {
            targetLabel: nameResult.value,
            secondaryLabel: supplierCodeResult.value ?? undefined,
          },
        });
      }
      const { id, supplier: created } = creation;

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
      return reply.code(201).send(created);
    },
  );

  fastify.post(
    '/bulk',
    {
      bodyLimit: 10 * 1024 * 1024,
      onRequest: [requireScopedPermission('crm.suppliers', 'create')],
      schema: {
        tags: ['suppliers'],
        summary: 'Create multiple suppliers with per-row results',
        body: {
          type: 'object',
          properties: {
            suppliers: {
              type: 'array',
              items: bulkSupplierCreateItemSchema,
              minItems: 1,
              maxItems: 500,
            },
          },
          required: ['suppliers'],
          additionalProperties: false,
        },
        response: {
          200: bulkSupplierResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { suppliers: inputs } = request.body as { suppliers: Record<string, unknown>[] };
      const codeCandidates = inputs.map(getSupplierCodeCandidate);
      const codeCounts = new Map<string, number>();
      for (const code of codeCandidates) {
        if (code) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
      }

      const existingCodesPromise = suppliersRepo.findExistingCodes(
        codeCandidates.flatMap((code) => (code ? [code] : [])),
      );
      const validations = inputs.map(validateBulkSupplierCreateInput);
      const existingCodes = await existingCodesPromise;
      const errorsByIndex: SupplierCreateValidationError[][] = validations.map((validation) =>
        validation.ok ? [] : [...validation.errors],
      );
      const addError = (index: number, error: SupplierCreateValidationError) => {
        if (
          !errorsByIndex[index].some(
            (existing) => existing.field === error.field && existing.code === error.code,
          )
        ) {
          errorsByIndex[index].push(error);
        }
      };

      codeCandidates.forEach((code, index) => {
        if (!code) return;
        if ((codeCounts.get(code) ?? 0) > 1) {
          addError(index, {
            field: 'supplierCode',
            code: 'duplicate',
            message: 'Supplier code is duplicated within this batch',
          });
        }
        if (existingCodes.has(code)) {
          addError(index, {
            field: 'supplierCode',
            code: 'duplicate',
            message: SUPPLIER_CODE_EXISTS_MESSAGE,
          });
        }
      });

      const results = await mapWithConcurrency(
        inputs,
        BULK_SUPPLIER_CREATE_CONCURRENCY,
        async (
          _input,
          index,
        ): Promise<
          | { index: number; success: true; supplier: suppliersRepo.Supplier }
          | { index: number; success: false; errors: SupplierCreateValidationError[] }
        > => {
          const validation = validations[index];
          if (!validation.ok || errorsByIndex[index].length > 0) {
            return { index, success: false, errors: errorsByIndex[index] };
          }

          try {
            const creation = await createSupplier(validation.value);
            if (!creation) {
              return {
                index,
                success: false,
                errors: [
                  {
                    field: 'supplierCode',
                    code: 'duplicate',
                    message: SUPPLIER_CODE_EXISTS_MESSAGE,
                  },
                ],
              };
            }
            const { id, supplier } = creation;
            try {
              await logAudit({
                request,
                action: 'supplier.created',
                entityType: 'supplier',
                entityId: id,
                details: {
                  targetLabel: supplier.name,
                  secondaryLabel: supplier.supplierCode ?? undefined,
                },
              });
            } catch (auditError) {
              request.log.warn(
                { err: auditError, supplierId: id },
                'Failed to audit bulk supplier',
              );
            }
            return { index, success: true, supplier };
          } catch (err) {
            request.log.error({ err, index }, 'Failed to create supplier in bulk operation');
            return {
              index,
              success: false,
              errors: [{ code: 'creation_failed', message: 'Unable to create supplier' }],
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
      onRequest: [requirePermission('crm.suppliers_all.update')],
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
      const body = (request.body ?? {}) as Record<string, unknown>;
      const {
        name,
        supplierCode,
        contacts,
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

      const hasContacts = Object.hasOwn(body, 'contacts');
      const hasContactName = Object.hasOwn(body, 'contactName');
      const hasEmail = Object.hasOwn(body, 'email');
      const hasPhone = Object.hasOwn(body, 'phone');
      const hasLegacyContactPatch = hasContactName || hasEmail || hasPhone;
      const contactsResult = parseContacts(hasContacts ? contacts : undefined);
      if (!contactsResult.ok) return badRequest(reply, contactsResult.message);

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

      // POST requires vatNumber (`requireNonEmptyString`); keep PUT symmetric so an empty
      // string can't silently null it out, which would leave a supplier in a state that the
      // create endpoint would have rejected. `vatNumberValue` is the validated string when
      // provided, or `undefined` when the field was omitted from the body.
      let vatNumberValue: string | undefined;
      if (vatNumber !== undefined) {
        const vatNumberResult = requireNonEmptyString(vatNumber, 'vatNumber');
        if (!vatNumberResult.ok) return badRequest(reply, vatNumberResult.message);
        vatNumberValue = vatNumberResult.value;
      }

      const taxCodeResult = optionalNonEmptyString(taxCode, 'taxCode');
      if (!taxCodeResult.ok) return badRequest(reply, taxCodeResult.message);

      const paymentTermsResult = optionalNonEmptyString(paymentTerms, 'paymentTerms');
      if (!paymentTermsResult.ok) return badRequest(reply, paymentTermsResult.message);

      const notesResult = optionalNonEmptyString(notes, 'notes');
      if (!notesResult.ok) return badRequest(reply, notesResult.message);

      const isDisabledResult = parseBooleanField(body, 'isDisabled');
      if (!isDisabledResult.ok) return badRequest(reply, isDisabledResult.message);
      const isDisabledValue = isDisabledResult.value;

      const patch: suppliersRepo.SupplierUpdate = {};
      // `name` is NOT NULL in the DB - an empty payload here means "don't change",
      // not "clear it". Every other field below is nullable; an explicit "" from the
      // client must round-trip to NULL so users can actually unset stale data.
      if (Object.hasOwn(body, 'name') && nameResult.value !== null) patch.name = nameResult.value;
      if (isDisabledValue !== undefined) patch.isDisabled = isDisabledValue;
      if (Object.hasOwn(body, 'supplierCode')) patch.supplierCode = supplierCodeResult.value;
      if (hasContacts) {
        patch.contacts = contactsResult.value;
        const primary = buildPrimaryFields(contactsResult.value);
        patch.contactName = primary.contactName;
        patch.email = primary.email;
        patch.phone = primary.phone;
      } else {
        if (hasContactName) patch.contactName = contactNameResult.value;
        if (hasEmail) patch.email = emailResult.value;
        if (hasPhone) patch.phone = phoneResult.value;

        if (hasLegacyContactPatch) {
          const current = await suppliersRepo.findById(idResult.value);
          if (!current) {
            return replyError(request, reply, {
              statusCode: 404,
              message: 'Supplier not found',
              action: 'supplier.update.not_found',
              entityType: 'supplier',
              entityId: idResult.value,
            });
          }

          if (current.contacts.length > 0) {
            const nextContacts = mergeLegacyPrimaryContact(current.contacts, {
              ...(hasContactName ? { contactName: contactNameResult.value } : {}),
              ...(hasEmail ? { email: emailResult.value } : {}),
              ...(hasPhone ? { phone: phoneResult.value } : {}),
            });
            patch.contacts = nextContacts;
            if (nextContacts.length > 0) {
              Object.assign(patch, buildPrimaryFields(nextContacts));
            }
          }
        }
      }
      if (Object.hasOwn(body, 'address')) patch.address = addressResult.value;
      if (vatNumberValue !== undefined) patch.vatNumber = vatNumberValue;
      if (Object.hasOwn(body, 'taxCode')) patch.taxCode = taxCodeResult.value;
      if (Object.hasOwn(body, 'paymentTerms')) patch.paymentTerms = paymentTermsResult.value;
      if (Object.hasOwn(body, 'notes')) patch.notes = notesResult.value;

      const updateResult = await suppliersRepo.updateIfCodeAvailable(idResult.value, patch);
      if (!updateResult.ok) {
        if (updateResult.reason === 'duplicate_code') {
          return replyError(request, reply, {
            statusCode: 409,
            message: SUPPLIER_CODE_EXISTS_MESSAGE,
            action: 'supplier.update.conflict',
            entityType: 'supplier',
            entityId: idResult.value,
            details: {
              secondaryLabel: supplierCodeResult.value ?? undefined,
            },
          });
        }
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier not found',
          action: 'supplier.update.not_found',
          entityType: 'supplier',
          entityId: idResult.value,
        });
      }
      const updated = updateResult.supplier;

      const changedFields = [
        Object.hasOwn(body, 'name') ? 'name' : null,
        Object.hasOwn(body, 'isDisabled') ? 'isDisabled' : null,
        Object.hasOwn(body, 'supplierCode') ? 'supplierCode' : null,
        hasContacts ? 'contacts' : null,
        !hasContacts && hasContactName ? 'contactName' : null,
        !hasContacts && hasEmail ? 'email' : null,
        !hasContacts && hasPhone ? 'phone' : null,
        Object.hasOwn(body, 'address') ? 'address' : null,
        Object.hasOwn(body, 'vatNumber') ? 'vatNumber' : null,
        Object.hasOwn(body, 'taxCode') ? 'taxCode' : null,
        Object.hasOwn(body, 'paymentTerms') ? 'paymentTerms' : null,
        Object.hasOwn(body, 'notes') ? 'notes' : null,
      ].filter((field): field is string => field !== null);

      let action = 'supplier.updated';
      if (changedFields.length === 1 && changedFields[0] === 'isDisabled') {
        action = isDisabledValue ? 'supplier.disabled' : 'supplier.enabled';
      }

      await logAudit({
        request,
        action,
        entityType: 'supplier',
        entityId: idResult.value,
        details: {
          targetLabel: updated.name,
          secondaryLabel: updated.supplierCode ?? undefined,
        },
      });
      return updated;
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('crm.suppliers_all.delete')],
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

      let deleted: Awaited<ReturnType<typeof suppliersRepo.deleteById>>;
      try {
        deleted = await suppliersRepo.deleteById(idResult.value);
      } catch (err) {
        // Supplier financial-doc tables (supplier_invoices, supplier_quotes, supplier_sales)
        // now reference suppliers with ON DELETE RESTRICT instead of CASCADE - deleting a
        // supplier with any such document errors at the FK layer. Translate to a 409 so the
        // UI can surface a clear "supplier has financial documents" message.
        if (getForeignKeyViolation(err)) {
          return replyError(request, reply, {
            statusCode: 409,
            message:
              'Cannot delete supplier because it has financial documents (invoices, quotes, or sales). Remove them first.',
            action: 'supplier.delete.conflict',
            entityType: 'supplier',
            entityId: idResult.value,
            details: { secondaryLabel: 'has_financial_documents' },
          });
        }
        throw err;
      }
      if (!deleted) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier not found',
          action: 'supplier.delete.not_found',
          entityType: 'supplier',
          entityId: idResult.value,
        });
      }

      await logAudit({
        request,
        action: 'supplier.deleted',
        entityType: 'supplier',
        entityId: idResult.value,
        details: {
          targetLabel: deleted.name,
          secondaryLabel: deleted.supplierCode ?? undefined,
        },
      });
      return reply.code(204).send();
    },
  );
}
