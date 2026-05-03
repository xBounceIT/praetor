import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requireAnyPermission } from '../middleware/auth.ts';
import * as productsRepo from '../repositories/productsRepo.ts';
import * as suppliersRepo from '../repositories/suppliersRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import type { CostUnit } from '../utils/cost-unit.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
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
    type: { type: 'string' },
    supplierId: { type: ['string', 'null'] },
    supplierName: { type: ['string', 'null'] },
    isDisabled: { type: 'boolean' },
    createdAt: { type: ['number', 'null'] },
  },
  required: ['id', 'name', 'productCode', 'costo', 'molPercentage', 'costUnit', 'type'],
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
    type: { type: 'string' },
    supplierId: { type: 'string' },
    costUnit: { type: 'string', enum: ['unit', 'hours'] },
  },
  required: ['name', 'productCode', 'costo', 'molPercentage', 'type'],
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
    type: { type: 'string' },
    supplierId: { type: 'string' },
    costUnit: { type: 'string', enum: ['unit', 'hours'] },
    isDisabled: { type: 'boolean' },
  },
} as const;

// Validates `typeName` is a non-empty string that matches a registered product_type row.
// Returns the row's costUnit so callers don't need a follow-up lookup.
const requireValidType = async (
  typeName: unknown,
): Promise<{ ok: true; value: string; costUnit: CostUnit } | { ok: false; message: string }> => {
  const r = requireNonEmptyString(typeName, 'type');
  if (!r.ok) return r;
  const costUnit = await productsRepo.findProductTypeByName(r.value);
  if (costUnit === null) {
    return {
      ok: false,
      message: `Invalid type "${r.value}". Type must be a registered product type.`,
    };
  }
  return { ok: true, value: r.value, costUnit };
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  // GET / - List all products
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requireAnyPermission(
          'catalog.internal_listing.view',
          'sales.supplier_quotes.view',
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
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      return await productsRepo.listAllProducts();
    },
  );

  // POST / - Create product
  fastify.post(
    '/',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.create')],
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
        type: unknown;
        supplierId: unknown;
        costUnit: unknown;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const productCodeResult = requireNonEmptyString(productCode, 'productCode');
      if (!productCodeResult.ok) return badRequest(reply, productCodeResult.message);

      if (!/^[a-zA-Z0-9_-]+$/.test(productCodeResult.value)) {
        return badRequest(
          reply,
          'Product code can only contain letters, numbers, underscores, and hyphens',
        );
      }

      const [nameTaken, codeTaken] = await Promise.all([
        productsRepo.existsProductByName(nameResult.value, null),
        productsRepo.existsProductByCode(productCodeResult.value, null),
      ]);
      if (nameTaken) return badRequest(reply, 'Product name must be unique');
      if (codeTaken) return badRequest(reply, 'Product code must be unique');

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

      if (type === undefined || type === null || type === '') {
        return badRequest(reply, 'type is required');
      }
      const typeResult = await requireValidType(type);
      if (!typeResult.ok) return badRequest(reply, typeResult.message);

      // Internal products always derive their unit from type.
      // External products keep their explicitly configured unit.
      let expectedCostUnit: CostUnit = typeResult.costUnit;
      if (supplierId) {
        const costUnitResult = validateEnum(costUnit, ['unit', 'hours'] as const, 'costUnit');
        if (costUnitResult.ok) expectedCostUnit = costUnitResult.value;
      }

      const id = `p-${Date.now()}`;
      const created = await productsRepo.insertProduct({
        id,
        name: nameResult.value,
        productCode: productCodeResult.value,
        description: (description as string | null) || null,
        costo: costoResult.value,
        molPercentage: molPercentageResult.value,
        costUnit: expectedCostUnit,
        category: (category as string | null) || null,
        subcategory: (subcategory as string | null) || null,
        type: typeResult.value,
        supplierId: (supplierId as string | null) || null,
      });

      if (supplierId) {
        created.supplierName = await suppliersRepo.findNameById(supplierId as string);
      }

      await logAudit({
        request,
        action: 'product.created',
        entityType: 'product',
        entityId: id,
        details: {
          targetLabel: created.name,
          secondaryLabel: created.productCode,
        },
      });
      return reply.code(201).send(created);
    },
  );

  // PUT /:id - Update product
  fastify.put(
    '/:id',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.update')],
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
        type?: unknown;
        supplierId?: unknown;
        costUnit?: unknown;
        isDisabled?: unknown;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const fields: productsRepo.ProductUpdateFields = {};

      let validatedName: string | null = null;
      if (body.name !== undefined) {
        const nameResult = requireNonEmptyString(body.name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);
        validatedName = nameResult.value;
      }

      let validatedProductCode: string | null = null;
      if (body.productCode !== undefined) {
        const productCodeResult = requireNonEmptyString(body.productCode, 'productCode');
        if (!productCodeResult.ok) return badRequest(reply, productCodeResult.message);

        if (!/^[a-zA-Z0-9_-]+$/.test(productCodeResult.value)) {
          return badRequest(
            reply,
            'Product code can only contain letters, numbers, underscores, and hyphens',
          );
        }
        validatedProductCode = productCodeResult.value;
      }

      const [nameTaken, codeTaken] = await Promise.all([
        validatedName !== null
          ? productsRepo.existsProductByName(validatedName, idResult.value)
          : Promise.resolve(false),
        validatedProductCode !== null
          ? productsRepo.existsProductByCode(validatedProductCode, idResult.value)
          : Promise.resolve(false),
      ]);
      if (nameTaken) return badRequest(reply, 'Product name must be unique');
      if (codeTaken) return badRequest(reply, 'Product code must be unique');

      if (validatedName !== null) fields.name = validatedName;
      if (validatedProductCode !== null) fields.productCode = validatedProductCode;

      if (body.description !== undefined) {
        fields.description = (body.description as string | null) || null;
      }

      if (body.costo !== undefined) {
        const costoResult = parseLocalizedNonNegativeNumber(body.costo, 'costo');
        if (!costoResult.ok) return badRequest(reply, costoResult.message);
        fields.costo = costoResult.value;
      }

      if (body.molPercentage !== undefined) {
        const molPercentageResult = parseLocalizedNonNegativeNumber(
          body.molPercentage,
          'molPercentage',
        );
        if (!molPercentageResult.ok) return badRequest(reply, molPercentageResult.message);
        if (molPercentageResult.value <= 0 || molPercentageResult.value >= 100) {
          return badRequest(reply, 'molPercentage must be greater than 0 and less than 100');
        }
        fields.molPercentage = molPercentageResult.value;
      }

      // currentProduct is only needed when we have to recompute cost_unit or default
      // supplier-related fields. For pure name/productCode/description/costo/molPercentage/
      // isDisabled updates, the row's existence is implicitly checked by updateProductDynamic.
      const needsCurrentProduct =
        body.type !== undefined ||
        body.category !== undefined ||
        body.supplierId !== undefined ||
        body.costUnit !== undefined;

      let updatedType: string | null = null;
      let typeCostUnit: CostUnit | null = null;
      let updatedSupplierId: string | null = null;

      if (needsCurrentProduct) {
        const currentProduct = await productsRepo.findProductCoreById(idResult.value);
        if (!currentProduct) {
          return reply.code(404).send({ error: 'Product not found' });
        }
        updatedType = currentProduct.type;
        updatedSupplierId = currentProduct.supplierId;
      }

      if (body.supplierId !== undefined) {
        updatedSupplierId = body.supplierId ? (body.supplierId as string) : null;
        fields.supplierId = updatedSupplierId;
      }

      if (body.type !== undefined) {
        const typeResult = await requireValidType(body.type);
        if (!typeResult.ok) return badRequest(reply, typeResult.message);
        fields.type = typeResult.value;
        updatedType = typeResult.value;
        typeCostUnit = typeResult.costUnit;
      }

      if (body.category !== undefined) {
        fields.category = (body.category as string | null) || null;
      }

      if (body.subcategory !== undefined) {
        fields.subcategory = (body.subcategory as string | null) || null;
      }

      // Internal products always derive their unit from type. External products keep
      // an explicitly configurable unit.
      const isExternal = updatedSupplierId !== null;
      const costUnitRelevantFieldsChanged =
        body.type !== undefined || body.category !== undefined || body.supplierId !== undefined;

      if (!isExternal && costUnitRelevantFieldsChanged && updatedType) {
        fields.costUnit = typeCostUnit ?? (await productsRepo.getCostUnitForType(updatedType));
      } else if (isExternal && body.costUnit !== undefined) {
        const costUnitResult = validateEnum(body.costUnit, ['unit', 'hours'] as const, 'costUnit');
        if (!costUnitResult.ok) return badRequest(reply, costUnitResult.message);
        fields.costUnit = costUnitResult.value;
      }

      if (body.isDisabled !== undefined) {
        fields.isDisabled = parseBoolean(body.isDisabled);
      }

      const product =
        Object.keys(fields).length === 0
          ? await productsRepo.findProductById(idResult.value)
          : await productsRepo.updateProductDynamic(idResult.value, fields);

      if (!product) {
        return reply.code(404).send({ error: 'Product not found' });
      }

      if (product.supplierId) {
        product.supplierName = await suppliersRepo.findNameById(product.supplierId);
      }

      const changedFields = [
        body.name !== undefined ? 'name' : null,
        body.productCode !== undefined ? 'productCode' : null,
        body.description !== undefined ? 'description' : null,
        body.costo !== undefined ? 'costo' : null,
        body.molPercentage !== undefined ? 'molPercentage' : null,
        body.category !== undefined ? 'category' : null,
        body.subcategory !== undefined ? 'subcategory' : null,
        body.type !== undefined ? 'type' : null,
        body.costUnit !== undefined ? 'costUnit' : null,
        body.isDisabled !== undefined ? 'isDisabled' : null,
        body.supplierId !== undefined ? 'supplierId' : null,
      ].filter((field): field is string => field !== null);

      let action = 'product.updated';
      if (changedFields.length === 1 && changedFields[0] === 'isDisabled') {
        action = body.isDisabled ? 'product.disabled' : 'product.enabled';
      }

      await logAudit({
        request,
        action,
        entityType: 'product',
        entityId: idResult.value,
        details: {
          targetLabel: product.name,
          secondaryLabel: product.productCode,
        },
      });
      return product;
    },
  );

  // DELETE /:id - Delete product
  fastify.delete(
    '/:id',
    {
      onRequest: [requireAnyPermission('catalog.internal_listing.delete')],
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

      const deleted = await productsRepo.deleteProductById(idResult.value);

      if (!deleted) {
        return reply.code(404).send({ error: 'Product not found' });
      }

      await logAudit({
        request,
        action: 'product.deleted',
        entityType: 'product',
        entityId: idResult.value,
        details: {
          targetLabel: deleted.name,
          secondaryLabel: deleted.productCode,
        },
      });
      return reply.code(204).send();
    },
  );

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

  const subcategorySchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      productCount: { type: 'number' },
      hasLinkedProducts: { type: 'boolean' },
    },
    required: ['name', 'productCount', 'hasLinkedProducts'],
  } as const;

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

      return await productsRepo.listInternalCategoriesByType(typeResult.value);
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

      if (
        await productsRepo.existsInternalCategoryByNameType(
          nameResult.value,
          typeResult.value,
          null,
        )
      ) {
        return badRequest(reply, 'Category with this name already exists for this type');
      }

      const id = generatePrefixedId('ipc');
      const created = await productsRepo.insertInternalCategory(
        id,
        nameResult.value,
        typeResult.value,
        typeResult.costUnit,
      );

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

      return reply.code(201).send(created);
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

      const current = await productsRepo.findInternalCategoryById(idResult.value);
      if (!current) {
        return reply.code(404).send({ error: 'Category not found' });
      }

      let newName = current.name;
      if (body.name !== undefined) {
        const nameResult = requireNonEmptyString(body.name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);
        newName = nameResult.value;
      }

      const isRename = newName !== current.name;
      const [expectedCostUnit, nameTaken, linkedCheck] = await Promise.all([
        productsRepo.getCostUnitForType(current.type),
        isRename
          ? productsRepo.existsInternalCategoryByNameType(newName, current.type, idResult.value)
          : Promise.resolve(false),
        isRename
          ? productsRepo.checkProductsLinkedToTransactions(current.name, current.type, undefined)
          : Promise.resolve({ linked: false, count: 0 }),
      ]);
      if (nameTaken) {
        return badRequest(reply, 'Category with this name already exists for this type');
      }
      if (linkedCheck.linked) {
        return reply.code(409).send({
          error: 'Cannot rename category',
          message: `Category "${current.name}" has ${linkedCheck.count} product(s) linked to transactions. Rename would affect historical records.`,
          linkedCount: linkedCheck.count,
        });
      }

      const result = await withDbTransaction(async (tx) => {
        const row = await productsRepo.updateInternalCategoryFields(
          idResult.value,
          newName,
          expectedCostUnit,
          tx,
        );
        if (!row) return null;
        const renamedCount = isRename
          ? await productsRepo.propagateCategoryNameToProducts(
              current.name,
              newName,
              current.type,
              expectedCostUnit,
              tx,
            )
          : null;
        return { row, renamedCount };
      });

      if (!result) {
        return reply.code(404).send({ error: 'Category not found' });
      }

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

      // On rename, the propagation rowcount is exactly the new productCount (the unique-name
      // check guarantees no pre-existing rows under newName). Otherwise we have to query.
      const productCount =
        result.renamedCount ?? (await productsRepo.countProductsForCategory(newName, current.type));

      return {
        ...result.row,
        productCount,
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

      const category = await productsRepo.findInternalCategoryById(idResult.value);
      if (!category) {
        return reply.code(404).send({ error: 'Category not found' });
      }
      const { name, type } = category;

      const linkedCheck = await productsRepo.checkProductsLinkedToTransactions(
        name,
        type,
        undefined,
      );
      if (linkedCheck.linked) {
        return reply.code(409).send({
          error: `Cannot delete category "${name}" because ${linkedCheck.count} product(s) are linked to offers, orders, or invoices`,
        });
      }

      await productsRepo.clearProductsCategoryByName(name, type);
      await productsRepo.deleteInternalCategoryById(idResult.value);

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

      const categoryId = await productsRepo.findCategoryIdByNameAndType(
        categoryResult.value,
        typeResult.value,
      );
      if (!categoryId) {
        return reply.code(404).send({ error: 'Category not found' });
      }

      return await productsRepo.listInternalSubcategoriesByType(categoryId);
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

      const categoryId = await productsRepo.findCategoryIdByNameAndType(
        categoryResult.value,
        typeResult.value,
      );
      if (!categoryId) {
        return reply.code(404).send({ error: 'Category not found' });
      }

      if (
        await productsRepo.existsInternalSubcategoryByNameInCategory(nameResult.value, categoryId)
      ) {
        return badRequest(reply, 'Subcategory with this name already exists for this category');
      }

      const id = generatePrefixedId('ips');
      const created = await productsRepo.insertInternalSubcategory(
        id,
        categoryId,
        nameResult.value,
      );

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
        name: created.name,
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

      const categoryId = await productsRepo.findCategoryIdByNameAndType(
        categoryResult.value,
        typeResult.value,
      );
      if (!categoryId) {
        return reply.code(404).send({ error: 'Category not found' });
      }

      if (oldNameResult.value.toLowerCase() !== newNameResult.value.toLowerCase()) {
        if (
          await productsRepo.existsInternalSubcategoryByNameInCategory(
            newNameResult.value,
            categoryId,
          )
        ) {
          return badRequest(reply, 'Subcategory with this name already exists for this category');
        }
      }

      // Block rename when products are already linked — preserves historical references.
      const linkedCheck = await productsRepo.checkProductsLinkedToTransactions(
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

      const result = await withDbTransaction(async (tx) => {
        const sub = await productsRepo.updateInternalSubcategoryName(
          categoryId,
          oldNameResult.value,
          newNameResult.value,
          tx,
        );
        if (!sub) return null;
        const updatedCount = await productsRepo.propagateSubcategoryNameToProducts(
          oldNameResult.value,
          newNameResult.value,
          typeResult.value,
          categoryResult.value,
          tx,
        );
        return { subId: sub.id, productCount: updatedCount };
      });

      if (!result) {
        return reply.code(404).send({ error: 'Subcategory not found' });
      }

      await logAudit({
        request,
        action: 'internal_subcategory.renamed',
        entityType: 'internal_product_subcategory',
        entityId: result.subId,
        details: {
          targetLabel: newNameResult.value,
          secondaryLabel: `From: ${oldNameResult.value}`,
        },
      });

      return {
        name: newNameResult.value,
        productCount: result.productCount,
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

      const categoryId = await productsRepo.findCategoryIdByNameAndType(
        categoryResult.value,
        typeResult.value,
      );
      if (!categoryId) {
        return reply.code(404).send({ error: 'Category not found' });
      }

      const linkedCheck = await productsRepo.checkProductsLinkedToTransactions(
        categoryResult.value,
        typeResult.value,
        nameResult.value,
      );
      if (linkedCheck.linked) {
        return reply.code(409).send({
          error: `Cannot delete subcategory "${nameResult.value}" because ${linkedCheck.count} product(s) are linked to offers, orders, or invoices`,
        });
      }

      await productsRepo.clearProductsSubcategoryByName(
        nameResult.value,
        typeResult.value,
        categoryResult.value,
      );

      const subDeleted = await productsRepo.deleteInternalSubcategoryByCategoryAndName(
        categoryId,
        nameResult.value,
      );
      if (!subDeleted) {
        return reply.code(404).send({ error: 'Subcategory not found' });
      }

      await logAudit({
        request,
        action: 'internal_subcategory.deleted',
        entityType: 'internal_product_subcategory',
        entityId: subDeleted.id,
        details: {
          targetLabel: nameResult.value,
          secondaryLabel: categoryResult.value,
        },
      });

      return reply.code(204).send();
    },
  );

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
      return await productsRepo.listAllProductTypesWithCounts();
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

      const costUnitResult = validateEnum(costUnit, ['unit', 'hours'] as const, 'costUnit');
      if (!costUnitResult.ok) return badRequest(reply, costUnitResult.message);

      if (await productsRepo.existsProductTypeByName(nameResult.value, null)) {
        return badRequest(reply, 'Product type with this name already exists');
      }

      const id = generatePrefixedId('pt');
      const created = await productsRepo.insertProductType(
        id,
        nameResult.value,
        costUnitResult.value,
      );

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

      return reply.code(201).send(created);
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

      const current = await productsRepo.findProductTypeById(idResult.value);
      if (!current) {
        return reply.code(404).send({ error: 'Product type not found' });
      }

      let newName = current.name;
      let newCostUnit = current.costUnit;

      if (body.name !== undefined) {
        const nameResult = requireNonEmptyString(body.name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);
        newName = nameResult.value;
      }

      if (body.costUnit !== undefined) {
        const costUnitResult = validateEnum(body.costUnit, ['unit', 'hours'] as const, 'costUnit');
        if (!costUnitResult.ok) return badRequest(reply, costUnitResult.message);
        newCostUnit = costUnitResult.value;
      }

      if (newName !== current.name) {
        if (await productsRepo.existsProductTypeByName(newName, idResult.value)) {
          return badRequest(reply, 'Product type with this name already exists');
        }
      }

      const updated = await withDbTransaction(async (tx) => {
        if (newName !== current.name) {
          await productsRepo.propagateProductTypeName(current.name, newName, tx);
        }
        if (newCostUnit !== current.costUnit) {
          await productsRepo.propagateProductTypeCostUnit(newName, newCostUnit, tx);
        }
        return await productsRepo.updateProductTypeFields(idResult.value, newName, newCostUnit, tx);
      });

      if (!updated) {
        return reply.code(404).send({ error: 'Product type not found' });
      }

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

      const [productCount, categoryCount] = await Promise.all([
        productsRepo.countProductsForType(newName),
        productsRepo.countCategoriesForType(newName),
      ]);

      return {
        ...updated,
        productCount,
        categoryCount,
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

      const type = await productsRepo.findProductTypeById(idResult.value);
      if (!type) {
        return reply.code(404).send({ error: 'Product type not found' });
      }
      const { name } = type;

      const [productCount, categoryCount] = await Promise.all([
        productsRepo.countProductsForType(name),
        productsRepo.countCategoriesForType(name),
      ]);

      if (productCount > 0) {
        return reply.code(409).send({
          error: `Cannot delete type "${name}" because ${productCount} product(s) are using it`,
        });
      }
      if (categoryCount > 0) {
        return reply.code(409).send({
          error: `Cannot delete type "${name}" because ${categoryCount} category(s) are using it`,
        });
      }

      await productsRepo.deleteProductTypeById(idResult.value);

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
