import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import { requireNonEmptyString, optionalNonEmptyString, parseDateString, optionalDateString, parsePositiveNumber, parseNonNegativeNumber, optionalNonNegativeNumber, badRequest } from '../utils/validation.ts';

export default async function (fastify, opts) {
    // All quote routes require manager role
    fastify.addHook('onRequest', authenticateToken);
    fastify.addHook('onRequest', requireRole('manager'));

    const isQuoteExpired = (status, expirationDate) => {
        if (status === 'confirmed') return false;
        const normalizedDate = expirationDate.includes('T') ? expirationDate : `${expirationDate}T00:00:00`;
        const expiry = new Date(normalizedDate);
        expiry.setDate(expiry.getDate() + 1);
        return new Date() >= expiry;
    };

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
            items: itemsByQuote[quote.id] || [],
            isExpired: isQuoteExpired(quote.status, quote.expirationDate)
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

        const normalizedItems = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const productNameResult = requireNonEmptyString(item.productName, `items[${i}].productName`);
            if (!productNameResult.ok) return badRequest(reply, productNameResult.message);
            const quantityResult = parsePositiveNumber(item.quantity, `items[${i}].quantity`);
            if (!quantityResult.ok) return badRequest(reply, quantityResult.message);
            const unitPriceResult = parseNonNegativeNumber(item.unitPrice, `items[${i}].unitPrice`);
            if (!unitPriceResult.ok) return badRequest(reply, unitPriceResult.message);
            normalizedItems.push({
                ...item,
                productName: productNameResult.value,
                quantity: quantityResult.value,
                unitPrice: unitPriceResult.value
            });
        }

        const expirationDateResult = parseDateString(expirationDate, 'expirationDate');
        if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);

        const discountResult = optionalNonNegativeNumber(discount, 'discount');
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
            [quoteId, clientIdResult.value, clientNameResult.value, paymentTerms || 'immediate', discountResult.value || 0, status || 'quoted', expirationDateResult.value, notes]
        );

        // Insert quote items
        const createdItems = [];
        for (const item of normalizedItems) {
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
            items: createdItems,
            isExpired: isQuoteExpired(quoteResult.rows[0].status, quoteResult.rows[0].expirationDate)
        });
    });

    // PUT /:id - Update quote
    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params;
        const { clientId, clientName, items, paymentTerms, discount, status, expirationDate, notes } = request.body;
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);

        let clientIdValue = clientId;
        if (clientId !== undefined) {
            const clientIdResult = optionalNonEmptyString(clientId, 'clientId');
            if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);
            clientIdValue = clientIdResult.value;
        }

        let clientNameValue = clientName;
        if (clientName !== undefined) {
            const clientNameResult = optionalNonEmptyString(clientName, 'clientName');
            if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);
            clientNameValue = clientNameResult.value;
        }

        let expirationDateValue = expirationDate;
        if (expirationDate !== undefined) {
            const expirationDateResult = optionalDateString(expirationDate, 'expirationDate');
            if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);
            expirationDateValue = expirationDateResult.value;
        }

        let discountValue = discount;
        if (discount !== undefined) {
            const discountResult = optionalNonNegativeNumber(discount, 'discount');
            if (!discountResult.ok) return badRequest(reply, discountResult.message);
            discountValue = discountResult.value;
        }

        if (status === 'quoted') {
            const linkedSaleResult = await query(
                'SELECT id FROM sales WHERE linked_quote_id = $1 LIMIT 1',
                [idResult.value]
            );
            if (linkedSaleResult.rows.length > 0) {
                return reply.code(409).send({ error: 'Cannot revert quote with existing sale orders' });
            }
        }

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
            [clientIdValue, clientNameValue, paymentTerms, discountValue, status, expirationDateValue, notes, idResult.value]
        );

        if (quoteResult.rows.length === 0) {
            return reply.code(404).send({ error: 'Quote not found' });
        }

        // If items are provided, update them
        let updatedItems = [];
        if (items) {
            if (!Array.isArray(items) || items.length === 0) {
                return badRequest(reply, 'Items must be a non-empty array');
            }
            const normalizedItems = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const productNameResult = requireNonEmptyString(item.productName, `items[${i}].productName`);
                if (!productNameResult.ok) return badRequest(reply, productNameResult.message);
                const quantityResult = parsePositiveNumber(item.quantity, `items[${i}].quantity`);
                if (!quantityResult.ok) return badRequest(reply, quantityResult.message);
                const unitPriceResult = parseNonNegativeNumber(item.unitPrice, `items[${i}].unitPrice`);
                if (!unitPriceResult.ok) return badRequest(reply, unitPriceResult.message);
                normalizedItems.push({
                    ...item,
                    productName: productNameResult.value,
                    quantity: quantityResult.value,
                    unitPrice: unitPriceResult.value
                });
            }
            // Delete existing items
            await query('DELETE FROM quote_items WHERE quote_id = $1', [idResult.value]);

            // Insert new items
            for (const item of normalizedItems) {
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
                    [itemId, idResult.value, item.productId, item.productName, item.specialBidId || null, item.quantity, item.unitPrice, item.discount || 0, item.note || null]
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
                [idResult.value]
            );
            updatedItems = itemsResult.rows;
        }

        return {
            ...quoteResult.rows[0],
            items: updatedItems,
            isExpired: isQuoteExpired(quoteResult.rows[0].status, quoteResult.rows[0].expirationDate)
        };
    });

    // DELETE /:id - Delete quote
    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params;
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);

        const statusResult = await query('SELECT status FROM quotes WHERE id = $1', [idResult.value]);
        if (statusResult.rows.length === 0) {
            return reply.code(404).send({ error: 'Quote not found' });
        }
        if (statusResult.rows[0].status === 'confirmed') {
            return reply.code(409).send({ error: 'Cannot delete a confirmed quote' });
        }

        // Items will be deleted automatically via CASCADE
        await query('DELETE FROM quotes WHERE id = $1 RETURNING id', [idResult.value]);

        return reply.code(204).send();
    });
}
