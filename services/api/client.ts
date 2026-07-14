import { getTokenSessionVersion } from '../../utils/sessionTimeout';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Without this, a hung server (no TCP reset) leaves the UI on a spinner forever.
const DEFAULT_TIMEOUT_MS = 30_000;

// react-doctor-disable-next-line react-doctor/auth-token-in-web-storage -- Existing bearer-token API contract; cookie migration requires a coordinated server compatibility window.
let authToken: string | null = localStorage.getItem('praetor_auth_token');
let authTokenRevision = 0;
let nextAuthRequestId = 0;
let latestAppliedTokenRequestId = 0;

const persistAuthToken = (token: string | null) => {
  authToken = token;
  if (token) {
    // react-doctor-disable-next-line react-doctor/auth-token-in-web-storage -- Existing bearer-token API contract; cookie migration requires coordinated server support.
    localStorage.setItem('praetor_auth_token', token);
  } else {
    localStorage.removeItem('praetor_auth_token');
  }
};

export const setAuthToken = (token: string | null) => {
  authTokenRevision += 1;
  persistAuthToken(token);
};

export const getAuthToken = () => authToken;

export const getApiBase = () => API_BASE;

// Error thrown by the API client. Carries the HTTP status so callers can
// distinguish auth rejections (401/403) from transient failures (network
// errors -> status 0, 5xx, etc).
export class ApiError extends Error {
  public readonly status: number;
  public readonly isNetworkError: boolean;
  public readonly errorCode?: string;

  constructor(message: string, status: number, isNetworkError = false, errorCode?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.isNetworkError = isNetworkError;
    this.errorCode = errorCode;
  }
}

export interface FetchApiOptions extends RequestInit {
  // Override the default 30s request timeout. `null` disables it — use for endpoints
  // that may legitimately take longer (e.g. AI completions) and that supply their
  // own AbortSignal for cancellation.
  timeoutMs?: number | null;
  // Logout clears the local session before its response settles. Ignoring rotation headers
  // prevents a delayed or failed logout response from restoring that session token.
  persistAuthToken?: boolean;
}

type AuthRequestContext = {
  requestId: number;
  tokenRevision: number;
};

const beginAuthRequest = (): AuthRequestContext => ({
  requestId: ++nextAuthRequestId,
  tokenRevision: authTokenRevision,
});

// Prefer the server's monotonic session version, then preserve request start order for rotations
// within that version. The revision prevents pre-login/logout responses from restoring stale auth.
const applyRotatedAuthToken = (response: Response, context: AuthRequestContext) => {
  const newToken = response.headers.get('x-auth-token');
  if (!newToken || context.tokenRevision !== authTokenRevision) return;

  const currentSessionVersion = getTokenSessionVersion(authToken);
  const newSessionVersion = getTokenSessionVersion(newToken);
  const hasComparableSessionVersions = currentSessionVersion !== null && newSessionVersion !== null;
  const supersedesCurrentSession =
    hasComparableSessionVersions && newSessionVersion > currentSessionVersion;
  const isStaleSession = hasComparableSessionVersions && newSessionVersion < currentSessionVersion;

  if (
    !isStaleSession &&
    (supersedesCurrentSession || context.requestId > latestAppliedTokenRequestId)
  ) {
    latestAppliedTokenRequestId = Math.max(latestAppliedTokenRequestId, context.requestId);
    persistAuthToken(newToken);
  }
};

export const fetchApi = async <T>(endpoint: string, options: FetchApiOptions = {}): Promise<T> => {
  const authContext = beginAuthRequest();
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    persistAuthToken: shouldPersistAuthToken = true,
    signal: callerSignal,
    ...fetchOptions
  } = options;

  const headers: HeadersInit = {
    ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...fetchOptions.headers,
  };

  const timeoutSignal = timeoutMs == null ? null : AbortSignal.timeout(timeoutMs);
  let signal: AbortSignal | undefined;
  if (timeoutSignal && callerSignal) {
    signal = AbortSignal.any([callerSignal, timeoutSignal]);
  } else {
    signal = timeoutSignal ?? callerSignal ?? undefined;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...fetchOptions,
      headers,
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError('Request timed out', 0, true);
    }
    const message = err instanceof Error ? err.message : 'Network request failed';
    throw new ApiError(message, 0, true);
  }

  if (shouldPersistAuthToken) {
    applyRotatedAuthToken(response, authContext);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(
      error.message || error.error || `HTTP ${response.status}`,
      response.status,
      false,
      typeof error.errorCode === 'string' ? error.errorCode : undefined,
    );
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
};

export const fetchApiStream = async (
  endpoint: string,
  options: RequestInit = {},
): Promise<Response> => {
  const authContext = beginAuthRequest();
  const headers: HeadersInit = {
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...options.headers,
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network request failed';
    throw new ApiError(message, 0, true);
  }

  applyRotatedAuthToken(response, authContext);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(error.message || error.error || `HTTP ${response.status}`, response.status);
  }

  return response;
};
