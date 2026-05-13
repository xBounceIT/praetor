import crypto from 'crypto';
import { getEncryptionKey } from './crypto.ts';

export const PERSONAL_ACCESS_TOKEN_PREFIX = 'praetor_pat_';
const RANDOM_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 20;

export const generatePersonalAccessToken = () =>
  `${PERSONAL_ACCESS_TOKEN_PREFIX}${crypto.randomBytes(RANDOM_BYTES).toString('base64url')}`;

// HMAC-keyed by ENCRYPTION_KEY so a DB-read leak alone can't brute-force token values offline.
export const hashPersonalAccessToken = (token: string) =>
  crypto.createHmac('sha256', getEncryptionKey()).update(token).digest('hex');

export const getPersonalAccessTokenDisplayPrefix = (token: string) =>
  token.slice(0, DISPLAY_PREFIX_LENGTH);

export const isPersonalAccessToken = (token: string) =>
  token.startsWith(PERSONAL_ACCESS_TOKEN_PREFIX);
