import { zodResolver } from '@hookform/resolvers/zod';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Separator } from '@/components/ui/separator';
import { getShadcnThemeClassName, useBrowserTheme } from '@/components/ui/use-shadcn-theme';
import { cn } from '@/lib/utils';
import api, { ApiError } from '../services/api';
import { type PublicSsoProvider, SSO_LOGIN_ERROR_CODES, type User } from '../types';
import TotpSetupWizard from './TotpSetupWizard';

export interface LoginProps {
  onLogin: (user: User, token?: string) => void;
  logoutReason?: 'inactivity' | null;
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
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ssoProviders, setSsoProviders] = useState<PublicSsoProvider[]>([]);
  // Fall back to the bundled logo if a custom logoUrl fails to load (the server returns 404 for a
  // logo whose file is missing on disk). Tracking the failed URL (vs a boolean + reset effect)
  // retries automatically when logoUrl changes and can't loop on a failing fallback.
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const usingCustomLogo = Boolean(logoUrl) && logoUrl !== failedLogoUrl;
  const resolvedLogoUrl = logoUrl && logoUrl !== failedLogoUrl ? logoUrl : '/praetor-logo.png';

  // Second-factor flow state. `challengeToken`/`enrollToken` are short-lived
  // server tokens returned by /auth/login that authorize the follow-up call.
  const [phase, setPhase] = useState<LoginPhase>('credentials');
  const [challengeToken, setChallengeToken] = useState('');
  const [enrollToken, setEnrollToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [totpError, setTotpError] = useState('');
  const [verifyingTotp, setVerifyingTotp] = useState(false);
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
      setError(t(`auth:admin.sso.loginErrors.${code}`));
    }

    if (ssoError || ssoTicket) {
      url.searchParams.delete('sso_error');
      url.searchParams.delete('sso_ticket');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }

    const loadSsoProviders = async () => {
      try {
        const providers = await api.sso.listPublicProviders();
        if (!cancelled) setSsoProviders(providers);
      } catch {
        if (!cancelled) setSsoProviders([]);
      }
    };

    const consumeTicket = async (ticket: string) => {
      setIsLoading(true);
      try {
        const response = await api.auth.consumeSsoTicket(ticket);
        if (!cancelled) onLoginRef.current(response.user, response.token);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || t('auth:login.errors.invalidCredentials'));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
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
        setChallengeToken(result.challengeToken);
        setTotpCode('');
        setUseBackupCode(false);
        setTotpError('');
        setPhase('totp');
        return;
      }
      if ('totpEnrollmentRequired' in result) {
        setEnrollToken(result.enrollToken);
        pendingRef.current = null;
        setPhase('enroll');
        return;
      }
      onLogin(result.user, result.token);
    } catch (err) {
      setError(messageForLoginError(err));
    }
  });

  // Clear any prior API/SSO error banner on every submit attempt — including when
  // field validation fails — so a stale banner never lingers behind new field errors.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    setError('');
    void submitLogin(e);
  };

  // Return to the credentials step, discarding any pending second-factor state.
  // `bannerError` surfaces on the credentials form (e.g. an expired challenge).
  const resetToCredentials = (bannerError = '') => {
    setPhase('credentials');
    setChallengeToken('');
    setEnrollToken('');
    setTotpCode('');
    setUseBackupCode(false);
    setTotpError('');
    pendingRef.current = null;
    setError(bannerError);
  };

  const submitTotpChallenge = async (submittedCode: string) => {
    const code = submittedCode.trim();
    if (verifyingTotp || code.length === 0) return;
    setVerifyingTotp(true);
    setTotpError('');
    try {
      const response = await api.auth.totpChallenge(challengeToken, code);
      onLogin(response.user, response.token);
    } catch (err) {
      // An expired/invalid challenge token can't be retried — send the user back
      // to the credentials step with an explanatory banner.
      if (err instanceof ApiError && err.errorCode === 'totp_challenge_expired') {
        resetToCredentials(t('auth:totpChallenge.expired'));
        return;
      }
      if (err instanceof ApiError && err.errorCode === 'invalid_totp_code') {
        setTotpError(t('auth:totpChallenge.invalidCode'));
      } else {
        setTotpError((err as Error).message || t('auth:totpChallenge.invalidCode'));
      }
      setTotpCode('');
    } finally {
      setVerifyingTotp(false);
    }
  };

  const onTotpSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submitTotpChallenge(totpCode);
  };

  // Toggle between the 6-digit authenticator code and a recovery backup code.
  // The two inputs have different shapes, so reset the entry on every switch.
  const toggleBackupCode = () => {
    setUseBackupCode((prev) => !prev);
    setTotpCode('');
    setTotpError('');
  };

  // Forced-enrollment confirm: capture the issued session token + user so the
  // wizard's onFinished can complete login after backup codes are shown.
  const handleEnrollConfirm = async (code: string) => {
    const result = await api.auth.totpConfirm(code, enrollToken);
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
    setError('');
    window.location.href = api.auth.getSsoStartUrl(provider.protocol, provider.slug);
  };

  return (
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

        <div className="relative isolate flex w-full flex-col items-center">
          <img
            src={resolvedLogoUrl}
            alt={companyName ? `${companyName} logo` : 'Praetor Logo'}
            onError={() => {
              if (logoUrl) setFailedLogoUrl(logoUrl);
            }}
            // Only the bundled multi-color Praetor logo is flattened to white in dark mode; a
            // custom uploaded logo is shown as-is so its own colors are preserved. If a custom logo
            // fails to load we fall back to the bundled logo, which again gets the dark treatment.
            className={cn(
              'h-24 object-contain',
              isDark && !usingCustomLogo && 'brightness-0 invert',
            )}
          />
          <p className="mt-2 text-sm text-muted-foreground">{t('auth:login.title')}</p>

          {logoutReason === 'inactivity' && (
            <div className="mt-6 flex w-full items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 animate-in fade-in slide-in-from-top-2">
              <i className="fa-solid fa-clock mt-0.5 text-amber-500"></i>
              <div className="flex-1">
                <p className="text-sm font-bold text-amber-800">{t('auth:session.expired')}</p>
                <p className="text-xs text-amber-600">{t('auth:session.expiredMessage')}</p>
              </div>
              {onClearLogoutReason && (
                <button
                  type="button"
                  onClick={onClearLogoutReason}
                  aria-label={t('common:buttons.close')}
                  className="text-amber-400 transition-colors hover:text-amber-600"
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              )}
            </div>
          )}

          {serverUnreachable && (
            <div
              role="alert"
              className="mt-6 flex w-full items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 animate-in fade-in slide-in-from-top-2"
            >
              <i className="fa-solid fa-triangle-exclamation mt-0.5 text-red-500"></i>
              <div className="flex-1">
                <p className="text-sm font-bold text-red-800">
                  {t('auth:session.serverUnreachableTitle')}
                </p>
                <p className="text-xs text-red-600">{t('auth:session.serverUnreachableMessage')}</p>
              </div>
              {onDismissServerUnreachable && (
                <button
                  type="button"
                  aria-label={t('common:buttons.close')}
                  onClick={onDismissServerUnreachable}
                  className="text-red-400 transition-colors hover:text-red-600"
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              )}
            </div>
          )}

          {phase === 'credentials' && (
            <>
              {ssoProviders.length > 0 && (
                <div className="mt-8 w-full space-y-3">
                  {ssoProviders.map((provider) => (
                    <Button
                      key={`${provider.protocol}-${provider.slug}`}
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => handleSsoLogin(provider)}
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
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={t(
                            showPassword
                              ? 'common:labels.hidePassword'
                              : 'common:labels.showPassword',
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
          )}

          {phase === 'totp' && (
            <div className="mt-8 w-full space-y-5">
              <div className="space-y-1 text-center">
                <h2 className="text-lg font-semibold text-foreground">
                  {t('auth:totpChallenge.title')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('auth:totpChallenge.description')}
                </p>
              </div>

              <form onSubmit={onTotpSubmit} className="w-full space-y-5">
                {useBackupCode ? (
                  <Field>
                    <FieldLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {t('auth:totpChallenge.useBackupCode')}
                    </FieldLabel>
                    <Input
                      type="text"
                      autoComplete="one-time-code"
                      autoFocus
                      value={totpCode}
                      onChange={(e) => {
                        setTotpCode(e.target.value);
                        if (totpError) setTotpError('');
                      }}
                      aria-invalid={totpError ? true : undefined}
                      aria-label={t('auth:totpChallenge.useBackupCode')}
                      disabled={verifyingTotp}
                    />
                  </Field>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {t('auth:totpChallenge.codeLabel')}
                    </span>
                    <InputOTP
                      maxLength={OTP_LENGTH}
                      value={totpCode}
                      onChange={(value) => {
                        setTotpCode(value);
                        if (totpError) setTotpError('');
                      }}
                      onComplete={(value) => void submitTotpChallenge(value)}
                      pattern={REGEXP_ONLY_DIGITS}
                      disabled={verifyingTotp}
                      autoFocus
                      aria-invalid={totpError ? true : undefined}
                      aria-label={t('auth:totpChallenge.codeLabel')}
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
                      {t('auth:totpChallenge.verifying')}
                    </>
                  ) : (
                    t('auth:totpChallenge.verify')
                  )}
                </Button>
              </form>

              <div className="flex flex-col items-center gap-3">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-sm"
                  onClick={toggleBackupCode}
                  disabled={verifyingTotp}
                >
                  {t(
                    useBackupCode
                      ? 'auth:totpChallenge.useAuthenticator'
                      : 'auth:totpChallenge.useBackupCode',
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-sm text-muted-foreground"
                  onClick={() => resetToCredentials()}
                  disabled={verifyingTotp}
                >
                  <i className="fa-solid fa-arrow-left"></i>
                  {t('auth:totpChallenge.back')}
                </Button>
              </div>
            </div>
          )}

          {phase === 'enroll' && (
            <div className="mt-8 w-full space-y-5">
              <div className="space-y-1 text-center">
                <h2 className="text-lg font-semibold text-foreground">
                  {t('auth:totpEnroll.title')}
                </h2>
                <p className="text-sm text-muted-foreground">{t('auth:totpEnroll.description')}</p>
              </div>

              <TotpSetupWizard
                onSetup={() => api.auth.totpSetup(enrollToken)}
                onConfirm={handleEnrollConfirm}
                onFinished={handleEnrollFinished}
                onCancel={() => resetToCredentials()}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
