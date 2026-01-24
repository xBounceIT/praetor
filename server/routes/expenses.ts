import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import {
  requireNonEmptyString,
  optionalNonEmptyString,
  parseDateString,
  optionalDateString,
  parseLocalizedPositiveNumber,
  optionalLocalizedPositiveNumber,
  badRequest,
} from '../utils/validation.ts';

export default async function (fastify, _opts) {
  // All expenses routes require manager role
  fastify.addHook('onRequest', authenticateToken);
  fastify.addHook('onRequest', requireRole('manager'));

  // GET / - List all expenses
  fastify.get('/', async (_request, _reply) => {
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
            ORDER BY expense_date DESC`,
    );

    const expenses = result.rows.map((expense) => ({
      ...expense,
      amount: parseFloat(expense.amount),
      expenseDate: expense.expenseDate.toISOString().split('T')[0],
    }));

    return expenses;
  });

  // POST / - Create expense
  fastify.post('/', async (request, reply) => {
    const { description, amount, expenseDate, category, vendor, receiptReference, notes } =
      request.body;

    const descriptionResult = requireNonEmptyString(description, 'description');
    if (!descriptionResult.ok) return badRequest(reply, descriptionResult.message);

    const amountResult = parseLocalizedPositiveNumber(amount, 'amount');
    if (!amountResult.ok) return badRequest(reply, amountResult.message);

    const expenseDateResult = parseDateString(expenseDate, 'expenseDate');
    if (!expenseDateResult.ok) return badRequest(reply, expenseDateResult.message);

    const categoryResult = optionalNonEmptyString(category, 'category');
    if (!categoryResult.ok) return badRequest(reply, categoryResult.message);

    const vendorResult = optionalNonEmptyString(vendor, 'vendor');
    if (!vendorResult.ok) return badRequest(reply, vendorResult.message);

    const receiptReferenceResult = optionalNonEmptyString(receiptReference, 'receiptReference');
    if (!receiptReferenceResult.ok) return badRequest(reply, receiptReferenceResult.message);

    const notesResult = optionalNonEmptyString(notes, 'notes');
    if (!notesResult.ok) return badRequest(reply, notesResult.message);

    const expenseId = 'exp-' + Date.now();

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
        expenseId,
        descriptionResult.value,
        amountResult.value,
        expenseDateResult.value,
        categoryResult.value || 'other',
        vendorResult.value,
        receiptReferenceResult.value,
        notesResult.value,
      ],
    );

    const expense = result.rows[0];
    return reply.code(201).send({
      ...expense,
      amount: parseFloat(expense.amount),
      expenseDate: new Date(expense.expenseDate).toISOString().split('T')[0],
    });
  });

  // PUT /:id - Update expense
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
    const { description, amount, expenseDate, category, vendor, receiptReference, notes } =
      request.body;
    const idResult = requireNonEmptyString(id, 'id');
    if (!idResult.ok) return badRequest(reply, idResult.message);

    let descriptionValue = description;
    if (description !== undefined) {
      const descriptionResult = optionalNonEmptyString(description, 'description');
      if (!descriptionResult.ok) return badRequest(reply, descriptionResult.message);
      descriptionValue = descriptionResult.value;
    }

    let amountValue = amount;
    if (amount !== undefined) {
      const amountResult = optionalLocalizedPositiveNumber(amount, 'amount');
      if (!amountResult.ok) return badRequest(reply, amountResult.message);
      amountValue = amountResult.value;
    }

    let expenseDateValue = expenseDate;
    if (expenseDate !== undefined) {
      const expenseDateResult = optionalDateString(expenseDate, 'expenseDate');
      if (!expenseDateResult.ok) return badRequest(reply, expenseDateResult.message);
      expenseDateValue = expenseDateResult.value;
    }

    let categoryValue = category;
    if (category !== undefined) {
      const categoryResult = optionalNonEmptyString(category, 'category');
      if (!categoryResult.ok) return badRequest(reply, categoryResult.message);
      categoryValue = categoryResult.value;
    }

    let vendorValue = vendor;
    if (vendor !== undefined) {
      const vendorResult = optionalNonEmptyString(vendor, 'vendor');
      if (!vendorResult.ok) return badRequest(reply, vendorResult.message);
      vendorValue = vendorResult.value;
    }

    let receiptReferenceValue = receiptReference;
    if (receiptReference !== undefined) {
      const receiptReferenceResult = optionalNonEmptyString(receiptReference, 'receiptReference');
      if (!receiptReferenceResult.ok) return badRequest(reply, receiptReferenceResult.message);
      receiptReferenceValue = receiptReferenceResult.value;
    }

    let notesValue = notes;
    if (notes !== undefined) {
      const notesResult = optionalNonEmptyString(notes, 'notes');
      if (!notesResult.ok) return badRequest(reply, notesResult.message);
      notesValue = notesResult.value;
    }

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
      [
        descriptionValue,
        amountValue,
        expenseDateValue,
        categoryValue,
        vendorValue,
        receiptReferenceValue,
        notesValue,
        idResult.value,
      ],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Expense not found' });
    }

    const expense = result.rows[0];
    return {
      ...expense,
      amount: parseFloat(expense.amount),
      expenseDate: new Date(expense.expenseDate).toISOString().split('T')[0],
    };
  });

  // DELETE /:id - Delete expense
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const idResult = requireNonEmptyString(id, 'id');
    if (!idResult.ok) return badRequest(reply, idResult.message);

    const result = await query('DELETE FROM expenses WHERE id = $1 RETURNING id', [idResult.value]);

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Expense not found' });
    }

    return reply.code(204).send();
  });
}
