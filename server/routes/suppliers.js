import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export default async function (fastify, opts) {
  fastify.addHook('onRequest', authenticateToken);
  fastify.addHook('onRequest', requireRole('admin', 'manager'));

  fastify.get('/', async () => {
    const result = await query('SELECT * FROM suppliers ORDER BY name');
    return result.rows.map(s => ({
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
      notes: s.notes
    }));
  });

  fastify.post('/', async (request, reply) => {
    const {
      name, supplierCode, contactName, email, phone,
      address, vatNumber, taxCode, paymentTerms, notes
    } = request.body;

    if (!name) {
      return reply.code(400).send({ error: 'Supplier name is required' });
    }

    const id = 's-' + Date.now();
    await query(
      `INSERT INTO suppliers (
        id, name, is_disabled, supplier_code, contact_name, email, phone,
        address, vat_number, tax_code, payment_terms, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id, name, false, supplierCode, contactName, email, phone,
        address, vatNumber, taxCode, paymentTerms, notes
      ]
    );

    return reply.code(201).send({
      id,
      name,
      isDisabled: false,
      supplierCode,
      contactName,
      email,
      phone,
      address,
      vatNumber,
      taxCode,
      paymentTerms,
      notes
    });
  });

  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
    const {
      name, isDisabled, supplierCode, contactName, email, phone,
      address, vatNumber, taxCode, paymentTerms, notes
    } = request.body;

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
        name || null, isDisabled, supplierCode, contactName, email, phone,
        address, vatNumber, taxCode, paymentTerms, notes, id
      ]
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
      notes: s.notes
    };
  });

  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const result = await query('DELETE FROM suppliers WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Supplier not found' });
    }

    return reply.code(204).send();
  });
}
