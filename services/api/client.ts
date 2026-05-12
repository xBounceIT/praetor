const API_BASE = import.meta.env.VITE_API_URL || '/api';

let authToken: string | null = localStorage.getItem('praetor_auth_token');

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) {
    localStorage.setItem('praetor_auth_token', token);
  } else {
    localStorage.removeItem('praetor_auth_token');
  }
};

export const getAuthToken = () => authToken;

/**
 * Error thrown by the API client. Carries the HTTP status so callers can
 * distinguish auth rejections (401/403) from transient failures (network
 * errors -> status 0, 5xx, etc).
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly isNetworkError: boolean;

  constructor(message: string, status: number, isNetworkError = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.isNetworkError = isNetworkError;
  }
}

export const fetchApi = async <T>(endpoint: string, options: RequestInit = {}): Promise<T> => {
  const headers: HeadersInit = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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
    // fetch() throws a TypeError on network failures (offline, DNS, refused).
    const message = err instanceof Error ? err.message : 'Network request failed';
    throw new ApiError(message, 0, true);
  }

  const newToken = response.headers.get('x-auth-token');
  if (newToken) {
    setAuthToken(newToken);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(error.message || error.error || `HTTP ${response.status}`, response.status);
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
  const headers: HeadersInit = {
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const newToken = response.headers.get('x-auth-token');
  if (newToken) {
    setAuthToken(newToken);
  }

  return response;
};
