/**
 * Test-side mirror of `services/api/client.ts#ApiError`. Tests that mock
 * `../../services/api` must expose this on the mock so consumer code (e.g.
 * `useAuth`) keeps working when it does `instanceof ApiError`.
 */
export class ApiErrorStub extends Error {
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
