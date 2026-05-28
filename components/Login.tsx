import { zodResolver } from '@hookform/resolvers/zod';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import api, { ApiError } from '../services/api';
import { type PublicSsoProvider, SSO_LOGIN_ERROR_CODES, type User } from '../types';

export interface LoginProps {
  onLogin: (user: User, token?: string) => void;
  logoutReason?: 'inactivity' | null;
  onClearLogoutReason?: () => void;
  serverUnreachable?: boolean;
  onDismissServerUnreachable?: () => void;
}

interface LoginFormValues {
  username: string;
  password: string;
}

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
}) => {
  const { t } = useTranslation(['auth', 'common', 'notifications']);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ssoProviders, setSsoProviders] = useState<PublicSsoProvider[]>([]);

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

  // Mount-only: SSO provider list and ticket consumption shouldn't re-run on
  // every parent re-render. `onLogin` is read through `onLoginRef`, and `t`
  // is referenced only for an error message lookup at that moment.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
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
  }, []);

  const messageForLoginError = (err: unknown): string => {
    if (err instanceof ApiError && err.errorCode === 'ldap_unavailable') {
      return t('auth:login.errors.ldapUnavailable');
    }
    return (err as Error).message || t('auth:login.errors.invalidCredentials');
  };

  const submitLogin = form.handleSubmit(async ({ username, password }) => {
    try {
      const response = await api.auth.login(username, password);
      onLogin(response.user, response.token);
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

  const handleSsoLogin = (provider: PublicSsoProvider) => {
    setError('');
    window.location.href = api.auth.getSsoStartUrl(provider.protocol, provider.slug);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/70 p-4">
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border bg-card px-8 py-8 shadow-lg">
        <div className="absolute inset-0 -top-px -left-px z-0" style={gridOverlayStyle} />

        <div className="relative isolate flex w-full flex-col items-center">
          <img src="/praetor-logo.png" alt="Praetor Logo" className="h-24 object-contain" />
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
        </div>
      </div>
    </div>
  );
};

export default Login;
