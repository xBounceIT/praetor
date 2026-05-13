import crypto from 'crypto';

export const PERSONAL_ACCESS_TOKEN_PREFIX = 'praetor_pat_';
const RANDOM_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 20;

// Mix ENCRYPTION_KEY into PAT hashes so a DB-read leak alone can't brute-force token values
// offline. The derived 32-byte key is cached because hashPersonalAccessToken runs on every
// authenticated PAT request.
let cachedHashKey: Buffer | null = null;
const getHashKey = (): Buffer => {
  if (cachedHashKey !== null) return cachedHashKey;
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is required');
  cachedHashKey = crypto.createHash('sha256').update(key).digest();
  return cachedHashKey;
};

export const generatePersonalAccessToken = () =>
  `${PERSONAL_ACCESS_TOKEN_PREFIX}${crypto.randomBytes(RANDOM_BYTES).toString('base64url')}`;

export const hashPersonalAccessToken = (token: string) =>
  crypto.createHmac('sha256', getHashKey()).update(token).digest('hex');

export const getPersonalAccessTokenDisplayPrefix = (token: string) =>
  token.slice(0, DISPLAY_PREFIX_LENGTH);

export const isPersonalAccessToken = (token: string) =>
  token.startsWith(PERSONAL_ACCESS_TOKEN_PREFIX);
