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

export const getApiBase = () => API_BASE;

/**
 * Error thrown by `fetchApi` when an HTTP request reaches the server but the
 * response status is not OK. `statusCode` mirrors `response.status`, letting
 * callers distinguish real auth failures (401/403) from transient server
 * problems (5xx). Network failures still surface as plain `TypeError`s.
 */
export class ApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

export const isApiError = (err: unknown): err is ApiError => err instanceof ApiError;

export const fetchApi = async <T>(endpoint: string, options: RequestInit = {}): Promise<T> => {
  const headers: HeadersInit = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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
