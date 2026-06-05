import type { User } from '../../types';
import { fetchApi, getApiBase, getAuthToken, setAuthToken } from './client';
import type {
  LoginResponse,
  LoginResult,
  TotpBackupCodesResponse,
  TotpConfirmResponse,
  TotpSetupResponse,
  TotpStatusResponse,
} from './contracts';
import { normalizeUser } from './normalizers';

// Raw, unvalidated /auth/login payload. The endpoint can short-circuit into a
// TOTP challenge / forced-enrollment branch (no token yet) instead of returning
// the canonical { token, user }, so we must inspect the response before running
// the token-requiring finalize in runCanonicalAuthFlow.
type RawLoginResponse = Partial<LoginResponse> & {
  totpRequired?: boolean;
  challengeToken?: string;
  totpEnrollmentRequired?: boolean;
  enrollToken?: string;
};

const bearerHeaders = (bearerToken?: string): { headers: Record<string, string> } | undefined =>
  bearerToken ? { headers: { Authorization: `Bearer ${bearerToken}` } } : undefined;

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

// Shared finalize step: persist the issued token and resolve the canonical user.
// Login/switch-role/sso-consume responses already carry the canonical user
// (server enforces loginResponseSchema). Fall back to /auth/me only if the
// payload fails our guards — i.e. on contract drift.
const finalizeAuthResponse = async (response: {
  token?: unknown;
  user: User;
}): Promise<LoginResponse> => {
  const token = ensureToken(response.token);
  setAuthToken(token);

  let user: User;
  try {
    user = normalizeAuthUser(response.user);
  } catch {
    user = await fetchCanonicalAuthUser();
  }
  return {
    token: getAuthToken() || token,
    user,
  };
};

const runCanonicalAuthFlow = async (
  operation: () => Promise<LoginResponse>,
): Promise<LoginResponse> => {
  const previousToken = getAuthToken();

  try {
    const response = await operation();
    return await finalizeAuthResponse(response);
  } catch (err) {
    setAuthToken(previousToken);
    throw err;
  }
};

export const authApi = {
  login: async (username: string, password: string): Promise<LoginResult> => {
    const previousToken = getAuthToken();

    try {
      // Fetch the raw response first: /auth/login may branch into a TOTP
      // challenge or forced-enrollment path that carries no token. Wrapping it
      // in runCanonicalAuthFlow would throw on the missing token before we get
      // a chance to surface those branches to the caller.
      const raw = await fetchApi<RawLoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      if (raw.totpRequired && raw.challengeToken) {
        return { totpRequired: true, challengeToken: raw.challengeToken };
      }
      if (raw.totpEnrollmentRequired && raw.enrollToken) {
        return { totpEnrollmentRequired: true, enrollToken: raw.enrollToken };
      }

      return await finalizeAuthResponse(raw as { token?: unknown; user: User });
    } catch (err) {
      setAuthToken(previousToken);
      throw err;
    }
  },

  totpChallenge: (challengeToken: string, code: string): Promise<LoginResponse> =>
    runCanonicalAuthFlow(() =>
      fetchApi('/auth/totp-challenge', {
        method: 'POST',
        body: JSON.stringify({ challengeToken, code }),
      }),
    ),

  totpSetup: (bearerToken?: string, password?: string): Promise<TotpSetupResponse> =>
    fetchApi<TotpSetupResponse>('/auth/2fa/setup', {
      method: 'POST',
      // Session path sends the account password for step-up re-auth (a stolen session alone must
      // not be able to enroll a second factor); the enroll-token path (bearerToken set) omits it —
      // that token was already verified against the login password.
      body: password !== undefined ? JSON.stringify({ password }) : undefined,
      ...bearerHeaders(bearerToken),
    }),

  totpConfirm: async (code: string, bearerToken?: string): Promise<TotpConfirmResponse> => {
    const response = await fetchApi<TotpConfirmResponse>('/auth/2fa/confirm', {
      method: 'POST',
      body: JSON.stringify({ code }),
      ...bearerHeaders(bearerToken),
    });

    // Enroll-token path: confirm also issues a session token + canonical user. Reuse the shared
    // finalize so the token is persisted and the user validated identically to every other login
    // path — including the /auth/me fallback if the serialized user trips a guard (contract drift).
    if (response.token && response.user) {
      const finalized = await finalizeAuthResponse({ token: response.token, user: response.user });
      return { enabled: true, token: finalized.token, user: finalized.user };
    }
    return { enabled: true };
  },

  totpDisable: (payload: { password?: string; code?: string }): Promise<{ enabled: false }> =>
    fetchApi('/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  regenerateTotpBackupCodes: (code: string): Promise<TotpBackupCodesResponse> =>
    fetchApi<TotpBackupCodesResponse>('/auth/2fa/backup-codes/regenerate', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  getTotpStatus: (): Promise<TotpStatusResponse> =>
    fetchApi<TotpStatusResponse>('/auth/2fa/status'),

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

  logout: (): Promise<{ endSessionUrl: string | null }> =>
    fetchApi('/auth/logout', { method: 'POST' }),
};
