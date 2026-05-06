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

const normalizeAuthUser = (user: User): User => {
  const normalizedUser = normalizeUser(user);
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
