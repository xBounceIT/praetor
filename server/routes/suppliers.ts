import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import {
  requireNonEmptyString,
  optionalNonEmptyString,
  optionalEmail,
  parseBoolean,
  badRequest,
} from '../utils/validation.ts';

export default async function (fastify, opts) {
  fastify.addHook('onRequest', authenticateToken);
  fastify.addHook('onRequest', requireRole('manager'));

  fastify.get('/', async () => {
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
  });

  fastify.post('/', async (request, reply) => {
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
    } = request.body;

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
  });

  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
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
    } = request.body;

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
  });

  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const idResult = requireNonEmptyString(id, 'id');
    if (!idResult.ok) return badRequest(reply, idResult.message);
    const result = await query('DELETE FROM suppliers WHERE id = $1 RETURNING id', [
      idResult.value,
    ]);

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Supplier not found' });
    }

    return reply.code(204).send();
  });
}
