import type { PublicSsoProvider } from '../types';

// Multi-step login: credentials → (optional) TOTP challenge or forced enrollment.
type LoginPhase = 'credentials' | 'totp' | 'enroll';

interface LoginUiState {
  showPassword: boolean;
  error: string;
  isLoading: boolean;
  ssoProviders: PublicSsoProvider[];
  failedLogoUrl: string | null;
  phase: LoginPhase;
  totpCode: string;
  useBackupCode: boolean;
  totpError: string;
  verifyingTotp: boolean;
}

type LoginUiAction =
  | { type: 'togglePassword' }
  | { type: 'setError'; error: string }
  | { type: 'setLoading'; isLoading: boolean }
  | { type: 'setSsoProviders'; providers: PublicSsoProvider[] }
  | { type: 'logoFailed'; url: string }
  | { type: 'beginTotpChallenge' }
  | { type: 'beginEnrollment' }
  | { type: 'resetCredentials'; error?: string }
  | { type: 'setTotpCode'; code: string; clearError?: boolean }
  | { type: 'toggleBackupCode' }
  | { type: 'setTotpError'; error: string }
  | { type: 'setVerifyingTotp'; verifying: boolean };

export const initialLoginUiState: LoginUiState = {
  showPassword: false,
  error: '',
  isLoading: false,
  ssoProviders: [],
  failedLogoUrl: null,
  phase: 'credentials',
  totpCode: '',
  useBackupCode: false,
  totpError: '',
  verifyingTotp: false,
};

export const loginUiReducer = (state: LoginUiState, action: LoginUiAction): LoginUiState => {
  switch (action.type) {
    case 'togglePassword':
      return { ...state, showPassword: !state.showPassword };
    case 'setError':
      return { ...state, error: action.error };
    case 'setLoading':
      return { ...state, isLoading: action.isLoading };
    case 'setSsoProviders':
      return { ...state, ssoProviders: action.providers };
    case 'logoFailed':
      return { ...state, failedLogoUrl: action.url };
    case 'beginTotpChallenge':
      return {
        ...state,
        phase: 'totp',
        totpCode: '',
        useBackupCode: false,
        totpError: '',
      };
    case 'beginEnrollment':
      return { ...state, phase: 'enroll' };
    case 'resetCredentials':
      return {
        ...state,
        phase: 'credentials',
        totpCode: '',
        useBackupCode: false,
        totpError: '',
        error: action.error ?? '',
      };
    case 'setTotpCode':
      return {
        ...state,
        totpCode: action.code,
        totpError: action.clearError ? '' : state.totpError,
      };
    case 'toggleBackupCode':
      return {
        ...state,
        useBackupCode: !state.useBackupCode,
        totpCode: '',
        totpError: '',
      };
    case 'setTotpError':
      return { ...state, totpError: action.error };
    case 'setVerifyingTotp':
      return { ...state, verifyingTotp: action.verifying };
    default:
      return state;
  }
};
