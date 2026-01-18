import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import { requireNonEmptyString, optionalNonEmptyString, optionalEmail, badRequest } from '../utils/validation.ts';

export default async function (fastify, opts) {
    // GET / - List all clients
    fastify.get('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        let queryText = 'SELECT * FROM clients ORDER BY name';
        let queryParams = [];

        if (request.user.role === 'user') {
            queryText = `
                SELECT c.*
                FROM clients c
                INNER JOIN user_clients uc ON c.id = uc.client_id
                WHERE uc.user_id = $1
                ORDER BY c.name
            `;
            queryParams = [request.user.id];
        }

        const result = await query(queryText, queryParams);
        const clients = result.rows.map(c => ({
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
            paymentTerms: c.payment_terms
        }));
        return clients;
    });

    // POST / - Create client (admin/manager only)
    fastify.post('/', {
        onRequest: [authenticateToken, requireRole('admin', 'manager')]
    }, async (request, reply) => {
        const {
            name, type, contactName, clientCode, email, phone,
            address, vatNumber, taxCode, billingCode, paymentTerms
        } = request.body;

        const nameResult = requireNonEmptyString(name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);

        const emailResult = optionalEmail(email, 'email');
        if (!emailResult.ok) return badRequest(reply, emailResult.message);
        const id = 'c-' + Date.now();
        await query(`
            INSERT INTO clients (
                id, name, is_disabled, type, contact_name, client_code, 
                email, phone, address, vat_number, tax_code, billing_code, payment_terms
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
            id, nameResult.value, false, type || 'company', contactName, clientCode,
            emailResult.value, phone, address, vatNumber, taxCode, billingCode, paymentTerms
        ]);

        return reply.code(201).send({
            id, name: nameResult.value, isDisabled: false, type, contactName, clientCode,
            email, phone, address, vatNumber, taxCode, billingCode, paymentTerms
        });
    });

    // PUT /:id - Update client (admin/manager only)
    fastify.put('/:id', {
        onRequest: [authenticateToken, requireRole('admin', 'manager')]
    }, async (request, reply) => {
        const { id } = request.params;
        const {
            name, isDisabled, type, contactName, clientCode, email, phone,
            address, vatNumber, taxCode, billingCode, paymentTerms
        } = request.body;
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);

        const emailResult = optionalEmail(email, 'email');
        if (!emailResult.ok) return badRequest(reply, emailResult.message);

        const result = await query(`
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
                billing_code = COALESCE($11, billing_code),
                payment_terms = COALESCE($12, payment_terms)
            WHERE id = $13 
            RETURNING *
        `, [
            name || null, isDisabled, type, contactName, clientCode,
            emailResult.value, phone, address, vatNumber, taxCode, billingCode, paymentTerms, idResult.value
        ]);

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Client not found' });
        }

        const c = result.rows[0];

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
            paymentTerms: c.payment_terms
        };
    });

    // DELETE /:id - Delete client (admin only)
    fastify.delete('/:id', {
        onRequest: [authenticateToken, requireRole('admin')]
    }, async (request, reply) => {
        const { id } = request.params;
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);
        const result = await query('DELETE FROM clients WHERE id = $1 RETURNING id', [idResult.value]);
        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Client not found' });
        }

        return { message: 'Client deleted' };
    });
}
