import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireAnyPermission } from '../middleware/auth.ts';
import {
  requireNonEmptyString,
  parseLocalizedNonNegativeNumber,
  parseBoolean,
  validateEnum,
  badRequest,
} from '../utils/validation.ts';
import { standardErrorResponses } from '../schemas/common.ts';

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
    type: { type: 'string', enum: ['supply', 'service', 'consulting'] },
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
    type: { type: 'string', enum: ['supply', 'service', 'consulting'] },
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
    type: { type: 'string', enum: ['supply', 'service', 'consulting'] },
    supplierId: { type: 'string' },
    costUnit: { type: 'string', enum: ['unit', 'hours'] },
    isDisabled: { type: 'boolean' },
  },
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // All product routes require authentication
  fastify.addHook('onRequest', authenticateToken);

  // GET / - List all products
  fastify.get(
    '/',
    {
      onRequest: [
        requireAnyPermission(
          'catalog.internal_listing.view',
          'catalog.external_listing.view',
          'catalog.special_bids.view',
          'suppliers.quotes.view',
        ),
      ],
      schema: {
        tags: ['products'],
        summary: 'List products',
        response: {
          200: { type: 'array', items: productSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (_request, _reply) => {
      const result = await query(
        `SELECT p.id, p.name, p.product_code as "productCode", p.description, p.costo, p.mol_percentage as "molPercentage", p.cost_unit as "costUnit", p.category, p.subcategory, p.tax_rate as "taxRate", p.type, p.supplier_id as "supplierId", s.name as "supplierName", p.is_disabled as "isDisabled" 
             FROM products p 
             LEFT JOIN suppliers s ON p.supplier_id = s.id 
             ORDER BY p.name ASC`,
      );
      return result.rows;
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
      // Updated types: supply, service, consulting. (item is legacy, strictly we expect new types)
      const typeResult = validateEnum(type, ['supply', 'service', 'consulting'], 'type');
      if (!typeResult.ok) return badRequest(reply, typeResult.message);

      // Auto-derive costUnit from type (frontend should not send costUnit)
      const expectedCostUnit = typeResult.value === 'supply' ? 'unit' : 'hours';

      // If costUnit is provided, validate it matches the expected value for the type
      if (costUnit !== undefined && costUnit !== null && costUnit !== '') {
        const costUnitResult = validateEnum(costUnit, ['unit', 'hours'], 'costUnit');
        if (!costUnitResult.ok) return badRequest(reply, costUnitResult.message);
        if (costUnitResult.value !== expectedCostUnit) {
          return badRequest(
            reply,
            `costUnit must be '${expectedCostUnit}' for type '${typeResult.value}'`,
          );
        }
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

      // Category (nullable)
      if (body.category !== undefined) {
        fields.push(`category = $${paramIndex++}`);
        values.push(body.category || null);
      }

      // Subcategory (nullable)
      if (body.subcategory !== undefined) {
        fields.push(`subcategory = $${paramIndex++}`);
        values.push(body.subcategory || null);
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

      // Type - when type changes, auto-update costUnit to match
      let currentProductType = null;
      if (body.type !== undefined) {
        const typeResult = validateEnum(body.type, ['supply', 'service', 'consulting'], 'type');
        if (!typeResult.ok) return badRequest(reply, typeResult.message);
        fields.push(`type = $${paramIndex++}`);
        values.push(typeResult.value);

        // Auto-set costUnit based on new type
        const autoCostUnit = typeResult.value === 'supply' ? 'unit' : 'hours';
        fields.push(`cost_unit = $${paramIndex++}`);
        values.push(autoCostUnit);
        currentProductType = typeResult.value;
      }

      // Cost Unit - validate against current product type, auto-correct if mismatch
      if (body.costUnit !== undefined && currentProductType === null) {
        // Need to fetch current product to validate costUnit against its type
        const currentProduct = await query('SELECT type FROM products WHERE id = $1', [
          idResult.value,
        ]);
        if (currentProduct.rows.length === 0) {
          return reply.code(404).send({ error: 'Product not found' });
        }
        currentProductType = currentProduct.rows[0].type;

        const expectedCostUnit = currentProductType === 'supply' ? 'unit' : 'hours';
        const costUnitResult = validateEnum(body.costUnit, ['unit', 'hours'], 'costUnit');
        if (!costUnitResult.ok) return badRequest(reply, costUnitResult.message);

        // Auto-correct: always use expected value based on type
        fields.push(`cost_unit = $${paramIndex++}`);
        values.push(expectedCostUnit);
      }

      // Is Disabled
      if (body.isDisabled !== undefined) {
        fields.push(`is_disabled = $${paramIndex++}`);
        values.push(parseBoolean(body.isDisabled));
      }

      // Supplier (nullable)
      if (body.supplierId !== undefined) {
        fields.push(`supplier_id = $${paramIndex++}`);
        // Convert empty string to null to avoid FK violation and allow clearing
        values.push(body.supplierId ? body.supplierId : null);
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

      const result = await query('DELETE FROM products WHERE id = $1 RETURNING id', [
        idResult.value,
      ]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Product not found' });
      }

      return reply.code(204).send();
    },
  );
}
