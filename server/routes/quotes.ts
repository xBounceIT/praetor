import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import { requireNonEmptyString, parseDateString, parsePositiveNumber, parseNonNegativeNumber, badRequest } from '../utils/validation.ts';

export default async function (fastify, opts) {
    // All quote routes require at least manager role
    fastify.addHook('onRequest', authenticateToken);
    fastify.addHook('onRequest', requireRole('admin', 'manager'));

    // GET / - List all quotes with their items
    fastify.get('/', async (request, reply) => {
        // Get all quotes
        const quotesResult = await query(
            `SELECT 
                id, 
                client_id as "clientId", 
                client_name as "clientName", 
                payment_terms as "paymentTerms", 
                discount, 
                status, 
                expiration_date as "expirationDate", 
                notes,
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
            FROM quotes 
            ORDER BY created_at DESC`
        );

        // Get all quote items
        const itemsResult = await query(
            `SELECT 
                id,
                quote_id as "quoteId",
                product_id as "productId",
                product_name as "productName",
                special_bid_id as "specialBidId",
                quantity,
                unit_price as "unitPrice",
                discount,
                note
            FROM quote_items
            ORDER BY created_at ASC`
        );

        // Group items by quote
        const itemsByQuote = {};
        itemsResult.rows.forEach(item => {
            if (!itemsByQuote[item.quoteId]) {
                itemsByQuote[item.quoteId] = [];
            }
            itemsByQuote[item.quoteId].push(item);
        });

        // Attach items to quotes
        const quotes = quotesResult.rows.map(quote => ({
            ...quote,
            items: itemsByQuote[quote.id] || []
        }));

        return quotes;
    });

    // POST / - Create quote with items
    fastify.post('/', async (request, reply) => {
        const { clientId, clientName, items, paymentTerms, discount, status, expirationDate, notes } = request.body;

        const clientIdResult = requireNonEmptyString(clientId, 'clientId');
        if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

        const clientNameResult = requireNonEmptyString(clientName, 'clientName');
        if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);

        if (!Array.isArray(items) || items.length === 0) {
            return badRequest(reply, 'Items must be a non-empty array');
        }

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const productNameResult = requireNonEmptyString(item.productName, `items[${i}].productName`);
            if (!productNameResult.ok) return badRequest(reply, productNameResult.message);
            const quantityResult = parsePositiveNumber(item.quantity, `items[${i}].quantity`);
            if (!quantityResult.ok) return badRequest(reply, quantityResult.message);
            const unitPriceResult = parseNonNegativeNumber(item.unitPrice, `items[${i}].unitPrice`);
            if (!unitPriceResult.ok) return badRequest(reply, unitPriceResult.message);
        }

        const expirationDateResult = parseDateString(expirationDate, 'expirationDate');
        if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);

        const discountResult = parseNonNegativeNumber(discount, 'discount');
        if (!discountResult.ok) return badRequest(reply, discountResult.message);

        const quoteId = 'q-' + Date.now();

        // Insert quote
        const quoteResult = await query(
            `INSERT INTO quotes (id, client_id, client_name, payment_terms, discount, status, expiration_date, notes) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
             RETURNING 
                id, 
                client_id as "clientId", 
                client_name as "clientName", 
                payment_terms as "paymentTerms", 
                discount, 
                status, 
                expiration_date as "expirationDate", 
                notes,
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
            [quoteId, clientId, clientName, paymentTerms || 'immediate', discount || 0, status || 'quoted', expirationDate, notes]
        );

        // Insert quote items
        const createdItems = [];
        for (const item of items) {
            const itemId = 'qi-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            const itemResult = await query(
                `INSERT INTO quote_items (id, quote_id, product_id, product_name, special_bid_id, quantity, unit_price, discount, note) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
                 RETURNING 
                    id,
                    quote_id as "quoteId",
                    product_id as "productId",
                    product_name as "productName",
                    special_bid_id as "specialBidId",
                    quantity,
                    unit_price as "unitPrice",
                    discount,
                    note`,
                [itemId, quoteId, item.productId, item.productName, item.specialBidId || null, item.quantity, item.unitPrice, item.discount || 0, item.note || null]
            );
            createdItems.push(itemResult.rows[0]);
        }

        return reply.code(201).send({
            ...quoteResult.rows[0],
            items: createdItems
        });
    });

    // PUT /:id - Update quote
    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params;
        const { clientId, clientName, items, paymentTerms, discount, status, expirationDate, notes } = request.body;

        // Update quote
        const quoteResult = await query(
            `UPDATE quotes 
             SET client_id = COALESCE($1, client_id),
                 client_name = COALESCE($2, client_name),
                 payment_terms = COALESCE($3, payment_terms),
                 discount = COALESCE($4, discount),
                 status = COALESCE($5, status),
                 expiration_date = COALESCE($6, expiration_date),
                 notes = COALESCE($7, notes),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $8 
             RETURNING 
                id, 
                client_id as "clientId", 
                client_name as "clientName", 
                payment_terms as "paymentTerms", 
                discount, 
                status, 
                expiration_date as "expirationDate", 
                notes,
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
            [clientId, clientName, paymentTerms, discount, status, expirationDate, notes, id]
        );

        if (quoteResult.rows.length === 0) {
            return reply.code(404).send({ error: 'Quote not found' });
        }

        // If items are provided, update them
        let updatedItems = [];
        if (items) {
            // Delete existing items
            await query('DELETE FROM quote_items WHERE quote_id = $1', [id]);

            // Insert new items
            for (const item of items) {
                const itemId = 'qi-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                const itemResult = await query(
                    `INSERT INTO quote_items (id, quote_id, product_id, product_name, special_bid_id, quantity, unit_price, discount, note) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
                     RETURNING 
                        id,
                        quote_id as "quoteId",
                        product_id as "productId",
                        product_name as "productName",
                        special_bid_id as "specialBidId",
                        quantity,
                        unit_price as "unitPrice",
                        discount,
                        note`,
                    [itemId, id, item.productId, item.productName, item.specialBidId || null, item.quantity, item.unitPrice, item.discount || 0, item.note || null]
                );
                updatedItems.push(itemResult.rows[0]);
            }
        } else {
            // Fetch existing items
            const itemsResult = await query(
                `SELECT 
                    id,
                    quote_id as "quoteId",
                    product_id as "productId",
                    product_name as "productName",
                    special_bid_id as "specialBidId",
                    quantity,
                    unit_price as "unitPrice",
                    discount,
                    note
                FROM quote_items
                WHERE quote_id = $1`,
                [id]
            );
            updatedItems = itemsResult.rows;
        }

        return {
            ...quoteResult.rows[0],
            items: updatedItems
        };
    });

    // DELETE /:id - Delete quote
    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params;

        // Items will be deleted automatically via CASCADE
        const result = await query('DELETE FROM quotes WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Quote not found' });
        }

        return reply.code(204).send();
    });
}
