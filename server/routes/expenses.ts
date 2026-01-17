import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export default async function (fastify, opts) {
    // All expenses routes require at least manager role
    fastify.addHook('onRequest', authenticateToken);
    fastify.addHook('onRequest', requireRole('admin', 'manager'));

    // GET / - List all expenses
    fastify.get('/', async (request, reply) => {
        const result = await query(
            `SELECT 
                id, 
                description,
                amount,
                expense_date as "expenseDate",
                category,
                vendor,
                receipt_reference as "receiptReference",
                notes,
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt"
            FROM expenses 
            ORDER BY expense_date DESC`
        );

        const expenses = result.rows.map(expense => ({
            ...expense,
            amount: parseFloat(expense.amount),
            expenseDate: expense.expenseDate.toISOString().split('T')[0]
        }));

        return expenses;
    });

    // POST / - Create expense
    fastify.post('/', async (request, reply) => {
        const { description, amount, expenseDate, category, vendor, receiptReference, notes } = request.body;

        if (!description || !amount || !expenseDate) {
            return reply.code(400).send({ error: 'Required fields missing: description, amount, expenseDate' });
        }

        const expenseId = 'exp-' + Date.now();

        try {
            const result = await query(
                `INSERT INTO expenses (
                    id, description, amount, expense_date, category, vendor, receipt_reference, notes
                ) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
                RETURNING 
                    id, 
                    description,
                    amount,
                    expense_date as "expenseDate",
                    category,
                    vendor,
                    receipt_reference as "receiptReference",
                    notes,
                    EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt"`,
                [
                    expenseId, description, amount, expenseDate,
                    category || 'other', vendor, receiptReference, notes
                ]
            );

            const expense = result.rows[0];
            return reply.code(201).send({
                ...expense,
                amount: parseFloat(expense.amount),
                expenseDate: new Date(expense.expenseDate).toISOString().split('T')[0]
            });

        } catch (err) {
            throw err;
        }
    });

    // PUT /:id - Update expense
    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params;
        const { description, amount, expenseDate, category, vendor, receiptReference, notes } = request.body;

        try {
            const result = await query(
                `UPDATE expenses 
                SET description = COALESCE($1, description),
                    amount = COALESCE($2, amount),
                    expense_date = COALESCE($3, expense_date),
                    category = COALESCE($4, category),
                    vendor = COALESCE($5, vendor),
                    receipt_reference = COALESCE($6, receipt_reference),
                    notes = COALESCE($7, notes)
                WHERE id = $8
                RETURNING 
                    id, 
                    description,
                    amount,
                    expense_date as "expenseDate",
                    category,
                    vendor,
                    receipt_reference as "receiptReference",
                    notes,
                    EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt"`,
                [description, amount, expenseDate, category, vendor, receiptReference, notes, id]
            );

            if (result.rows.length === 0) {
                return reply.code(404).send({ error: 'Expense not found' });
            }

            const expense = result.rows[0];
            return {
                ...expense,
                amount: parseFloat(expense.amount),
                expenseDate: new Date(expense.expenseDate).toISOString().split('T')[0]
            };

        } catch (err) {
            throw err;
        }
    });

    // DELETE /:id - Delete expense
    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params;

        const result = await query('DELETE FROM expenses WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Expense not found' });
        }

        return reply.code(204).send();
    });
}
