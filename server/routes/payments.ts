import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export default async function (fastify, opts) {
    // All payments routes require at least manager role
    fastify.addHook('onRequest', authenticateToken);
    fastify.addHook('onRequest', requireRole('admin', 'manager'));

    // GET / - List all payments
    fastify.get('/', async (request, reply) => {
        const result = await query(
            `SELECT 
                id, 
                invoice_id as "invoiceId",
                client_id as "clientId", 
                amount,
                payment_date as "paymentDate",
                payment_method as "paymentMethod",
                reference,
                notes,
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt"
            FROM payments 
            ORDER BY created_at DESC`
        );

        // Fetch client names separately or via join could be better, but consistent with other endpoints to fetch IDs and names
        // Ideally we join, but for now let's return what we have. The frontend often has client list to map names.
        // Actually, let's left join clients to get client name if needed, but existing `payments` table doesn't store client_name cache like others.
        // We stored client_id.

        const payments = result.rows.map(payment => ({
            ...payment,
            amount: parseFloat(payment.amount),
            paymentDate: payment.paymentDate.toISOString().split('T')[0]
        }));

        return payments;
    });

    // POST / - Create payment
    fastify.post('/', async (request, reply) => {
        const { invoiceId, clientId, amount, paymentDate, paymentMethod, reference, notes } = request.body;

        if (!clientId || !amount || !paymentDate) {
            return reply.code(400).send({ error: 'Required fields missing: clientId, amount, paymentDate' });
        }

        const paymentId = 'pay-' + Date.now();

        try {
            await query('BEGIN');

            const result = await query(
                `INSERT INTO payments (
                    id, invoice_id, client_id, amount, payment_date, payment_method, reference, notes
                ) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
                RETURNING 
                    id, 
                    invoice_id as "invoiceId",
                    client_id as "clientId", 
                    amount,
                    payment_date as "paymentDate",
                    payment_method as "paymentMethod",
                    reference,
                    notes,
                    EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt"`,
                [
                    paymentId, invoiceId || null, clientId, amount, paymentDate,
                    paymentMethod || 'bank_transfer', reference, notes
                ]
            );

            // If linked to an invoice, update the invoice's amount_paid and status
            if (invoiceId) {
                // Get current invoice totals
                const invoiceRes = await query(
                    'SELECT total, amount_paid FROM invoices WHERE id = $1 FOR UPDATE',
                    [invoiceId]
                );

                if (invoiceRes.rows.length > 0) {
                    const inv = invoiceRes.rows[0];
                    const newAmountPaid = parseFloat(inv.amount_paid) + parseFloat(amount);
                    const total = parseFloat(inv.total);

                    let newStatus = 'sent'; // default if not fully paid
                    if (newAmountPaid >= total) {
                        newStatus = 'paid';
                    } else if (newAmountPaid > 0) {
                        newStatus = 'sent'; // partial payment keeps it sent or we could add 'partial' status but schema restriction
                    }

                    await query(
                        `UPDATE invoices 
                         SET amount_paid = $1, status = $2, updated_at = CURRENT_TIMESTAMP 
                         WHERE id = $3`,
                        [newAmountPaid, newStatus, invoiceId]
                    );
                }
            }

            await query('COMMIT');

            const payment = result.rows[0];
            return reply.code(201).send({
                ...payment,
                amount: parseFloat(payment.amount),
                paymentDate: new Date(payment.paymentDate).toISOString().split('T')[0]
            });

        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    });

    // PUT /:id - Update payment
    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params;
        const { amount, paymentDate, paymentMethod, reference, notes } = request.body;
        // Note: We generally don't allow changing the linked invoice or client easily because of the math. 
        // For simplicity, let's allow updating metadata but if amount changes, we need to adjust invoice.

        // Detailed implementation of amount adjustment on invoice is complex without previous value. 
        // For now, let's implement basic update. If amount needs change, delete and recreate is safer, 
        // or we fetch old amount first.

        try {
            await query('BEGIN');

            const oldPaymentRes = await query('SELECT invoice_id, amount FROM payments WHERE id = $1', [id]);
            if (oldPaymentRes.rows.length === 0) {
                await query('ROLLBACK');
                return reply.code(404).send({ error: 'Payment not found' });
            }
            const oldPayment = oldPaymentRes.rows[0];
            const oldAmount = parseFloat(oldPayment.amount);

            const result = await query(
                `UPDATE payments 
                SET amount = COALESCE($1, amount),
                    payment_date = COALESCE($2, payment_date),
                    payment_method = COALESCE($3, payment_method),
                    reference = COALESCE($4, reference),
                    notes = COALESCE($5, notes)
                WHERE id = $6
                RETURNING 
                    id, 
                    invoice_id as "invoiceId",
                    client_id as "clientId", 
                    amount,
                    payment_date as "paymentDate",
                    payment_method as "paymentMethod",
                    reference,
                    notes,
                    EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt"`,
                [amount, paymentDate, paymentMethod, reference, notes, id]
            );

            const updatedPayment = result.rows[0];
            const newAmount = parseFloat(updatedPayment.amount);

            // Update invoice balance if amount changed and invoice is linked
            if (updatedPayment.invoiceId && newAmount !== oldAmount) {
                const diff = newAmount - oldAmount;

                const invoiceRes = await query(
                    'SELECT total, amount_paid FROM invoices WHERE id = $1 FOR UPDATE',
                    [updatedPayment.invoiceId]
                );

                if (invoiceRes.rows.length > 0) {
                    const inv = invoiceRes.rows[0];
                    const currentPaid = parseFloat(inv.amount_paid);
                    const newTotalPaid = currentPaid + diff;
                    const total = parseFloat(inv.total);

                    let newStatus = 'sent';
                    if (newTotalPaid >= total) newStatus = 'paid';

                    await query(
                        `UPDATE invoices 
                         SET amount_paid = $1, status = $2, updated_at = CURRENT_TIMESTAMP 
                         WHERE id = $3`,
                        [newTotalPaid, newStatus, updatedPayment.invoiceId]
                    );
                }
            }

            await query('COMMIT');

            return {
                ...updatedPayment,
                amount: parseFloat(updatedPayment.amount),
                paymentDate: new Date(updatedPayment.paymentDate).toISOString().split('T')[0]
            };

        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    });

    // DELETE /:id - Delete payment
    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params;

        try {
            await query('BEGIN');

            const paymentRes = await query('SELECT invoice_id, amount FROM payments WHERE id = $1 FOR UPDATE', [id]);
            if (paymentRes.rows.length === 0) {
                await query('ROLLBACK');
                return reply.code(404).send({ error: 'Payment not found' });
            }

            const { invoice_id, amount } = paymentRes.rows[0];

            await query('DELETE FROM payments WHERE id = $1', [id]);

            // Reverse invoice balance
            if (invoice_id) {
                const invoiceRes = await query(
                    'SELECT total, amount_paid FROM invoices WHERE id = $1 FOR UPDATE',
                    [invoice_id]
                );

                if (invoiceRes.rows.length > 0) {
                    const inv = invoiceRes.rows[0];
                    const currentPaid = parseFloat(inv.amount_paid);
                    const newTotalPaid = Math.max(0, currentPaid - parseFloat(amount)); // prevent negative
                    const total = parseFloat(inv.total);

                    let newStatus = 'sent';
                    if (newTotalPaid >= total) newStatus = 'paid';
                    else if (newTotalPaid === 0) newStatus = 'sent'; // or draft/overdue depending on due date? let's stick to 'sent' if it was issued.

                    await query(
                        `UPDATE invoices 
                         SET amount_paid = $1, status = $2, updated_at = CURRENT_TIMESTAMP 
                         WHERE id = $3`,
                        [newTotalPaid, newStatus, invoice_id]
                    );
                }
            }

            await query('COMMIT');
            return reply.code(204).send();

        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    });
}
