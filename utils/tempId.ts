export const makeTempId = (prefix = 'tmp') => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
