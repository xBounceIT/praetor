import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export default async function (fastify, opts) {
    // All invoices routes require at least manager role
    fastify.addHook('onRequest', authenticateToken);
    fastify.addHook('onRequest', requireRole('admin', 'manager'));

    // GET / - List all invoices with their items
    fastify.get('/', async (request, reply) => {
        // Get all invoices
        const invoicesResult = await query(
            `SELECT 
                id, 
                linked_sale_id as "linkedSaleId",
                client_id as "clientId", 
                client_name as "clientName", 
                invoice_number as "invoiceNumber", 
                issue_date as "issueDate",
                due_date as "dueDate",
                status, 
                subtotal,
                tax_amount as "taxAmount",
                total,
                amount_paid as "amountPaid",
                notes,
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
            FROM invoices 
            ORDER BY created_at DESC`
        );

        // Get all invoice items
        const itemsResult = await query(
            `SELECT 
                id,
                invoice_id as "invoiceId",
                product_id as "productId",
                description,
                quantity,
                unit_price as "unitPrice",
                tax_rate as "taxRate",
                discount
            FROM invoice_items
            ORDER BY created_at ASC`
        );

        // Group items by invoice
        const itemsByInvoice = {};
        itemsResult.rows.forEach(item => {
            if (!itemsByInvoice[item.invoiceId]) {
                itemsByInvoice[item.invoiceId] = [];
            }
            itemsByInvoice[item.invoiceId].push(item);
        });

        // Attach items to invoices
        const invoices = invoicesResult.rows.map(invoice => ({
            ...invoice,
            issueDate: invoice.issueDate.toISOString().split('T')[0],
            dueDate: invoice.dueDate.toISOString().split('T')[0],
            subtotal: parseFloat(invoice.subtotal),
            taxAmount: parseFloat(invoice.taxAmount),
            total: parseFloat(invoice.total),
            amountPaid: parseFloat(invoice.amountPaid),
            items: (itemsByInvoice[invoice.id] || []).map(item => ({
                ...item,
                quantity: parseFloat(item.quantity),
                unitPrice: parseFloat(item.unitPrice),
                taxRate: parseFloat(item.taxRate),
                discount: parseFloat(item.discount)
            }))
        }));

        return invoices;
    });

    // POST / - Create invoice with items
    fastify.post('/', async (request, reply) => {
        const { linkedSaleId, clientId, clientName, invoiceNumber, issueDate, dueDate, status, subtotal, taxAmount, total, amountPaid, notes, items } = request.body;

        if (!clientId || !clientName || !invoiceNumber || !issueDate || !dueDate || !items || items.length === 0) {
            return reply.code(400).send({ error: 'Required fields missing: clientId, clientName, invoiceNumber, issueDate, dueDate, items' });
        }

        const invoiceId = 'inv-' + Date.now();

        try {
            // Insert invoice
            const invoiceResult = await query(
                `INSERT INTO invoices (
                    id, linked_sale_id, client_id, client_name, invoice_number, issue_date, due_date, 
                    status, subtotal, tax_amount, total, amount_paid, notes
                ) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
                RETURNING 
                    id, 
                    linked_sale_id as "linkedSaleId",
                    client_id as "clientId", 
                    client_name as "clientName", 
                    invoice_number as "invoiceNumber", 
                    issue_date as "issueDate",
                    due_date as "dueDate",
                    status, 
                    subtotal,
                    tax_amount as "taxAmount",
                    total,
                    amount_paid as "amountPaid",
                    notes,
                    EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                    EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
                [
                    invoiceId, linkedSaleId || null, clientId, clientName, invoiceNumber, issueDate, dueDate,
                    status || 'draft', subtotal, taxAmount, total, amountPaid || 0, notes
                ]
            );

            // Insert invoice items
            const createdItems = [];
            for (const item of items) {
                const itemId = 'inv-item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                const itemResult = await query(
                    `INSERT INTO invoice_items (
                        id, invoice_id, product_id, description, quantity, unit_price, tax_rate, discount
                    ) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
                    RETURNING 
                        id,
                        invoice_id as "invoiceId",
                        product_id as "productId",
                        description,
                        quantity,
                        unit_price as "unitPrice",
                        tax_rate as "taxRate",
                        discount`,
                    [
                        itemId, invoiceId, item.productId || null, item.description, item.quantity,
                        item.unitPrice, item.taxRate, item.discount || 0
                    ]
                );
                createdItems.push(itemResult.rows[0]);
            }

            const invoice = invoiceResult.rows[0];
            return reply.code(201).send({
                ...invoice,
                issueDate: new Date(invoice.issueDate).toISOString().split('T')[0],
                dueDate: new Date(invoice.dueDate).toISOString().split('T')[0],
                subtotal: parseFloat(invoice.subtotal),
                taxAmount: parseFloat(invoice.taxAmount),
                total: parseFloat(invoice.total),
                amountPaid: parseFloat(invoice.amountPaid),
                items: createdItems.map(item => ({
                    ...item,
                    quantity: parseFloat(item.quantity),
                    unitPrice: parseFloat(item.unitPrice),
                    taxRate: parseFloat(item.taxRate),
                    discount: parseFloat(item.discount)
                }))
            });
        } catch (err) {
            throw err;
        }
    });

    // PUT /:id - Update invoice
    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params;
        const { clientId, clientName, invoiceNumber, issueDate, dueDate, status, subtotal, taxAmount, total, amountPaid, notes, items } = request.body;

        try {
            // Update invoice
            const invoiceResult = await query(
                `UPDATE invoices 
                SET client_id = COALESCE($1, client_id),
                    client_name = COALESCE($2, client_name),
                    invoice_number = COALESCE($3, invoice_number),
                    issue_date = COALESCE($4, issue_date),
                    due_date = COALESCE($5, due_date),
                    status = COALESCE($6, status),
                    subtotal = COALESCE($7, subtotal),
                    tax_amount = COALESCE($8, tax_amount),
                    total = COALESCE($9, total),
                    amount_paid = COALESCE($10, amount_paid),
                    notes = COALESCE($11, notes),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $12 
                RETURNING 
                    id, 
                    linked_sale_id as "linkedSaleId",
                    client_id as "clientId", 
                    client_name as "clientName", 
                    invoice_number as "invoiceNumber", 
                    issue_date as "issueDate",
                    due_date as "dueDate",
                    status, 
                    subtotal,
                    tax_amount as "taxAmount",
                    total,
                    amount_paid as "amountPaid",
                    notes,
                    EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                    EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
                [clientId, clientName, invoiceNumber, issueDate, dueDate, status, subtotal, taxAmount, total, amountPaid, notes, id]
            );

            if (invoiceResult.rows.length === 0) {
                return reply.code(404).send({ error: 'Invoice not found' });
            }

            // If items are provided, update them
            let updatedItems = [];
            if (items) {
                // Delete existing items
                await query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);

                // Insert new items
                for (const item of items) {
                    const itemId = 'inv-item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                    const itemResult = await query(
                        `INSERT INTO invoice_items (
                            id, invoice_id, product_id, description, quantity, unit_price, tax_rate, discount
                        ) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
                        RETURNING 
                            id,
                            invoice_id as "invoiceId",
                            product_id as "productId",
                            description,
                            quantity,
                            unit_price as "unitPrice",
                            tax_rate as "taxRate",
                            discount`,
                        [
                            itemId, id, item.productId || null, item.description, item.quantity,
                            item.unitPrice, item.taxRate, item.discount || 0
                        ]
                    );
                    updatedItems.push(itemResult.rows[0]);
                }
            } else {
                // Fetch existing items
                const itemsResult = await query(
                    `SELECT 
                        id,
                        invoice_id as "invoiceId",
                        product_id as "productId",
                        description,
                        quantity,
                        unit_price as "unitPrice",
                        tax_rate as "taxRate",
                        discount
                    FROM invoice_items
                    WHERE invoice_id = $1`,
                    [id]
                );
                updatedItems = itemsResult.rows;
            }

            const invoice = invoiceResult.rows[0];
            return {
                ...invoice,
                issueDate: new Date(invoice.issueDate).toISOString().split('T')[0],
                dueDate: new Date(invoice.dueDate).toISOString().split('T')[0],
                subtotal: parseFloat(invoice.subtotal),
                taxAmount: parseFloat(invoice.taxAmount),
                total: parseFloat(invoice.total),
                amountPaid: parseFloat(invoice.amountPaid),
                items: updatedItems.map(item => ({
                    ...item,
                    quantity: parseFloat(item.quantity),
                    unitPrice: parseFloat(item.unitPrice),
                    taxRate: parseFloat(item.taxRate),
                    discount: parseFloat(item.discount)
                }))
            };
        } catch (err) {
            throw err;
        }
    });

    // DELETE /:id - Delete invoice
    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params;

        // Items and payments will be deleted automatically via CASCADE
        try {
            const result = await query('DELETE FROM invoices WHERE id = $1 RETURNING id', [id]);

            if (result.rows.length === 0) {
                return reply.code(404).send({ error: 'Invoice not found' });
            }

            return reply.code(204).send();
        } catch (err) {
            console.error('DELETE INVOICE ERROR:', err);
            // Check for specific DB errors
            if (err.code === '23503') { // Foreign key violation
                return reply.code(409).send({ error: 'Cannot delete invoice because it is referenced by other records (e.g. payments)' });
            }
            throw err;
        }
    });
}
