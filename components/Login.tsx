import { zodResolver } from '@hookform/resolvers/zod';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { TriangleAlert, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Controller, type UseFormReturn, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Separator } from '@/components/ui/separator';
import { getShadcnThemeClassName, useBrowserTheme } from '@/components/ui/use-shadcn-theme';
import { cn } from '@/lib/utils';
import type { ResolvedTheme } from '@/utils/theme';
import api, { ApiError } from '../services/api';
import {
  type LogoutNotice,
  type PublicSsoProvider,
  SSO_LOGIN_ERROR_CODES,
  type User,
} from '../types';
import TotpSetupWizard, { type TotpSetupResult } from './TotpSetupWizard';

export interface LoginProps {
  onLogin: (user: User, token?: string) => void;
  logoutReason?: LogoutNotice | null;
  onClearLogoutReason?: () => void;
  serverUnreachable?: boolean;
  onDismissServerUnreachable?: () => void;
  companyName?: string | null;
  logoUrl?: string | null;
}

interface LoginFormValues {
  username: string;
  password: string;
}

// Multi-step login: credentials → (optional) TOTP challenge or forced enrollment.
type LoginPhase = 'credentials' | 'totp' | 'enroll';

// Captures the { token, user } that /auth/2fa/confirm issues during the forced
// enrollment flow, so onFinished can complete login after the user views their
// backup codes.
interface PendingLogin {
  token: string;
  user: User;
}

const OTP_LENGTH = 6;

// Validates the URL-borne `sso_error` value against the canonical code list from `types.ts` so
// anything outside the set (e.g. a hand-crafted URL) safely falls back to the generic message.
const KNOWN_SSO_ERROR_CODES = new Set<string>(SSO_LOGIN_ERROR_CODES);

// Faint dotted-grid overlay from the shadcn login-02 block; driven by the theme's
// `--card-foreground` token so it adapts to every theme.
const gridOverlayStyle: React.CSSProperties = {
  backgroundImage: `
    linear-gradient(to right, color-mix(in srgb, var(--card-foreground) 8%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--card-foreground) 8%, transparent) 1px, transparent 1px)
  `,
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 0',
  maskImage: `
    repeating-linear-gradient(to right, black 0px, black 3px, transparent 3px, transparent 8px),
    repeating-linear-gradient(to bottom, black 0px, black 3px, transparent 3px, transparent 8px),
    radial-gradient(ellipse 70% 50% at 50% 0%, #000 60%, transparent 100%)
  `,
  WebkitMaskImage: `
    repeating-linear-gradient(to right, black 0px, black 3px, transparent 3px, transparent 8px),
    repeating-linear-gradient(to bottom, black 0px, black 3px, transparent 3px, transparent 8px),
    radial-gradient(ellipse 70% 50% at 50% 0%, #000 60%, transparent 100%)
  `,
  maskComposite: 'intersect',
  WebkitMaskComposite: 'source-in',
};

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

const initialLoginUiState: LoginUiState = {
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

const loginUiReducer = (state: LoginUiState, action: LoginUiAction): LoginUiState => {
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
  }
};

const Login: React.FC<LoginProps> = ({
  onLogin,
  logoutReason,
  onClearLogoutReason,
  serverUnreachable,
  onDismissServerUnreachable,
  companyName,
  logoUrl,
}) => {
  const { t } = useTranslation(['auth', 'common', 'notifications']);
  // The login screen follows the OS/browser color scheme rather than any saved
  // user preference — the signed-in user isn't known yet at this point.
  const browserTheme = useBrowserTheme();
  // In dark mode the page sits on pure black and the multi-color logo is flattened
  // to solid white (`brightness-0` blacks every pixel, `invert` flips it to white)
  // so it reads cleanly on the dark card. Light mode keeps the original artwork.
  const isDark = browserTheme === 'dark';
  const [
    {
      showPassword,
      error,
      isLoading,
      ssoProviders,
      failedLogoUrl,
      phase,
      totpCode,
      useBackupCode,
      totpError,
      verifyingTotp,
    },
    dispatchLoginUi,
  ] = useReducer(loginUiReducer, initialLoginUiState);
  // Fall back to the bundled logo if a custom logoUrl fails to load (the server returns 404 for a
  // logo whose file is missing on disk). Tracking the failed URL (vs a boolean + reset effect)
  // retries automatically when logoUrl changes and can't loop on a failing fallback.
  const usingCustomLogo = Boolean(logoUrl) && logoUrl !== failedLogoUrl;
  const resolvedLogoUrl = logoUrl && logoUrl !== failedLogoUrl ? logoUrl : '/praetor-logo.png';

  // Second-factor flow state. `challengeToken`/`enrollToken` are short-lived server tokens returned
  // by /auth/login that authorize the follow-up call. They are only ever read inside the verify/
  // enroll handlers (never rendered) and are always set alongside a phase transition that
  // drives the re-render, so they live in refs rather than triggering a render of their own.
  const challengeTokenRef = useRef('');
  const enrollTokenRef = useRef('');
  // Holds the session token + user minted by the enroll-flow confirm call until
  // the user finishes the wizard (after viewing backup codes).
  const pendingRef = useRef<PendingLogin | null>(null);

  const formSchema = useMemo(
    () =>
      z.object({
        username: z.string().trim().min(1, t('common:validation.usernameRequired')),
        password: z.string().min(1, t('common:validation.passwordRequired')),
      }),
    [t],
  );

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: '', password: '' },
  });

  const busy = isLoading || form.formState.isSubmitting;

  // Stash callback in a ref so the SSO-providers fetch effect can run exactly
  // once on mount even when the parent recreates `onLogin` each render.
  const onLoginRef = useRef(onLogin);
  useEffect(() => {
    onLoginRef.current = onLogin;
  }, [onLogin]);

  useEffect(() => {
    let cancelled = false;
    const url = new URL(window.location.href);
    const ssoError = url.searchParams.get('sso_error');
    const ssoTicket = url.searchParams.get('sso_ticket');

    if (ssoError) {
      const code = KNOWN_SSO_ERROR_CODES.has(ssoError) ? ssoError : 'generic';
      dispatchLoginUi({ type: 'setError', error: t(`auth:admin.sso.loginErrors.${code}`) });
    }

    if (ssoError || ssoTicket) {
      url.searchParams.delete('sso_error');
      url.searchParams.delete('sso_ticket');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }

    const loadSsoProviders = async () => {
      try {
        const providers = await api.sso.listPublicProviders();
        if (!cancelled) dispatchLoginUi({ type: 'setSsoProviders', providers });
      } catch {
        if (!cancelled) dispatchLoginUi({ type: 'setSsoProviders', providers: [] });
      }
    };

    const consumeTicket = async (ticket: string) => {
      dispatchLoginUi({ type: 'setLoading', isLoading: true });
      try {
        const response = await api.auth.consumeSsoTicket(ticket);
        if (!cancelled) onLoginRef.current(response.user, response.token);
      } catch (err) {
        if (!cancelled) {
          dispatchLoginUi({
            type: 'setError',
            error: (err as Error).message || t('auth:login.errors.invalidCredentials'),
          });
        }
      } finally {
        if (!cancelled) dispatchLoginUi({ type: 'setLoading', isLoading: false });
      }
    };

    loadSsoProviders();
    if (ssoTicket) void consumeTicket(ssoTicket);

    return () => {
      cancelled = true;
    };
  }, [t]);

  const messageForLoginError = (err: unknown): string => {
    if (err instanceof ApiError && err.errorCode === 'ldap_unavailable') {
      return t('auth:login.errors.ldapUnavailable');
    }
    return (err as Error).message || t('auth:login.errors.invalidCredentials');
  };

  const submitLogin = form.handleSubmit(async ({ username, password }) => {
    try {
      const result = await api.auth.login(username, password);
      // /auth/login may short-circuit into a second-factor branch (no token yet).
      if ('totpRequired' in result) {
        challengeTokenRef.current = result.challengeToken;
        dispatchLoginUi({ type: 'beginTotpChallenge' });
        return;
      }
      if ('totpEnrollmentRequired' in result) {
        enrollTokenRef.current = result.enrollToken;
        pendingRef.current = null;
        dispatchLoginUi({ type: 'beginEnrollment' });
        return;
      }
      onLogin(result.user, result.token);
    } catch (err) {
      dispatchLoginUi({ type: 'setError', error: messageForLoginError(err) });
    }
  });

  // Clear any prior API/SSO error banner on every submit attempt — including when
  // field validation fails — so a stale banner never lingers behind new field errors.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    dispatchLoginUi({ type: 'setError', error: '' });
    void submitLogin(e);
  };

  // Return to the credentials step, discarding any pending second-factor state.
  // `bannerError` surfaces on the credentials form (e.g. an expired challenge).
  const resetToCredentials = (bannerError = '') => {
    challengeTokenRef.current = '';
    enrollTokenRef.current = '';
    pendingRef.current = null;
    dispatchLoginUi({ type: 'resetCredentials', error: bannerError });
  };

  const submitTotpChallenge = async (submittedCode: string) => {
    const code = submittedCode.trim();
    if (verifyingTotp || code.length === 0) return;
    dispatchLoginUi({ type: 'setVerifyingTotp', verifying: true });
    dispatchLoginUi({ type: 'setTotpError', error: '' });
    try {
      const response = await api.auth.totpChallenge(challengeTokenRef.current, code);
      onLogin(response.user, response.token);
    } catch (err) {
      // An expired/invalid challenge token can't be retried — send the user back
      // to the credentials step with an explanatory banner.
      if (err instanceof ApiError && err.errorCode === 'totp_challenge_expired') {
        resetToCredentials(t('auth:totpChallenge.expired'));
        return;
      }
      if (err instanceof ApiError && err.errorCode === 'invalid_totp_code') {
        dispatchLoginUi({ type: 'setTotpError', error: t('auth:totpChallenge.invalidCode') });
      } else {
        dispatchLoginUi({
          type: 'setTotpError',
          error: (err as Error).message || t('auth:totpChallenge.invalidCode'),
        });
      }
      dispatchLoginUi({ type: 'setTotpCode', code: '' });
    } finally {
      dispatchLoginUi({ type: 'setVerifyingTotp', verifying: false });
    }
  };

  const onTotpSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submitTotpChallenge(totpCode);
  };

  // Toggle between the 6-digit authenticator code and a recovery backup code.
  // The two inputs have different shapes, so reset the entry on every switch.
  const toggleBackupCode = () => {
    dispatchLoginUi({ type: 'toggleBackupCode' });
  };

  // Forced-enrollment confirm: capture the issued session token + user so the
  // wizard's onFinished can complete login after backup codes are shown.
  const handleEnrollConfirm = async (code: string) => {
    const result = await api.auth.totpConfirm(code, enrollTokenRef.current);
    if (result.token && result.user) {
      pendingRef.current = { token: result.token, user: result.user };
    }
  };

  const handleEnrollFinished = () => {
    const pending = pendingRef.current;
    if (pending?.token && pending.user) {
      onLogin(pending.user, pending.token);
    }
  };

  const handleSsoLogin = (provider: PublicSsoProvider) => {
    dispatchLoginUi({ type: 'setError', error: '' });
    window.location.href = api.auth.getSsoStartUrl(provider.protocol, provider.slug);
  };

  return (
    <LoginShell browserTheme={browserTheme} isDark={isDark}>
      <LoginLogo
        src={resolvedLogoUrl}
        alt={companyName ? `${companyName} logo` : 'Praetor Logo'}
        isDark={isDark}
        usingCustomLogo={usingCustomLogo}
        onError={() => {
          if (logoUrl) dispatchLoginUi({ type: 'logoFailed', url: logoUrl });
        }}
      />
      <p className="mt-2 text-sm text-muted-foreground">{t('auth:login.title')}</p>

      <LoginStatusAlerts
        logoutReason={logoutReason}
        onClearLogoutReason={onClearLogoutReason}
        serverUnreachable={serverUnreachable}
        onDismissServerUnreachable={onDismissServerUnreachable}
      />

      {phase === 'credentials' && (
        <CredentialsLoginPanel
          form={form}
          ssoProviders={ssoProviders}
          busy={busy}
          showPassword={showPassword}
          error={error}
          onSubmit={onSubmit}
          onSsoLogin={handleSsoLogin}
          onTogglePassword={() => dispatchLoginUi({ type: 'togglePassword' })}
        />
      )}

      {phase === 'totp' && (
        <TotpChallengePanel
          totpCode={totpCode}
          useBackupCode={useBackupCode}
          totpError={totpError}
          verifyingTotp={verifyingTotp}
          onSubmit={onTotpSubmit}
          onCodeChange={(code) =>
            dispatchLoginUi({
              type: 'setTotpCode',
              code,
              clearError: Boolean(totpError),
            })
          }
          onComplete={(code) => void submitTotpChallenge(code)}
          onToggleBackupCode={toggleBackupCode}
          onBack={() => resetToCredentials()}
        />
      )}

      {phase === 'enroll' && (
        <TotpEnrollmentPanel
          onSetup={() => api.auth.totpSetup(enrollTokenRef.current)}
          onConfirm={handleEnrollConfirm}
          onFinished={handleEnrollFinished}
          onCancel={() => resetToCredentials()}
        />
      )}
    </LoginShell>
  );
};

interface LoginShellProps {
  browserTheme: ResolvedTheme;
  isDark: boolean;
  children: React.ReactNode;
}

const LoginShell: React.FC<LoginShellProps> = ({ browserTheme, isDark, children }) => (
  <div
    data-shadcn-theme-scope
    data-shadcn-theme={browserTheme}
    className={cn(
      'shadcn-theme-bridge flex min-h-screen items-center justify-center p-4',
      isDark ? 'bg-black' : 'bg-muted/70',
      getShadcnThemeClassName(browserTheme),
    )}
  >
    <div className="relative w-full max-w-md overflow-hidden rounded-xl border bg-card p-8 text-card-foreground shadow-lg">
      <div className="absolute inset-0 -top-px -left-px z-0" style={gridOverlayStyle} />
      <div className="relative isolate flex w-full flex-col items-center">{children}</div>
    </div>
  </div>
);

interface LoginLogoProps {
  src: string;
  alt: string;
  isDark: boolean;
  usingCustomLogo: boolean;
  onError: () => void;
}

const LoginLogo: React.FC<LoginLogoProps> = ({ src, alt, isDark, usingCustomLogo, onError }) => (
  <img
    src={src}
    alt={alt}
    onError={onError}
    // Only the bundled multi-color Praetor logo is flattened to white in dark mode; a
    // custom uploaded logo is shown as-is so its own colors are preserved. If a custom logo
    // fails to load we fall back to the bundled logo, which again gets the dark treatment.
    className={cn('h-24 object-contain', isDark && !usingCustomLogo && 'brightness-0 invert')}
  />
);

interface LoginStatusAlertsProps {
  logoutReason?: LogoutNotice | null;
  onClearLogoutReason?: () => void;
  serverUnreachable?: boolean;
  onDismissServerUnreachable?: () => void;
}

const LoginStatusAlerts: React.FC<LoginStatusAlertsProps> = ({
  logoutReason,
  onClearLogoutReason,
  serverUnreachable,
  onDismissServerUnreachable,
}) => {
  const { t } = useTranslation(['auth', 'common']);

  return (
    <>
      {logoutReason === 'inactivity' && (
        <div className="mt-6 flex w-full items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 animate-in fade-in slide-in-from-top-2">
          <i className="fa-solid fa-clock mt-0.5 text-amber-500 dark:text-amber-400"></i>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
              {t('auth:session.expired')}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('auth:session.expiredMessage')}
            </p>
          </div>
          {onClearLogoutReason && (
            <button
              type="button"
              onClick={onClearLogoutReason}
              aria-label={t('common:buttons.close')}
              className="text-amber-400 transition-colors hover:text-amber-600 dark:hover:text-amber-300"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          )}
        </div>
      )}

      {logoutReason === 'logout-incomplete' && (
        <Alert className="mt-6 border-amber-500/30 bg-amber-500/10 pr-12 text-amber-800 animate-in fade-in slide-in-from-top-2 dark:text-amber-300">
          <TriangleAlert />
          <AlertTitle>{t('auth:session.logoutIncompleteTitle')}</AlertTitle>
          <AlertDescription className="text-amber-700 dark:text-amber-400">
            {t('auth:session.logoutIncompleteMessage')}
          </AlertDescription>
          {onClearLogoutReason && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onClearLogoutReason}
              aria-label={t('common:buttons.close')}
              className="absolute top-2 right-2 text-amber-700 hover:bg-amber-500/15 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
            >
              <X />
            </Button>
          )}
        </Alert>
      )}

      {serverUnreachable && (
        <div
          role="alert"
          className="mt-6 flex w-full items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 animate-in fade-in slide-in-from-top-2"
        >
          <i className="fa-solid fa-triangle-exclamation mt-0.5 text-red-500 dark:text-red-400"></i>
          <div className="flex-1">
            <p className="text-sm font-bold text-red-800 dark:text-red-300">
              {t('auth:session.serverUnreachableTitle')}
            </p>
            <p className="text-xs text-red-600 dark:text-red-400">
              {t('auth:session.serverUnreachableMessage')}
            </p>
          </div>
          {onDismissServerUnreachable && (
            <button
              type="button"
              aria-label={t('common:buttons.close')}
              onClick={onDismissServerUnreachable}
              className="text-red-400 transition-colors hover:text-red-600 dark:hover:text-red-300"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          )}
        </div>
      )}
    </>
  );
};

interface CredentialsLoginPanelProps {
  form: UseFormReturn<LoginFormValues>;
  ssoProviders: PublicSsoProvider[];
  busy: boolean;
  showPassword: boolean;
  error: string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onSsoLogin: (provider: PublicSsoProvider) => void;
  onTogglePassword: () => void;
}

const CredentialsLoginPanel: React.FC<CredentialsLoginPanelProps> = ({
  form,
  ssoProviders,
  busy,
  showPassword,
  error,
  onSubmit,
  onSsoLogin,
  onTogglePassword,
}) => {
  const { t } = useTranslation(['auth', 'common']);

  return (
    <>
      {ssoProviders.length > 0 && (
        <div className="mt-8 w-full space-y-3">
          {ssoProviders.map((provider) => (
            <Button
              key={`${provider.protocol}-${provider.slug}`}
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => onSsoLogin(provider)}
              disabled={busy}
            >
              <i
                className={`fa-solid ${provider.protocol === 'saml' ? 'fa-building-shield' : 'fa-key'}`}
              ></i>
              {provider.name}
            </Button>
          ))}
          <div className="flex w-full items-center justify-center overflow-hidden">
            <Separator />
            <span className="px-2 text-sm whitespace-nowrap text-muted-foreground">
              {t('auth:login.orPassword', 'or use password')}
            </span>
            <Separator />
          </div>
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className={`w-full space-y-5 ${ssoProviders.length > 0 ? 'mt-0' : 'mt-8'}`}
      >
        <Controller
          control={form.control}
          name="username"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t('common:labels.username')}
              </FieldLabel>
              <Input
                {...field}
                type="text"
                aria-invalid={fieldState.invalid}
                placeholder={t('auth:login.username')}
                aria-label={t('common:labels.username')}
                disabled={busy}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t('common:labels.password')}
              </FieldLabel>
              <div className="relative">
                <Input
                  {...field}
                  type={showPassword ? 'text' : 'password'}
                  aria-invalid={fieldState.invalid}
                  className="pr-9"
                  placeholder={t('auth:login.password')}
                  aria-label={t('common:labels.password')}
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={onTogglePassword}
                  aria-label={t(
                    showPassword ? 'common:labels.hidePassword' : 'common:labels.showPassword',
                  )}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs font-bold text-destructive animate-in fade-in slide-in-from-top-1">
            <i className="fa-solid fa-circle-exclamation"></i>
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? (
            <>
              <i className="fa-solid fa-circle-notch fa-spin"></i>
              {t('auth:login.signingIn')}
            </>
          ) : (
            <>
              {t('auth:login.signIn')} <i className="fa-solid fa-arrow-right"></i>
            </>
          )}
        </Button>
      </form>
    </>
  );
};

interface TotpChallengePanelProps {
  totpCode: string;
  useBackupCode: boolean;
  totpError: string;
  verifyingTotp: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCodeChange: (code: string) => void;
  onComplete: (code: string) => void;
  onToggleBackupCode: () => void;
  onBack: () => void;
}

const TotpChallengePanel: React.FC<TotpChallengePanelProps> = ({
  totpCode,
  useBackupCode,
  totpError,
  verifyingTotp,
  onSubmit,
  onCodeChange,
  onComplete,
  onToggleBackupCode,
  onBack,
}) => {
  const { t } = useTranslation('auth');

  return (
    <div className="mt-8 w-full space-y-5">
      <div className="space-y-1 text-center">
        <h2 className="text-lg font-semibold text-foreground">{t('totpChallenge.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('totpChallenge.description')}</p>
      </div>

      <form onSubmit={onSubmit} className="w-full space-y-5">
        {useBackupCode ? (
          <Field>
            <FieldLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {t('totpChallenge.useBackupCode')}
            </FieldLabel>
            <Input
              type="text"
              autoComplete="one-time-code"
              autoFocus
              value={totpCode}
              onChange={(event) => onCodeChange(event.target.value)}
              aria-invalid={totpError ? true : undefined}
              aria-label={t('totpChallenge.useBackupCode')}
              disabled={verifyingTotp}
            />
          </Field>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {t('totpChallenge.codeLabel')}
            </span>
            <InputOTP
              maxLength={OTP_LENGTH}
              value={totpCode}
              onChange={onCodeChange}
              onComplete={onComplete}
              pattern={REGEXP_ONLY_DIGITS}
              disabled={verifyingTotp}
              autoFocus
              aria-invalid={totpError ? true : undefined}
              aria-label={t('totpChallenge.codeLabel')}
              containerClassName="justify-center"
            >
              <InputOTPGroup>
                {Array.from({ length: OTP_LENGTH }, (_, index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    aria-invalid={totpError ? true : undefined}
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
        )}

        {totpError && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs font-bold text-destructive animate-in fade-in slide-in-from-top-1">
            <i className="fa-solid fa-circle-exclamation"></i>
            {totpError}
          </div>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={
            verifyingTotp ||
            (useBackupCode ? totpCode.trim().length === 0 : totpCode.length !== OTP_LENGTH)
          }
        >
          {verifyingTotp ? (
            <>
              <i className="fa-solid fa-circle-notch fa-spin"></i>
              {t('totpChallenge.verifying')}
            </>
          ) : (
            t('totpChallenge.verify')
          )}
        </Button>
      </form>

      <div className="flex flex-col items-center gap-3">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-sm"
          onClick={onToggleBackupCode}
          disabled={verifyingTotp}
        >
          {t(useBackupCode ? 'totpChallenge.useAuthenticator' : 'totpChallenge.useBackupCode')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-sm text-muted-foreground"
          onClick={onBack}
          disabled={verifyingTotp}
        >
          <i className="fa-solid fa-arrow-left"></i>
          {t('totpChallenge.back')}
        </Button>
      </div>
    </div>
  );
};

interface TotpEnrollmentPanelProps {
  onSetup: () => Promise<TotpSetupResult>;
  onConfirm: (code: string) => Promise<void>;
  onFinished: () => void;
  onCancel: () => void;
}

const TotpEnrollmentPanel: React.FC<TotpEnrollmentPanelProps> = ({
  onSetup,
  onConfirm,
  onFinished,
  onCancel,
}) => {
  const { t } = useTranslation('auth');

  return (
    <div className="mt-8 w-full space-y-5">
      <div className="space-y-1 text-center">
        <h2 className="text-lg font-semibold text-foreground">{t('totpEnroll.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('totpEnroll.description')}</p>
      </div>

      <TotpSetupWizard
        onSetup={onSetup}
        onConfirm={onConfirm}
        onFinished={onFinished}
        onCancel={onCancel}
      />
    </div>
  );
};

export default Login;
