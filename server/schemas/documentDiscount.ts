export const documentDiscountValueSchema = {
  type: 'number',
  minimum: 0,
} as const;

export const documentDiscountTypeSchema = {
  type: 'string',
  enum: ['percentage', 'currency'],
} as const;

// Creates default an omitted discount type to percentage, so only an explicitly fixed-currency
// discount may exceed 100. The handler repeats the effective-value check as the trust boundary.
export const createDocumentDiscountConstraint = {
  anyOf: [
    {
      properties: { discountType: { const: 'currency' } },
      required: ['discountType'],
    },
    { properties: { discount: { type: 'number', maximum: 100 } } },
  ],
} as const;
