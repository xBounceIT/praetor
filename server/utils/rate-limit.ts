export const GLOBAL_RATE_LIMIT = {
  max: 1000,
  timeWindow: '1 minute',
} as const;

export const STANDARD_ROUTE_RATE_LIMIT = {
  max: 120,
  timeWindow: '1 minute',
} as const;

export const LOGIN_RATE_LIMIT = {
  max: 10,
  timeWindow: '15 minutes',
} as const;
