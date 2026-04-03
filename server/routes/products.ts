import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query, withTransaction } from '../db/index.ts';
import { authenticateToken, requireAnyPermission } from '../middleware/auth.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import {
  bumpNamespaceVersion,
  cacheGetSetJson,
  setCacheHeader,
  shouldBypassCache,
  TTL_LIST_SECONDS,
} from '../services/cache.ts';
import { logAudit } from '../utils/audit.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  badRequest,
  parseBoolean,
  parseLocalizedNonNegativeNumber,
  requireNonEmptyString,
  validateEnum,
} from '../utils/validation.ts';

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const productSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    productCode: { type: 'string' },
    description: { type: ['string', 'null'] },
    costo: { type: 'number' },
    molPercentage: { type: 'number' },
    costUnit: { type: 'string', enum: ['unit', 'hours'] },
    category: { type: ['string', 'null'] },
    subcategory: { type: ['string', 'null'] },
    taxRate: { type: 'number' },
    type: { type: 'string' },
    supplierId: { type: ['string', 'null'] },
    supplierName: { type: ['string', 'null'] },
    isDisabled: { type: 'boolean' },
  },
  required: ['id', 'name', 'productCode', 'costo', 'molPercentage', 'costUnit', 'taxRate', 'type'],
} as const;

const productCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    productCode: { type: 'string' },
    description: { type: 'string' },
    costo: { type: 'number' },
    molPercentage: { type: 'number' },
    category: { type: 'string' },
    subcategory: { type: 'string' },
    taxRate: { type: 'number' },
    type: { type: 'string' },
    supplierId: { type: 'string' },
    costUnit: { type: 'string', enum: ['unit', 'hours'] },
  },
  required: ['name', 'productCode', 'costo', 'molPercentage', 'taxRate', 'type'],
} as const;

const productUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    productCode: { type: 'string' },
    description: { type: 'string' },
    costo: { type: 'number' },
    molPercentage: { type: 'number' },
    category: { type: 'string' },
    subcategory: { type: 'string' },
    taxRate: { type: 'number' },
    type: { type: 'string' },
    supplierId: { type: 'string' },
    costUnit: { type: 'string', enum: ['unit', 'hours'] },
    isDisabled: { type: 'boolean' },
  },
} as const;

const getCostUnitForType = async (typeName: string): Promise<'unit' | 'hours'> => {
  const result = await query('SELECT cost_unit FROM product_types WHERE name = $1', [typeName]);
  if (result.rows.length > 0) {
    return result.rows[0].cost_unit;
  }
  // Default fallback for backward compatibility or orphaned types
  return typeName === 'service' || typeName === 'consulting' ? 'hours' : 'unit';
};

// Helper to validate that a type exists in product_types table
const requireValidType = async (
  typeName: unknown,
): Promise<{ ok: true; value: string } | { ok: false; message: string }> => {
  if (typeName === undefined || typeName === null || typeName === '') {
    return { ok: false, message: 'type is required' };
  }
  if (typeof typeName !== 'string') {
    return { ok: false, message: 'type must be a string' };
  }
  const trimmed = typeName.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: 'type is required' };
  }
  // Check if type exists in product_types
  const result = await query('SELECT 1 FROM product_types WHERE name = $1', [trimmed]);
  if (result.rows.length === 0) {
    return {
      ok: false,
      message: `Invalid type "${trimmed}". Type must be a registered product type.`,
    };
  }
  return { ok: true, value: trimmed };
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // All product routes require authentication
  fastify.addHook('onRequest', authenticateToken);

  // GET / - List all products
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requireAnyPermission(
          'catalog.internal_listing.view',
          'catalog.external_listing.view',
          'catalog.special_bids.view',
          'sales.supplier_quotes.view',
          'sales.supplier_offers.view',
          'sales.client_offers.view',
          'accounting.supplier_orders.view',
          'accounting.supplier_invoices.view',
        ),
      ],
      schema: {
        tags: ['products'],
        summary: 'List products',
        response: {
          200: { type: 'array', items: productSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const bypass = shouldBypassCache(request);
      const { status, value } = await cacheGetSetJson(
        'products',
        'v=1',
        TTL_LIST_SECONDS,
        async () => {
          const result = await query(
            `SELECT p.id, p.name, p.product_code as "productCode", p.description, p.costo, p.mol_percentage as "molPercentage", p.cost_unit as "costUnit", p.category, p.subcategory, p.tax_rate as "taxRate", p.type, p.supplier_id as "supplierId", s.name as "supplierName", p.is_disabled as "isDisabled" 
             FROM products p 
             LEFT JOIN suppliers s ON p.supplier_id = s.id 
             ORDER BY p.name ASC`,
          );
          return result.rows;
        },
        { bypass },
      );

      setCacheHeader(reply, status);
      return value;
    },
  );

  // POST / - Create product
  fastify.post(
    '/',
    {
      onRequest: [
        requireAnyPermission('catalog.internal_listing.create', 'catalog.external_listing.create'),
      ],
      schema: {
        tags: ['products'],
        summary: 'Create product',
        body: productCreateBodySchema,
        response: {
          201: productSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        name,
        productCode,
        description,
        costo,
        molPercentage,
        category,
        subcategory,
        taxRate,
        type,
        supplierId,
        costUnit,
      } = request.body as {
        name: unknown;
        productCode: unknown;
        description: unknown;
        costo: unknown;
        molPercentage: unknown;
        category: unknown;
        subcategory: unknown;
        taxRate: unknown;
        type: unknown;
        supplierId: unknown;
        costUnit: unknown;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      // check name uniqueness
      const existingName = await query('SELECT id FROM products WHERE LOWER(name) = LOWER($1)', [
        nameResult.value,
      ]);
      if (existingName.rows.length > 0) {
        return badRequest(reply, 'Product name must be unique');
      }

      // Validate product code
      const productCodeResult = requireNonEmptyString(productCode, 'productCode');
      if (!productCodeResult.ok) return badRequest(reply, productCodeResult.message);

      // Check product code format (alphanumeric, underscores, hyphens only)
      if (!/^[a-zA-Z0-9_-]+$/.test(productCodeResult.value)) {
        return badRequest(
          reply,
          'Product code can only contain letters, numbers, underscores, and hyphens',
        );
      }

      // Check product code uniqueness
      const existingCode = await query('SELECT id FROM products WHERE product_code = $1', [
        productCodeResult.value,
      ]);
      if (existingCode.rows.length > 0) {
        return badRequest(reply, 'Product code must be unique');
      }

      if (costo === undefined || costo === null || costo === '') {
        return badRequest(reply, 'costo is required');
      }
      const costoResult = parseLocalizedNonNegativeNumber(costo, 'costo');
      if (!costoResult.ok) return badRequest(reply, costoResult.message);

      if (molPercentage === undefined || molPercentage === null || molPercentage === '') {
        return badRequest(reply, 'molPercentage is required');
      }
      const molPercentageResult = parseLocalizedNonNegativeNumber(molPercentage, 'molPercentage');
      if (!molPercentageResult.ok) return badRequest(reply, molPercentageResult.message);
      if (molPercentageResult.value <= 0 || molPercentageResult.value >= 100) {
        return badRequest(reply, 'molPercentage must be greater than 0 and less than 100');
      }

      if (taxRate === undefined || taxRate === null || taxRate === '') {
        return badRequest(reply, 'taxRate is required');
      }
      const taxRateResult = parseLocalizedNonNegativeNumber(taxRate, 'taxRate');
      if (!taxRateResult.ok) return badRequest(reply, taxRateResult.message);
      if (taxRateResult.value < 0 || taxRateResult.value > 100) {
        return badRequest(reply, 'taxRate must be between 0 and 100');
      }

      if (type === undefined || type === null || type === '') {
        return badRequest(reply, 'type is required');
      }
      // Validate type exists in product_types table
      const typeResult = await requireValidType(type);
      if (!typeResult.ok) return badRequest(reply, typeResult.message);

      // Internal products always derive their unit from type.
      // External products keep their explicitly configured unit.
      let expectedCostUnit: string;
      if (supplierId) {
        const costUnitResult = validateEnum(costUnit, ['unit', 'hours'], 'costUnit');
        expectedCostUnit = costUnitResult.ok
          ? costUnitResult.value
          : await getCostUnitForType(typeResult.value);
      } else {
        expectedCostUnit = await getCostUnitForType(typeResult.value);
      }

      const id = 'p-' + Date.now();
      const result = await query(
        `INSERT INTO products (id, name, product_code, description, costo, mol_percentage, cost_unit, category, subcategory, tax_rate, type, supplier_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
             RETURNING id, name, product_code as "productCode", description, costo, mol_percentage as "molPercentage", cost_unit as "costUnit", category, subcategory, tax_rate as "taxRate", type, supplier_id as "supplierId"`,
        [
          id,
          nameResult.value,
          productCodeResult.value,
          description || null,
          costoResult.value,
          molPercentageResult.value,
          expectedCostUnit,
          category,
          subcategory,
          taxRateResult.value,
          typeResult.value,
          supplierId || null,
        ],
      );

      // If supplier was assigned, fetch supplier name
      if (supplierId) {
        const supplierResult = await query('SELECT name FROM suppliers WHERE id = $1', [
          supplierId,
        ]);
        if (supplierResult.rows.length > 0) {
          result.rows[0].supplierName = supplierResult.rows[0].name;
        }
      }

      await bumpNamespaceVersion('products');
      await logAudit({
        request,
        action: 'product.created',
        entityType: 'product',
        entityId: id,
        details: {
          targetLabel: result.rows[0].name as string,
          secondaryLabel: result.rows[0].productCode as string,
        },
      });
      return reply.code(201).send(result.rows[0]);
    },
  );

  // PUT /:id - Update product
  fastify.put(
    '/:id',
    {
      onRequest: [
        requireAnyPermission('catalog.internal_listing.update', 'catalog.external_listing.update'),
      ],
      schema: {
        tags: ['products'],
        summary: 'Update product',
        params: idParamSchema,
        body: productUpdateBodySchema,
        response: {
          200: productSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: unknown;
        productCode?: unknown;
        description?: unknown;
        costo?: unknown;
        molPercentage?: unknown;
        category?: unknown;
        subcategory?: unknown;
        taxRate?: unknown;
        type?: unknown;
        supplierId?: unknown;
        costUnit?: unknown;
        isDisabled?: unknown;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const fields: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      // Name
      if (body.name !== undefined) {
        const nameResult = requireNonEmptyString(body.name, 'name'); // name cannot be empty for update if provided
        if (!nameResult.ok) return badRequest(reply, nameResult.message);

        // check name uniqueness (exclude current product)
        const existingName = await query(
          'SELECT id FROM products WHERE LOWER(name) = LOWER($1) AND id != $2',
          [nameResult.value, idResult.value],
        );
        if (existingName.rows.length > 0) {
          return badRequest(reply, 'Product name must be unique');
        }
        fields.push(`name = $${paramIndex++}`);
        values.push(nameResult.value);
      }

      // Product Code
      if (body.productCode !== undefined) {
        const productCodeResult = requireNonEmptyString(body.productCode, 'productCode');
        if (!productCodeResult.ok) return badRequest(reply, productCodeResult.message);

        // Check product code format (alphanumeric, underscores, hyphens only)
        if (!/^[a-zA-Z0-9_-]+$/.test(productCodeResult.value)) {
          return badRequest(
            reply,
            'Product code can only contain letters, numbers, underscores, and hyphens',
          );
        }

        // Check product code uniqueness (exclude current product)
        const existingCode = await query(
          'SELECT id FROM products WHERE product_code = $1 AND id != $2',
          [productCodeResult.value, idResult.value],
        );
        if (existingCode.rows.length > 0) {
          return badRequest(reply, 'Product code must be unique');
        }
        fields.push(`product_code = $${paramIndex++}`);
        values.push(productCodeResult.value);
      }

      // Description (nullable)
      if (body.description !== undefined) {
        fields.push(`description = $${paramIndex++}`);
        values.push(body.description || null);
      }

      // Costo
      if (body.costo !== undefined) {
        const costoResult = parseLocalizedNonNegativeNumber(body.costo, 'costo');
        if (!costoResult.ok) return badRequest(reply, costoResult.message);
        fields.push(`costo = $${paramIndex++}`);
        values.push(costoResult.value);
      }

      // Mol Percentage
      if (body.molPercentage !== undefined) {
        const molPercentageResult = parseLocalizedNonNegativeNumber(
          body.molPercentage,
          'molPercentage',
        );
        if (!molPercentageResult.ok) return badRequest(reply, molPercentageResult.message);
        if (molPercentageResult.value <= 0 || molPercentageResult.value >= 100) {
          return badRequest(reply, 'molPercentage must be greater than 0 and less than 100');
        }
        fields.push(`mol_percentage = $${paramIndex++}`);
        values.push(molPercentageResult.value);
      }

      // Tax Rate
      if (body.taxRate !== undefined) {
        const taxRateResult = parseLocalizedNonNegativeNumber(body.taxRate, 'taxRate');
        if (!taxRateResult.ok) return badRequest(reply, taxRateResult.message);
        if (taxRateResult.value < 0 || taxRateResult.value > 100) {
          return badRequest(reply, 'taxRate must be between 0 and 100');
        }
        fields.push(`tax_rate = $${paramIndex++}`);
        values.push(taxRateResult.value);
      }

      // Get current product info to determine if internal or external
      const currentProductQuery = await query(
        'SELECT type, supplier_id, category FROM products WHERE id = $1',
        [idResult.value],
      );
      const currentProduct = currentProductQuery.rows[0] || {
        type: null,
        supplier_id: null,
        category: null,
      };

      // Type - when type changes, handle costUnit appropriately
      let updatedType = currentProduct.type;
      const updatedSupplierId =
        body.supplierId !== undefined
          ? body.supplierId
            ? body.supplierId
            : null
          : currentProduct.supplier_id;

      if (body.type !== undefined) {
        const typeResult = await requireValidType(body.type);
        if (!typeResult.ok) return badRequest(reply, typeResult.message);
        fields.push(`type = $${paramIndex++}`);
        values.push(typeResult.value);
        updatedType = typeResult.value;
      }

      // Category update
      if (body.category !== undefined) {
        fields.push(`category = $${paramIndex++}`);
        values.push(body.category || null);
      }

      // Subcategory update
      if (body.subcategory !== undefined) {
        fields.push(`subcategory = $${paramIndex++}`);
        values.push(body.subcategory || null);
      }

      // Supplier update (nullable)
      if (body.supplierId !== undefined) {
        fields.push(`supplier_id = $${paramIndex++}`);
        values.push(body.supplierId ? body.supplierId : null);
      }

      // Internal products always derive their unit from type.
      // External products keep an explicitly configurable unit.
      const isExternal = updatedSupplierId !== null;
      const costUnitRelevantFieldsChanged =
        body.type !== undefined || body.category !== undefined || body.supplierId !== undefined;
      let costUnitToSet: string | null = null;

      if (!isExternal && costUnitRelevantFieldsChanged) {
        costUnitToSet = await getCostUnitForType(updatedType);
        fields.push(`cost_unit = $${paramIndex++}`);
        values.push(costUnitToSet);
      } else if (isExternal && body.costUnit !== undefined) {
        // External product: accept costUnit from request body
        const costUnitResult = validateEnum(body.costUnit, ['unit', 'hours'], 'costUnit');
        if (!costUnitResult.ok) return badRequest(reply, costUnitResult.message);
        fields.push(`cost_unit = $${paramIndex++}`);
        values.push(costUnitResult.value);
      }

      // Is Disabled
      if (body.isDisabled !== undefined) {
        fields.push(`is_disabled = $${paramIndex++}`);
        values.push(parseBoolean(body.isDisabled));
      }

      if (fields.length === 0) {
        // No updates
        const result = await query(
          `SELECT id, name, product_code as "productCode", description, costo, mol_percentage as "molPercentage", cost_unit as "costUnit", category, subcategory, tax_rate as "taxRate", type, is_disabled as "isDisabled", supplier_id as "supplierId" 
                 FROM products WHERE id = $1`,
          [idResult.value],
        );
        if (result.rows.length === 0) return reply.code(404).send({ error: 'Product not found' });

        // Populate supplier name if needed
        if (result.rows[0].supplierId) {
          const supplierResult = await query('SELECT name FROM suppliers WHERE id = $1', [
            result.rows[0].supplierId,
          ]);
          if (supplierResult.rows.length > 0) {
            result.rows[0].supplierName = supplierResult.rows[0].name;
          }
        }
        return result.rows[0];
      }

      values.push(idResult.value); // Add ID as last parameter
      const queryText = `
            UPDATE products 
            SET ${fields.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING id, name, product_code as "productCode", description, costo, mol_percentage as "molPercentage", cost_unit as "costUnit", category, subcategory, tax_rate as "taxRate", type, is_disabled as "isDisabled", supplier_id as "supplierId"
        `;

      const result = await query(queryText, values);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Product not found' });
      }

      // If supplier was assigned, fetch supplier name
      if (result.rows[0].supplierId) {
        const supplierResult = await query('SELECT name FROM suppliers WHERE id = $1', [
          result.rows[0].supplierId,
        ]);
        if (supplierResult.rows.length > 0) {
          result.rows[0].supplierName = supplierResult.rows[0].name;
        }
      }

      const isDisabledChanged = body.isDisabled !== undefined;
      const changedFields = [
        body.name !== undefined ? 'name' : null,
        body.productCode !== undefined ? 'productCode' : null,
        body.description !== undefined ? 'description' : null,
        body.costo !== undefined ? 'costo' : null,
        body.molPercentage !== undefined ? 'molPercentage' : null,
        body.category !== undefined ? 'category' : null,
        body.subcategory !== undefined ? 'subcategory' : null,
        body.taxRate !== undefined ? 'taxRate' : null,
        body.type !== undefined ? 'type' : null,
        body.costUnit !== undefined ? 'costUnit' : null,
        isDisabledChanged ? 'isDisabled' : null,
        body.supplierId !== undefined ? 'supplierId' : null,
      ].filter((field): field is string => field !== null);

      // Determine specific action based on what changed
      let action = 'product.updated';
      if (changedFields.length === 1 && changedFields[0] === 'isDisabled') {
        action = body.isDisabled ? 'product.disabled' : 'product.enabled';
      }

      await bumpNamespaceVersion('products');
      await logAudit({
        request,
        action,
        entityType: 'product',
        entityId: idResult.value,
        details: {
          targetLabel: result.rows[0].name as string,
          secondaryLabel: result.rows[0].productCode as string,
        },
      });
      return result.rows[0];
    },
  );

  // DELETE /:id - Delete product
  fastify.delete(
    '/:id',
    {
      onRequest: [
        requireAnyPermission('catalog.internal_listing.delete', 'catalog.external_listing.delete'),
      ],
      schema: {
        tags: ['products'],
        summary: 'Delete product',
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

      const result = await query(
        'DELETE FROM products WHERE id = $1 RETURNING id, name, product_code as "productCode"',
        [idResult.value],
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Product not found' });
      }

      await bumpNamespaceVersion('products');
      await logAudit({
        request,
        action: 'product.deleted',
        entityType: 'product',
        entityId: idResult.value,
        details: {
          targetLabel: result.rows[0].name as string,
          secondaryLabel: result.rows[0].productCode as string,
        },
      });
      return reply.code(204).send();
    },
  );

  // ============================================
  // Internal Product Categories Endpoints
  // ============================================

  // Category schema
  const categorySchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string' },
      costUnit: { type: 'string', enum: ['unit', 'hours'] },
      createdAt: { type: 'number' },
      updatedAt: { type: 'number' },
      productCount: { type: 'number' },
      hasLinkedProducts: { type: 'boolean' },
    },
    required: ['id', 'name', 'type', 'costUnit', 'hasLinkedProducts'],
  } as const;

  // Subcategory schema
  const subcategorySchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      productCount: { type: 'number' },
      hasLinkedProducts: { type: 'boolean' },
    },
    required: ['name', 'productCount', 'hasLinkedProducts'],
  } as const;

  // Helper: Check if internal products by category/subcategory are linked to offers/orders
  async function checkProductsLinkedToTransactions(
    category: string,
    type: string,
    subcategory?: string,
  ): Promise<{ linked: boolean; count: number }> {
    const subcategoryCondition = subcategory !== undefined ? `AND subcategory = $3` : '';
    const params = subcategory !== undefined ? [category, type, subcategory] : [category, type];

    // Find all matching internal product IDs
    const productResult = await query(
      `SELECT id FROM products 
       WHERE category = $1 
         AND type = $2 
         AND supplier_id IS NULL
         ${subcategoryCondition}`,
      params,
    );

    if (productResult.rows.length === 0) {
      return { linked: false, count: 0 };
    }

    const productIds = productResult.rows.map((r) => r.id);

    // Check all tables that reference products
    const tables = [
      { name: 'quote_items', column: 'product_id' },
      { name: 'customer_offer_items', column: 'product_id' },
      { name: 'sale_items', column: 'product_id' },
      { name: 'invoice_items', column: 'product_id' },
      { name: 'special_bids', column: 'product_id' },
      { name: 'supplier_quote_items', column: 'product_id' },
      { name: 'supplier_offer_items', column: 'product_id' },
      { name: 'supplier_sale_items', column: 'product_id' },
      { name: 'supplier_invoice_items', column: 'product_id' },
    ];

    let totalLinks = 0;
    for (const table of tables) {
      const checkResult = await query(
        `SELECT COUNT(*) as count FROM ${table.name} WHERE ${table.column} = ANY($1)`,
        [productIds],
      );
      totalLinks += parseInt(checkResult.rows[0].count, 10);
    }

    return { linked: totalLinks > 0, count: totalLinks };
  }

  // GET /internal-categories - List internal product categories by type
  fastify.get(
    '/internal-categories',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.view')],
      schema: {
        tags: ['products'],
        summary: 'List internal product categories by type',
        querystring: {
          type: 'object',
          properties: {
            type: { type: 'string' },
          },
          required: ['type'],
        },
        response: {
          200: { type: 'array', items: categorySchema },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { type } = request.query as { type: string };

      const typeResult = await requireValidType(type);
      if (!typeResult.ok) return badRequest(reply, typeResult.message);

      const result = await query(
        `SELECT c.id, c.name, c.type,
                c.cost_unit as "costUnit",
                c.created_at as "createdAt", c.updated_at as "updatedAt",
                COALESCE(p.count, 0) as "productCount",
                COALESCE(lp.has_linked, false) as "hasLinkedProducts"
         FROM internal_product_categories c
         LEFT JOIN (
           SELECT category, COUNT(*) as count
           FROM products
           WHERE type = $1 AND supplier_id IS NULL
           GROUP BY category
         ) p ON c.name = p.category
         LEFT JOIN (
           SELECT pr.category, true as has_linked
           FROM products pr
           WHERE pr.type = $1 
             AND pr.supplier_id IS NULL
             AND EXISTS (
               SELECT 1 FROM quote_items qi WHERE qi.product_id = pr.id
               UNION ALL
               SELECT 1 FROM customer_offer_items coi WHERE coi.product_id = pr.id
               UNION ALL
               SELECT 1 FROM sale_items si WHERE si.product_id = pr.id
               UNION ALL
               SELECT 1 FROM invoice_items ii WHERE ii.product_id = pr.id
               UNION ALL
               SELECT 1 FROM special_bids sb WHERE sb.product_id = pr.id
               UNION ALL
               SELECT 1 FROM supplier_quote_items sqi WHERE sqi.product_id = pr.id
               UNION ALL
               SELECT 1 FROM supplier_offer_items soi WHERE soi.product_id = pr.id
               UNION ALL
               SELECT 1 FROM supplier_sale_items ssi WHERE ssi.product_id = pr.id
               UNION ALL
               SELECT 1 FROM supplier_invoice_items sii WHERE sii.product_id = pr.id
             )
           GROUP BY pr.category
         ) lp ON c.name = lp.category
         WHERE c.type = $1
         ORDER BY c.name ASC`,
        [typeResult.value],
      );

      // Convert timestamps to numbers for JSON serialization
      return result.rows.map((row) => ({
        ...row,
        createdAt: row.createdAt ? new Date(row.createdAt).getTime() : null,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : null,
      }));
    },
  );

  // POST /internal-categories - Create internal category
  fastify.post(
    '/internal-categories',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.create')],
      schema: {
        tags: ['products'],
        summary: 'Create internal product category',
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
          },
          required: ['name', 'type'],
        },
        response: {
          201: categorySchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, type } = request.body as {
        name: unknown;
        type: unknown;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const typeResult = await requireValidType(type);
      if (!typeResult.ok) return badRequest(reply, typeResult.message);

      // Check uniqueness within type
      const existingResult = await query(
        'SELECT id FROM internal_product_categories WHERE LOWER(name) = LOWER($1) AND type = $2',
        [nameResult.value, typeResult.value],
      );
      if (existingResult.rows.length > 0) {
        return badRequest(reply, 'Category with this name already exists for this type');
      }

      const id = 'ipc-' + crypto.randomUUID();
      const costUnit = await getCostUnitForType(typeResult.value);
      const result = await query(
        `INSERT INTO internal_product_categories (id, name, type, cost_unit) 
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, type, cost_unit as "costUnit", 
                   created_at as "createdAt", updated_at as "updatedAt"`,
        [id, nameResult.value, typeResult.value, costUnit],
      );

      await bumpNamespaceVersion('products');
      await logAudit({
        request,
        action: 'internal_category.created',
        entityType: 'internal_product_category',
        entityId: id,
        details: {
          targetLabel: nameResult.value,
          secondaryLabel: typeResult.value,
        },
      });

      return reply.code(201).send({
        ...result.rows[0],
        createdAt: result.rows[0].createdAt ? new Date(result.rows[0].createdAt).getTime() : null,
        updatedAt: result.rows[0].updatedAt ? new Date(result.rows[0].updatedAt).getTime() : null,
        productCount: 0,
        hasLinkedProducts: false,
      });
    },
  );

  // PUT /internal-categories/:id - Update internal category
  fastify.put(
    '/internal-categories/:id',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.update')],
      schema: {
        tags: ['products'],
        summary: 'Update internal product category',
        params: idParamSchema,
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
        response: {
          200: categorySchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { name?: unknown };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      // Get current category
      const currentResult = await query(
        'SELECT id, name, type FROM internal_product_categories WHERE id = $1',
        [idResult.value],
      );
      if (currentResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Category not found' });
      }
      const current = currentResult.rows[0];

      let newName = current.name;
      const expectedCostUnit = await getCostUnitForType(current.type);

      // Validate name update
      if (body.name !== undefined) {
        const nameResult = requireNonEmptyString(body.name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);
        newName = nameResult.value;
      }

      // Check uniqueness if name is changing
      if (newName !== current.name) {
        const existingResult = await query(
          'SELECT id FROM internal_product_categories WHERE LOWER(name) = LOWER($1) AND type = $2 AND id != $3',
          [newName, current.type, idResult.value],
        );
        if (existingResult.rows.length > 0) {
          return badRequest(reply, 'Category with this name already exists for this type');
        }

        // Check for linked transactions BEFORE any updates
        const linkedCheck = await checkProductsLinkedToTransactions(current.name, current.type);
        if (linkedCheck.linked) {
          return reply.code(409).send({
            error: 'Cannot rename category',
            message: `Category "${current.name}" has ${linkedCheck.count} product(s) linked to transactions. Rename would affect historical records.`,
            linkedCount: linkedCheck.count,
          });
        }
      }

      // Update category and products atomically
      const updateResult = await withTransaction(async (tx) => {
        const result = await tx.query(
          `UPDATE internal_product_categories
           SET name = $1, cost_unit = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3
           RETURNING id, name, type, cost_unit as "costUnit",
                      created_at as "createdAt", updated_at as "updatedAt"`,
          [newName, expectedCostUnit, idResult.value],
        );

        if (newName !== current.name) {
          await tx.query(
            'UPDATE products SET category = $1, cost_unit = $2 WHERE category = $3 AND type = $4 AND supplier_id IS NULL',
            [newName, expectedCostUnit, current.name, current.type],
          );
        }

        return result;
      });

      await bumpNamespaceVersion('products');
      await logAudit({
        request,
        action: 'internal_category.updated',
        entityType: 'internal_product_category',
        entityId: idResult.value,
        details: {
          targetLabel: newName,
          secondaryLabel: current.type,
        },
      });

      // Get updated product count
      const countResult = await query(
        'SELECT COUNT(*) as count FROM products WHERE category = $1 AND type = $2 AND supplier_id IS NULL',
        [newName, current.type],
      );

      return {
        ...updateResult.rows[0],
        createdAt: updateResult.rows[0].createdAt
          ? new Date(updateResult.rows[0].createdAt).getTime()
          : null,
        updatedAt: updateResult.rows[0].updatedAt
          ? new Date(updateResult.rows[0].updatedAt).getTime()
          : null,
        productCount: parseInt(countResult.rows[0].count, 10),
        hasLinkedProducts: false, // Rename only succeeds if no products were linked
      };
    },
  );

  // DELETE /internal-categories/:id - Delete internal category
  fastify.delete(
    '/internal-categories/:id',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.delete')],
      schema: {
        tags: ['products'],
        summary: 'Delete internal product category',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      // Get category details before deletion
      const categoryResult = await query(
        'SELECT name, type FROM internal_product_categories WHERE id = $1',
        [idResult.value],
      );
      if (categoryResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Category not found' });
      }
      const { name, type } = categoryResult.rows[0];

      // Check if any products are linked to transactions
      const linkedCheck = await checkProductsLinkedToTransactions(name, type);
      if (linkedCheck.linked) {
        return reply.code(409).send({
          error: `Cannot delete category "${name}" because ${linkedCheck.count} product(s) are linked to offers, orders, or invoices`,
        });
      }

      // Clear category and subcategory from all internal products in this category
      await query(
        'UPDATE products SET category = NULL, subcategory = NULL WHERE category = $1 AND type = $2 AND supplier_id IS NULL',
        [name, type],
      );

      // Delete the category
      await query('DELETE FROM internal_product_categories WHERE id = $1', [idResult.value]);

      await bumpNamespaceVersion('products');
      await logAudit({
        request,
        action: 'internal_category.deleted',
        entityType: 'internal_product_category',
        entityId: idResult.value,
        details: {
          targetLabel: name,
          secondaryLabel: type,
        },
      });

      return reply.code(204).send();
    },
  );

  // ============================================
  // Internal Product Subcategories Endpoints
  // ============================================

  // GET /internal-subcategories - List internal subcategories by type and category
  fastify.get(
    '/internal-subcategories',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.view')],
      schema: {
        tags: ['products'],
        summary: 'List internal product subcategories',
        querystring: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            category: { type: 'string' },
          },
          required: ['type', 'category'],
        },
        response: {
          200: { type: 'array', items: subcategorySchema },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { type, category } = request.query as { type: string; category: string };

      const typeResult = await requireValidType(type);
      if (!typeResult.ok) return badRequest(reply, typeResult.message);

      const categoryResult = requireNonEmptyString(category, 'category');
      if (!categoryResult.ok) return badRequest(reply, categoryResult.message);

      // First, get the category id
      const categoryIdResult = await query(
        'SELECT id FROM internal_product_categories WHERE name = $1 AND type = $2',
        [categoryResult.value, typeResult.value],
      );
      if (categoryIdResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Category not found' });
      }
      const categoryId = categoryIdResult.rows[0].id;

      // Then get subcategories with product counts and linked status
      const result = await query(
        `SELECT s.name, 
                COALESCE(p.count, 0) as "productCount",
                COALESCE(lp.has_linked, false) as "hasLinkedProducts"
         FROM internal_product_subcategories s
         LEFT JOIN (
           SELECT subcategory, COUNT(*) as count
           FROM products
           WHERE type = $1 AND category = $2 AND supplier_id IS NULL
           GROUP BY subcategory
         ) p ON s.name = p.subcategory
         LEFT JOIN (
           SELECT pr.subcategory, true as has_linked
           FROM products pr
           WHERE pr.type = $1 
             AND pr.category = $2
             AND pr.supplier_id IS NULL
             AND EXISTS (
               SELECT 1 FROM quote_items qi WHERE qi.product_id = pr.id
               UNION ALL
               SELECT 1 FROM customer_offer_items coi WHERE coi.product_id = pr.id
               UNION ALL
               SELECT 1 FROM sale_items si WHERE si.product_id = pr.id
               UNION ALL
               SELECT 1 FROM invoice_items ii WHERE ii.product_id = pr.id
               UNION ALL
               SELECT 1 FROM special_bids sb WHERE sb.product_id = pr.id
               UNION ALL
               SELECT 1 FROM supplier_quote_items sqi WHERE sqi.product_id = pr.id
               UNION ALL
               SELECT 1 FROM supplier_offer_items soi WHERE soi.product_id = pr.id
               UNION ALL
               SELECT 1 FROM supplier_sale_items ssi WHERE ssi.product_id = pr.id
               UNION ALL
               SELECT 1 FROM supplier_invoice_items sii WHERE sii.product_id = pr.id
             )
           GROUP BY pr.subcategory
         ) lp ON s.name = lp.subcategory
         WHERE s.category_id = $3
         ORDER BY s.name ASC`,
        [typeResult.value, categoryResult.value, categoryId],
      );

      return result.rows;
    },
  );

  // POST /internal-subcategories - Create internal subcategory
  fastify.post(
    '/internal-subcategories',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.create')],
      schema: {
        tags: ['products'],
        summary: 'Create internal product subcategory',
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
            category: { type: 'string' },
          },
          required: ['name', 'type', 'category'],
        },
        response: {
          201: subcategorySchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, type, category } = request.body as {
        name: unknown;
        type: unknown;
        category: unknown;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const typeResult = await requireValidType(type);
      if (!typeResult.ok) return badRequest(reply, typeResult.message);

      const categoryResult = requireNonEmptyString(category, 'category');
      if (!categoryResult.ok) return badRequest(reply, categoryResult.message);

      // Get category id
      const categoryIdResult = await query(
        'SELECT id FROM internal_product_categories WHERE name = $1 AND type = $2',
        [categoryResult.value, typeResult.value],
      );
      if (categoryIdResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Category not found' });
      }
      const categoryId = categoryIdResult.rows[0].id;

      // Check if this subcategory already exists for this category
      const existingResult = await query(
        'SELECT 1 FROM internal_product_subcategories WHERE category_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
        [categoryId, nameResult.value],
      );

      if (existingResult.rows.length > 0) {
        return badRequest(reply, 'Subcategory with this name already exists for this category');
      }

      // Create the subcategory
      const id = 'ips-' + crypto.randomUUID();
      const result = await query(
        `INSERT INTO internal_product_subcategories (id, category_id, name)
         VALUES ($1, $2, $3)
         RETURNING name`,
        [id, categoryId, nameResult.value],
      );

      await bumpNamespaceVersion('products');
      await logAudit({
        request,
        action: 'internal_subcategory.created',
        entityType: 'internal_product_subcategory',
        entityId: id,
        details: {
          targetLabel: nameResult.value,
          secondaryLabel: categoryResult.value,
        },
      });

      return reply.code(201).send({
        name: result.rows[0].name,
        productCount: 0,
        hasLinkedProducts: false,
      });
    },
  );

  // PUT /internal-subcategories/:name - Rename internal subcategory
  fastify.put(
    '/internal-subcategories/:name',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.update')],
      schema: {
        tags: ['products'],
        summary: 'Rename internal product subcategory',
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
        body: {
          type: 'object',
          properties: {
            newName: { type: 'string' },
            type: { type: 'string' },
            category: { type: 'string' },
          },
          required: ['newName', 'type', 'category'],
        },
        response: {
          200: subcategorySchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name } = request.params as { name: string };
      const body = request.body as { newName: unknown; type: unknown; category: unknown };

      const oldNameResult = requireNonEmptyString(name, 'name');
      if (!oldNameResult.ok) return badRequest(reply, oldNameResult.message);

      const newNameResult = requireNonEmptyString(body.newName, 'newName');
      if (!newNameResult.ok) return badRequest(reply, newNameResult.message);

      const typeResult = await requireValidType(body.type);
      if (!typeResult.ok) return badRequest(reply, typeResult.message);

      const categoryResult = requireNonEmptyString(body.category, 'category');
      if (!categoryResult.ok) return badRequest(reply, categoryResult.message);

      // Get category id
      const categoryIdResult = await query(
        'SELECT id FROM internal_product_categories WHERE name = $1 AND type = $2',
        [categoryResult.value, typeResult.value],
      );
      if (categoryIdResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Category not found' });
      }
      const categoryId = categoryIdResult.rows[0].id;

      // Check if target subcategory already exists
      if (oldNameResult.value.toLowerCase() !== newNameResult.value.toLowerCase()) {
        const existingResult = await query(
          'SELECT 1 FROM internal_product_subcategories WHERE category_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
          [categoryId, newNameResult.value],
        );
        if (existingResult.rows.length > 0) {
          return badRequest(reply, 'Subcategory with this name already exists for this category');
        }
      }

      // Check for linked transactions BEFORE any updates
      const linkedCheck = await checkProductsLinkedToTransactions(
        categoryResult.value,
        typeResult.value,
        oldNameResult.value,
      );
      if (linkedCheck.linked) {
        return reply.code(409).send({
          error: 'Cannot rename subcategory',
          message: `Subcategory "${oldNameResult.value}" has ${linkedCheck.count} product(s) linked to transactions. Rename would affect historical records.`,
          linkedCount: linkedCheck.count,
        });
      }

      // Update subcategory and products atomically
      let subId: string;
      let productCount: number;
      try {
        const result = await withTransaction(async (tx) => {
          const subResult = await tx.query(
            `UPDATE internal_product_subcategories
             SET name = $1, updated_at = CURRENT_TIMESTAMP
             WHERE category_id = $2 AND name = $3
             RETURNING id`,
            [newNameResult.value, categoryId, oldNameResult.value],
          );
          if (subResult.rows.length === 0) {
            const err = new Error('Subcategory not found');
            (err as any).statusCode = 404;
            throw err;
          }

          const updateResult = await tx.query(
            `UPDATE products
             SET subcategory = $1
             WHERE type = $2
               AND category = $3
               AND supplier_id IS NULL
               AND subcategory = $4
             RETURNING id`,
            [newNameResult.value, typeResult.value, categoryResult.value, oldNameResult.value],
          );

          return { subId: subResult.rows[0].id as string, productCount: updateResult.rows.length };
        });
        subId = result.subId;
        productCount = result.productCount;
      } catch (err: any) {
        if (err.statusCode === 404) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }

      await bumpNamespaceVersion('products');
      await logAudit({
        request,
        action: 'internal_subcategory.renamed',
        entityType: 'internal_product_subcategory',
        entityId: subId,
        details: {
          targetLabel: newNameResult.value,
          secondaryLabel: `From: ${oldNameResult.value}`,
        },
      });

      return {
        name: newNameResult.value,
        productCount,
        hasLinkedProducts: false, // Rename only succeeds if no products were linked to transactions
      };
    },
  );

  // DELETE /internal-subcategories/:name - Delete internal subcategory
  fastify.delete(
    '/internal-subcategories/:name',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.delete')],
      schema: {
        tags: ['products'],
        summary: 'Delete internal product subcategory',
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
        querystring: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            category: { type: 'string' },
          },
          required: ['type', 'category'],
        },
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name } = request.params as { name: string };
      const { type, category } = request.query as { type: string; category: string };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const typeResult = await requireValidType(type);
      if (!typeResult.ok) return badRequest(reply, typeResult.message);

      const categoryResult = requireNonEmptyString(category, 'category');
      if (!categoryResult.ok) return badRequest(reply, categoryResult.message);

      // Get category id
      const categoryIdResult = await query(
        'SELECT id FROM internal_product_categories WHERE name = $1 AND type = $2',
        [categoryResult.value, typeResult.value],
      );
      if (categoryIdResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Category not found' });
      }
      const categoryId = categoryIdResult.rows[0].id;

      // Check if products with this subcategory are linked to transactions
      const linkedCheck = await checkProductsLinkedToTransactions(
        categoryResult.value,
        typeResult.value,
        nameResult.value,
      );
      if (linkedCheck.linked) {
        return reply.code(409).send({
          error: `Cannot delete subcategory "${nameResult.value}" because ${linkedCheck.count} product(s) are linked to offers, orders, or invoices`,
        });
      }

      // Clear subcategory from all matching products
      await query(
        `UPDATE products 
         SET subcategory = NULL
         WHERE type = $1 
           AND category = $2 
           AND supplier_id IS NULL
           AND subcategory = $3`,
        [typeResult.value, categoryResult.value, nameResult.value],
      );

      // Delete the subcategory from the table
      const subResult = await query(
        `DELETE FROM internal_product_subcategories 
         WHERE category_id = $1 AND name = $2
         RETURNING id`,
        [categoryId, nameResult.value],
      );
      if (subResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Subcategory not found' });
      }

      await bumpNamespaceVersion('products');
      await logAudit({
        request,
        action: 'internal_subcategory.deleted',
        entityType: 'internal_product_subcategory',
        entityId: subResult.rows[0].id,
        details: {
          targetLabel: nameResult.value,
          secondaryLabel: categoryResult.value,
        },
      });

      return reply.code(204).send();
    },
  );

  // ============================================
  // Product Types Endpoints (User-Managed)
  // ============================================

  // Product Type schema
  const productTypeSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      costUnit: { type: 'string', enum: ['unit', 'hours'] },
      createdAt: { type: 'number' },
      updatedAt: { type: 'number' },
      productCount: { type: 'number' },
      categoryCount: { type: 'number' },
    },
    required: ['id', 'name', 'costUnit'],
  } as const;

  // GET /internal-types - List all product types
  fastify.get(
    '/internal-types',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.view')],
      schema: {
        tags: ['products'],
        summary: 'List all product types',
        response: {
          200: { type: 'array', items: productTypeSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const result = await query(
        `SELECT 
          t.id,
          t.name,
          t.cost_unit as "costUnit",
          t.created_at as "createdAt",
          t.updated_at as "updatedAt",
          COALESCE(p.count, 0) as "productCount",
          COALESCE(c.count, 0) as "categoryCount"
         FROM product_types t
         LEFT JOIN (
           SELECT type, COUNT(*) as count FROM products GROUP BY type
         ) p ON t.name = p.type
         LEFT JOIN (
           SELECT type, COUNT(*) as count FROM internal_product_categories GROUP BY type
         ) c ON t.name = c.type
         ORDER BY t.name ASC`,
      );

      return result.rows.map((row) => ({
        ...row,
        createdAt: row.createdAt ? new Date(row.createdAt).getTime() : null,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : null,
      }));
    },
  );

  // POST /internal-types - Create a new product type
  fastify.post(
    '/internal-types',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.create')],
      schema: {
        tags: ['products'],
        summary: 'Create a new product type',
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            costUnit: { type: 'string', enum: ['unit', 'hours'] },
          },
          required: ['name', 'costUnit'],
        },
        response: {
          201: productTypeSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, costUnit } = request.body as {
        name: unknown;
        costUnit: unknown;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      // Validate costUnit
      const costUnitResult = validateEnum(costUnit, ['unit', 'hours'], 'costUnit');
      if (!costUnitResult.ok) return badRequest(reply, costUnitResult.message);

      // Check uniqueness (case-insensitive)
      const existingResult = await query(
        'SELECT id FROM product_types WHERE LOWER(name) = LOWER($1)',
        [nameResult.value],
      );
      if (existingResult.rows.length > 0) {
        return badRequest(reply, 'Product type with this name already exists');
      }

      const id = 'pt-' + crypto.randomUUID();
      const result = await query(
        `INSERT INTO product_types (id, name, cost_unit)
         VALUES ($1, $2, $3)
         RETURNING id, name, cost_unit as "costUnit",
                   created_at as "createdAt", updated_at as "updatedAt"`,
        [id, nameResult.value, costUnitResult.value],
      );

      await bumpNamespaceVersion('products');
      await logAudit({
        request,
        action: 'product_type.created',
        entityType: 'product_type',
        entityId: id,
        details: {
          targetLabel: nameResult.value,
          secondaryLabel: costUnitResult.value,
        },
      });

      return reply.code(201).send({
        ...result.rows[0],
        createdAt: result.rows[0].createdAt ? new Date(result.rows[0].createdAt).getTime() : null,
        updatedAt: result.rows[0].updatedAt ? new Date(result.rows[0].updatedAt).getTime() : null,
        productCount: 0,
        categoryCount: 0,
      });
    },
  );

  // PUT /internal-types/:id - Update a product type
  fastify.put(
    '/internal-types/:id',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.update')],
      schema: {
        tags: ['products'],
        summary: 'Update a product type',
        params: idParamSchema,
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            costUnit: { type: 'string', enum: ['unit', 'hours'] },
          },
        },
        response: {
          200: productTypeSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { name?: unknown; costUnit?: unknown };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      // Get current type
      const currentResult = await query(
        'SELECT id, name, cost_unit FROM product_types WHERE id = $1',
        [idResult.value],
      );
      if (currentResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Product type not found' });
      }
      const current = currentResult.rows[0];

      let newName = current.name;
      let newCostUnit = current.cost_unit;

      // Validate and update name if provided
      if (body.name !== undefined) {
        const nameResult = requireNonEmptyString(body.name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);
        newName = nameResult.value;
      }

      // Validate and update costUnit if provided
      if (body.costUnit !== undefined) {
        const costUnitResult = validateEnum(body.costUnit, ['unit', 'hours'], 'costUnit');
        if (!costUnitResult.ok) return badRequest(reply, costUnitResult.message);
        newCostUnit = costUnitResult.value;
      }

      // Check uniqueness if name is changing (case-insensitive)
      if (newName !== current.name) {
        const existingResult = await query(
          'SELECT id FROM product_types WHERE LOWER(name) = LOWER($1) AND id != $2',
          [newName, idResult.value],
        );
        if (existingResult.rows.length > 0) {
          return badRequest(reply, 'Product type with this name already exists');
        }
      }

      // Perform all mutations atomically
      const updateResult = await withTransaction(async (tx) => {
        if (newName !== current.name) {
          await tx.query('UPDATE products SET type = $1 WHERE type = $2', [newName, current.name]);
          await tx.query('UPDATE internal_product_categories SET type = $1 WHERE type = $2', [
            newName,
            current.name,
          ]);
        }

        if (newCostUnit !== current.cost_unit) {
          await tx.query(
            'UPDATE products SET cost_unit = $1 WHERE type = $2 AND supplier_id IS NULL',
            [newCostUnit, newName],
          );
          await tx.query('UPDATE internal_product_categories SET cost_unit = $1 WHERE type = $2', [
            newCostUnit,
            newName,
          ]);
        }

        const result = await tx.query(
          `UPDATE product_types
           SET name = $1, cost_unit = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3
           RETURNING id, name, cost_unit as "costUnit",
                     created_at as "createdAt", updated_at as "updatedAt"`,
          [newName, newCostUnit, idResult.value],
        );
        return result;
      });

      await bumpNamespaceVersion('products');
      await logAudit({
        request,
        action: 'product_type.updated',
        entityType: 'product_type',
        entityId: idResult.value,
        details: {
          targetLabel: newName,
          secondaryLabel: newCostUnit,
        },
      });

      // Get updated counts
      const productCountResult = await query(
        'SELECT COUNT(*) as count FROM products WHERE type = $1',
        [newName],
      );
      const categoryCountResult = await query(
        'SELECT COUNT(*) as count FROM internal_product_categories WHERE type = $1',
        [newName],
      );

      return {
        ...updateResult.rows[0],
        createdAt: updateResult.rows[0].createdAt
          ? new Date(updateResult.rows[0].createdAt).getTime()
          : null,
        updatedAt: updateResult.rows[0].updatedAt
          ? new Date(updateResult.rows[0].updatedAt).getTime()
          : null,
        productCount: parseInt(productCountResult.rows[0].count, 10),
        categoryCount: parseInt(categoryCountResult.rows[0].count, 10),
      };
    },
  );

  // DELETE /internal-types/:id - Delete a product type
  fastify.delete(
    '/internal-types/:id',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.delete')],
      schema: {
        tags: ['products'],
        summary: 'Delete a product type',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      // Get type details before deletion
      const typeResult = await query('SELECT name FROM product_types WHERE id = $1', [
        idResult.value,
      ]);
      if (typeResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Product type not found' });
      }
      const { name } = typeResult.rows[0];

      // Check if any products use this type
      const productCountResult = await query(
        'SELECT COUNT(*) as count FROM products WHERE type = $1',
        [name],
      );
      const productCount = parseInt(productCountResult.rows[0].count, 10);

      if (productCount > 0) {
        return reply.code(409).send({
          error: `Cannot delete type "${name}" because ${productCount} product(s) are using it`,
        });
      }

      // Check if any categories use this type
      const categoryCountResult = await query(
        'SELECT COUNT(*) as count FROM internal_product_categories WHERE type = $1',
        [name],
      );
      const categoryCount = parseInt(categoryCountResult.rows[0].count, 10);

      if (categoryCount > 0) {
        return reply.code(409).send({
          error: `Cannot delete type "${name}" because ${categoryCount} category(s) are using it`,
        });
      }

      // Delete the type
      await query('DELETE FROM product_types WHERE id = $1', [idResult.value]);

      await bumpNamespaceVersion('products');
      await logAudit({
        request,
        action: 'product_type.deleted',
        entityType: 'product_type',
        entityId: idResult.value,
        details: {
          targetLabel: name,
        },
      });

      return reply.code(204).send();
    },
  );
}
