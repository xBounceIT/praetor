export const clientOfferItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    offerId: { type: 'string' },
    productId: { type: ['string', 'null'] },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: ['number', 'null'] },
    supplierQuoteId: { type: ['string', 'null'] },
    supplierQuoteItemId: { type: ['string', 'null'] },
    supplierQuoteSupplierName: { type: ['string', 'null'] },
    supplierQuoteUnitPrice: { type: ['number', 'null'] },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    note: { type: ['string', 'null'] },
    discount: { type: 'number', minimum: 0, maximum: 100 },
    durationMonths: { type: 'number' },
    durationUnit: { type: 'string', enum: ['months', 'years', 'na'] },
  },
  required: ['id', 'offerId', 'productName', 'quantity', 'unitPrice', 'productCost', 'discount'],
} as const;

export const clientOfferSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    revisionNumber: { type: 'integer' },
    revisionCode: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
    linkedQuoteId: { type: 'string' },
    linkedQuoteRevisionCode: { type: ['string', 'null'] },
    linkedQuoteCandidateId: { type: ['string', 'null'] },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string' },
    // Derived (issue #779): `expired` overrides draft/sent once the expiration date has passed;
    // accepted/denied are frozen and never expire.
    effectiveStatus: {
      type: 'string',
      enum: ['draft', 'sent', 'accepted', 'denied', 'expired'],
    },
    deliveryDate: { type: ['string', 'null'], format: 'date' },
    expirationDate: { type: ['string', 'null'], format: 'date' },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: clientOfferItemSchema },
    autoCreated: {
      type: 'object',
      properties: {
        clientOrder: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        supplierOrders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              supplierQuoteId: { type: 'string' },
              supplierName: { type: 'string' },
            },
            required: ['id', 'supplierQuoteId', 'supplierName'],
          },
        },
      },
      required: ['clientOrder', 'supplierOrders'],
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'id',
    'linkedQuoteId',
    'clientId',
    'clientName',
    'discount',
    'discountType',
    'status',
    'effectiveStatus',
    'createdAt',
    'updatedAt',
    'items',
  ],
} as const;
