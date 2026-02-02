export const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
  required: ['error'],
} as const;

export const messageResponseSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
  },
  required: ['message'],
} as const;

export const successResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
  },
  required: ['success'],
} as const;

export const standardErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
} as const;
