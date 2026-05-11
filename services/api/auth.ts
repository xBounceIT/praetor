import type { User } from '../../types';
import { fetchApi, getApiBase, getAuthToken, setAuthToken } from './client';
import type { LoginResponse } from './contracts';
import { normalizeUser } from './normalizers';

const INVALID_AUTH_RESPONSE_ERROR = 'Invalid authentication response';

const ensureToken = (token: unknown): string => {
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  if (!normalizedToken) {
    throw new Error(INVALID_AUTH_RESPONSE_ERROR);
  }
  return normalizedToken;
};

/**
 * Validate the canonical /auth/me shape. The server contract is that the
 * authenticated user's own record is always fully populated (email,
 * costPerHour, employeeType, authMethod, available roles). If any of those are
 * missing we treat the response as invalid rather than silently inventing
 * defaults — that masks real server-side regressions.
 */
const normalizeAuthUser = (rawUser: User): User => {
  // Pre-check raw payload BEFORE normalization so we don't lose information
  // (e.g. `email` collapses from `''` to `undefined` in the normalizer).
  if (
    rawUser === null ||
    typeof rawUser !== 'object' ||
    typeof rawUser.email !== 'string' ||
    typeof rawUser.costPerHour !== 'number' ||
    typeof rawUser.employeeType !== 'string' ||
    typeof rawUser.authMethod !== 'string'
  ) {
    throw new Error(INVALID_AUTH_RESPONSE_ERROR);
  }

  const normalizedUser = normalizeUser(rawUser);
  if (
    !normalizedUser.id ||
    !normalizedUser.name ||
    !normalizedUser.username ||
    !normalizedUser.role ||
    !normalizedUser.avatarInitials
  ) {
    throw new Error(INVALID_AUTH_RESPONSE_ERROR);
  }

  if (!normalizedUser.availableRoles || normalizedUser.availableRoles.length === 0) {
    throw new Error(INVALID_AUTH_RESPONSE_ERROR);
  }

  const hasActiveRole = normalizedUser.availableRoles.some(
    (availableRole) => availableRole.id === normalizedUser.role,
  );
  if (!hasActiveRole) {
    throw new Error(INVALID_AUTH_RESPONSE_ERROR);
  }

  return normalizedUser;
};

const fetchCanonicalAuthUser = async (): Promise<User> => {
  const authUser = await fetchApi<User>('/auth/me');
  return normalizeAuthUser(authUser);
};

const runCanonicalAuthFlow = async (
  operation: () => Promise<LoginResponse>,
): Promise<LoginResponse> => {
  const previousToken = getAuthToken();

  try {
    const response = await operation();
    const token = ensureToken(response.token);
    setAuthToken(token);

    const user = await fetchCanonicalAuthUser();
    return {
      token: getAuthToken() || token,
      user,
    };
  } catch (err) {
    setAuthToken(previousToken);
    throw err;
  }
};

export const authApi = {
  login: (username: string, password: string): Promise<LoginResponse> =>
    runCanonicalAuthFlow(() =>
      fetchApi('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    ),

  consumeSsoTicket: (ticket: string): Promise<LoginResponse> =>
    runCanonicalAuthFlow(() =>
      fetchApi('/auth/sso/consume', {
        method: 'POST',
        body: JSON.stringify({ ticket }),
      }),
    ),

  getSsoStartUrl: (protocol: 'oidc' | 'saml', slug: string): string =>
    `${getApiBase()}/auth/sso/${protocol}/${encodeURIComponent(slug)}/start`,

  me: (): Promise<User> => fetchCanonicalAuthUser(),

  switchRole: (roleId: string): Promise<LoginResponse> =>
    runCanonicalAuthFlow(() =>
      fetchApi('/auth/switch-role', {
        method: 'POST',
        body: JSON.stringify({ roleId }),
      }),
    ),
};
