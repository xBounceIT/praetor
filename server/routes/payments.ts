import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses } from '../schemas/common.ts';
import {
  badRequest,
  optionalDateString,
  optionalLocalizedPositiveNumber,
  optionalNonEmptyString,
  parseDateString,
  parseLocalizedPositiveNumber,
  requireNonEmptyString,
} from '../utils/validation.ts';

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const paymentSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    invoiceId: { type: ['string', 'null'] },
    clientId: { type: 'string' },
    amount: { type: 'number' },
    paymentDate: { type: 'string', format: 'date' },
    paymentMethod: { type: ['string', 'null'] },
    reference: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
  },
  required: ['id', 'clientId', 'amount', 'paymentDate', 'createdAt'],
} as const;

const paymentCreateBodySchema = {
  type: 'object',
  properties: {
    invoiceId: { type: 'string' },
    clientId: { type: 'string' },
    amount: { type: 'number' },
    paymentDate: { type: 'string', format: 'date' },
    paymentMethod: { type: 'string' },
    reference: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['clientId', 'amount', 'paymentDate'],
} as const;

const paymentUpdateBodySchema = {
  type: 'object',
  properties: {
    amount: { type: 'number' },
    paymentDate: { type: 'string', format: 'date' },
    paymentMethod: { type: 'string' },
    reference: { type: 'string' },
    notes: { type: 'string' },
  },
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // All payments routes require authentication
  fastify.addHook('onRequest', authenticateToken);

  // GET / - List all payments
  fastify.get(
    '/',
    {
      onRequest: [requirePermission('finances.payments.view')],
      schema: {
        tags: ['payments'],
        summary: 'List payments',
        response: {
          200: { type: 'array', items: paymentSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (_request, _reply) => {
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
            ORDER BY created_at DESC`,
      );

      // Fetch client names separately or via join could be better, but consistent with other endpoints to fetch IDs and names
      // Ideally we join, but for now let's return what we have. The frontend often has client list to map names.
      // Actually, let's left join clients to get client name if needed, but existing `payments` table doesn't store client_name cache like others.
      // We stored client_id.

      const payments = result.rows.map((payment) => ({
        ...payment,
        amount: parseFloat(payment.amount),
        paymentDate: payment.paymentDate.toISOString().split('T')[0],
      }));

      return payments;
    },
  );

  // POST / - Create payment
  fastify.post(
    '/',
    {
      onRequest: [requirePermission('finances.payments.create')],
      schema: {
        tags: ['payments'],
        summary: 'Create payment',
        body: paymentCreateBodySchema,
        response: {
          201: paymentSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { invoiceId, clientId, amount, paymentDate, paymentMethod, reference, notes } =
        request.body as {
          invoiceId: unknown;
          clientId: unknown;
          amount: unknown;
          paymentDate: unknown;
          paymentMethod: unknown;
          reference: unknown;
          notes: unknown;
        };

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

      const invoiceIdResult = optionalNonEmptyString(invoiceId, 'invoiceId');
      if (!invoiceIdResult.ok) return badRequest(reply, invoiceIdResult.message);

      const amountResult = parseLocalizedPositiveNumber(amount, 'amount');
      if (!amountResult.ok) return badRequest(reply, amountResult.message);

      const paymentDateResult = parseDateString(paymentDate, 'paymentDate');
      if (!paymentDateResult.ok) return badRequest(reply, paymentDateResult.message);

      const paymentMethodResult = optionalNonEmptyString(paymentMethod, 'paymentMethod');
      if (!paymentMethodResult.ok) return badRequest(reply, paymentMethodResult.message);

      const referenceResult = optionalNonEmptyString(reference, 'reference');
      if (!referenceResult.ok) return badRequest(reply, referenceResult.message);

      const notesResult = optionalNonEmptyString(notes, 'notes');
      if (!notesResult.ok) return badRequest(reply, notesResult.message);

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
            paymentId,
            invoiceIdResult.value,
            clientIdResult.value,
            amountResult.value,
            paymentDateResult.value,
            paymentMethodResult.value || 'bank_transfer',
            referenceResult.value,
            notesResult.value,
          ],
        );

        // If linked to an invoice, update the invoice's amount_paid and status
        if (invoiceId) {
          // Get current invoice totals
          const invoiceRes = await query(
            'SELECT total, amount_paid FROM invoices WHERE id = $1 FOR UPDATE',
            [invoiceId],
          );

          if (invoiceRes.rows.length > 0) {
            const inv = invoiceRes.rows[0];
            const newAmountPaid = parseFloat(inv.amount_paid) + parseFloat(String(amount));
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
              [newAmountPaid, newStatus, invoiceId],
            );
          }
        }

        await query('COMMIT');

        const payment = result.rows[0];
        return reply.code(201).send({
          ...payment,
          amount: parseFloat(payment.amount),
          paymentDate: new Date(payment.paymentDate).toISOString().split('T')[0],
        });
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }
    },
  );

  // PUT /:id - Update payment
  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('finances.payments.update')],
      schema: {
        tags: ['payments'],
        summary: 'Update payment',
        params: idParamSchema,
        body: paymentUpdateBodySchema,
        response: {
          200: paymentSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { amount, paymentDate, paymentMethod, reference, notes } = request.body as {
        amount: unknown;
        paymentDate: unknown;
        paymentMethod: unknown;
        reference: unknown;
        notes: unknown;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const amountResult = optionalLocalizedPositiveNumber(amount, 'amount');
      if (!amountResult.ok) return badRequest(reply, amountResult.message);

      const paymentDateResult = optionalDateString(paymentDate, 'paymentDate');
      if (!paymentDateResult.ok) return badRequest(reply, paymentDateResult.message);

      const paymentMethodResult = optionalNonEmptyString(paymentMethod, 'paymentMethod');
      if (!paymentMethodResult.ok) return badRequest(reply, paymentMethodResult.message);

      const referenceResult = optionalNonEmptyString(reference, 'reference');
      if (!referenceResult.ok) return badRequest(reply, referenceResult.message);

      const notesResult = optionalNonEmptyString(notes, 'notes');
      if (!notesResult.ok) return badRequest(reply, notesResult.message);
      // Note: We generally don't allow changing the linked invoice or client easily because of the math.
      // For simplicity, let's allow updating metadata but if amount changes, we need to adjust invoice.

      // Detailed implementation of amount adjustment on invoice is complex without previous value.
      // For now, let's implement basic update. If amount needs change, delete and recreate is safer,
      // or we fetch old amount first.

      try {
        await query('BEGIN');

        const oldPaymentRes = await query('SELECT invoice_id, amount FROM payments WHERE id = $1', [
          idResult.value,
        ]);
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
          [
            amountResult.value,
            paymentDateResult.value,
            paymentMethodResult.value,
            referenceResult.value,
            notesResult.value,
            idResult.value,
          ],
        );

        const updatedPayment = result.rows[0];
        const newAmount = parseFloat(updatedPayment.amount);

        // Update invoice balance if amount changed and invoice is linked
        if (updatedPayment.invoiceId && newAmount !== oldAmount) {
          const diff = newAmount - oldAmount;

          const invoiceRes = await query(
            'SELECT total, amount_paid FROM invoices WHERE id = $1 FOR UPDATE',
            [updatedPayment.invoiceId],
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
              [newTotalPaid, newStatus, updatedPayment.invoiceId],
            );
          }
        }

        await query('COMMIT');

        return {
          ...updatedPayment,
          amount: parseFloat(updatedPayment.amount),
          paymentDate: new Date(updatedPayment.paymentDate).toISOString().split('T')[0],
        };
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }
    },
  );

  // DELETE /:id - Delete payment
  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('finances.payments.delete')],
      schema: {
        tags: ['payments'],
        summary: 'Delete payment',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as unknown as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      try {
        await query('BEGIN');

        const paymentRes = await query(
          'SELECT invoice_id, amount FROM payments WHERE id = $1 FOR UPDATE',
          [idResult.value],
        );
        if (paymentRes.rows.length === 0) {
          await query('ROLLBACK');
          return reply.code(404).send({ error: 'Payment not found' });
        }

        const { invoice_id, amount } = paymentRes.rows[0];

        await query('DELETE FROM payments WHERE id = $1', [idResult.value]);

        // Reverse invoice balance
        if (invoice_id) {
          const invoiceRes = await query(
            'SELECT total, amount_paid FROM invoices WHERE id = $1 FOR UPDATE',
            [invoice_id],
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
              [newTotalPaid, newStatus, invoice_id],
            );
          }
        }

        await query('COMMIT');
        return reply.code(204).send();
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }
    },
  );
}
