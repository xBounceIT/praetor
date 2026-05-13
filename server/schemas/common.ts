export const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    // errorCode lets the client branch on machine-readable reasons (e.g.
    // 'account_disabled' vs token-expired) without parsing free-text messages.
    // Declared here because Fastify response serialization drops undeclared
    // properties, so middleware that emits errorCode would otherwise lose it.
    errorCode: { type: 'string' },
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

export const rateLimitErrorResponseSchema = errorResponseSchema;

export const standardErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  503: errorResponseSchema,
} as const;

export const standardRateLimitedErrorResponses = {
  429: rateLimitErrorResponseSchema,
  ...standardErrorResponses,
} as const;
