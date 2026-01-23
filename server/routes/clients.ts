import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import { requireNonEmptyString, optionalNonEmptyString, optionalEmail, badRequest } from '../utils/validation.ts';

export default async function (fastify, opts) {
    // GET / - List all clients
    fastify.get('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const isStandardUser = request.user.role === 'user';
        let queryText = 'SELECT * FROM clients ORDER BY name';
        let queryParams = [];

        if (isStandardUser) {
            queryText = `
                SELECT c.id, c.name
                FROM clients c
                INNER JOIN user_clients uc ON c.id = uc.client_id
                WHERE uc.user_id = $1
                ORDER BY c.name
            `;
            queryParams = [request.user.id];
        }

        const result = await query(queryText, queryParams);
        const clients = result.rows.map(c => {
            if (isStandardUser) {
                return {
                    id: c.id,
                    name: c.name,
                    description: null
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
                billingCode: c.billing_code
            };
        });
        return clients;
    });

    // POST / - Create client (manager only)
    fastify.post('/', {
        onRequest: [authenticateToken, requireRole('manager')]
    }, async (request, reply) => {
        const {
            name, type, contactName, clientCode, email, phone,
            address, vatNumber, taxCode, billingCode
        } = request.body;

        const nameResult = requireNonEmptyString(name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);

        const clientCodeResult = requireNonEmptyString(clientCode, 'clientCode');
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
                [vatNumberResult.value]
            );
            if (existingVat.rows.length > 0) {
                return badRequest(reply, 'VAT number already exists');
            }
        }

        const id = 'c-' + Date.now();

        try {
            await query(`
            INSERT INTO clients (
                id, name, is_disabled, type, contact_name, client_code,
                email, phone, address, vat_number, tax_code, billing_code
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
            id, nameResult.value, false, type || 'company', contactName, clientCodeResult.value,
            emailResult.value, phone, address, vatNumberResult.value, taxCodeResult.value, billingCode
        ]);

            return reply.code(201).send({
            id, name: nameResult.value, isDisabled: false, type, contactName, clientCode: clientCodeResult.value,
            email: emailResult.value, phone, address, vatNumber: vatNumberResult.value, taxCode: taxCodeResult.value, billingCode
        });
        } catch (err) {
            if (err.code === '23505') { // Unique violation
                return badRequest(reply, 'VAT number already exists');
            }
            throw err;
        }
    });

    // PUT /:id - Update client (manager only)
    fastify.put('/:id', {
        onRequest: [authenticateToken, requireRole('manager')]
    }, async (request, reply) => {
        const { id } = request.params;
        const {
            name, isDisabled, type, contactName, clientCode, email, phone,
            address, vatNumber, taxCode, billingCode
        } = request.body;
        const body = request.body ?? {};
        const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
        const hasClientCode = Object.prototype.hasOwnProperty.call(body, 'clientCode');
        const hasVatNumber = Object.prototype.hasOwnProperty.call(body, 'vatNumber');
        const hasTaxCode = Object.prototype.hasOwnProperty.call(body, 'taxCode');
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
            const clientCodeResult = requireNonEmptyString(clientCode, 'clientCode');
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
                [vatNumberValue, idResult.value]
            );
            if (existingVat.rows.length > 0) {
                return badRequest(reply, 'VAT number already exists');
            }
        }

        try {
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
                billing_code = COALESCE($11, billing_code)
            WHERE id = $12 
            RETURNING *
        `, [
            nameValue, isDisabled, type, contactName, clientCodeValue,
            emailResult.value, phone, address, vatNumberValue, taxCodeValue, billingCode, idResult.value
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
            billingCode: c.billing_code
        };
        } catch (err) {
            if (err.code === '23505') { // Unique violation
                return badRequest(reply, 'VAT number already exists');
            }
            throw err;
        }
    });

    // DELETE /:id - Delete client (manager only)
    fastify.delete('/:id', {
        onRequest: [authenticateToken, requireRole('manager')]
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
