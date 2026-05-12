export const GLOBAL_RATE_LIMIT = {
  max: 3000,
  timeWindow: '1 minute',
} as const;

export const STANDARD_ROUTE_RATE_LIMIT = {
  max: 600,
  timeWindow: '1 minute',
} as const;

export const LOGIN_RATE_LIMIT = {
  max: 30,
  timeWindow: '15 minutes',
} as const;
