import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { THEME_STORAGE_KEY } from '../../utils/theme';
import { ApiErrorStub } from '../helpers/apiErrorStub';
import { installI18nMock } from '../helpers/i18n';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';

installI18nMock();

// Drive the login screen's theme from a controllable `prefers-color-scheme`
// media query so we can assert it follows the OS instead of any saved choice.
// Installed per-test and restored afterward so the override never leaks into
// other suites (a stale dark preference would flip their resolved theme).
let prefersDarkScheme = false;
type ColorSchemeListener = (event: MediaQueryListEvent) => void;
const colorSchemeListeners = new Set<ColorSchemeListener>();
const originalMatchMedia = window.matchMedia;

const mockMatchMedia = ((query: string) =>
  ({
    get matches() {
      return query.includes('prefers-color-scheme: dark') ? prefersDarkScheme : false;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, callback: ColorSchemeListener) => {
      colorSchemeListeners.add(callback);
    },
    removeEventListener: (_type: string, callback: ColorSchemeListener) => {
      colorSchemeListeners.delete(callback);
    },
    addListener: (callback: ColorSchemeListener) => {
      colorSchemeListeners.add(callback);
    },
    removeListener: (callback: ColorSchemeListener) => {
      colorSchemeListeners.delete(callback);
    },
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof window.matchMedia;

const setPrefersDarkScheme = (matches: boolean) => {
  prefersDarkScheme = matches;
  const event = { matches } as MediaQueryListEvent;
  for (const listener of colorSchemeListeners) listener(event);
};

// login() resolves to one of three shapes: the canonical { user, token }, a TOTP
// challenge, or a forced-enrollment ticket. Type the mock as the union so the
// second-factor tests can resolve the challenge/enroll branches.
type LoginMockResult =
  | { user: { id: string; name: string }; token: string }
  | { totpRequired: true; challengeToken: string }
  | { totpEnrollmentRequired: true; enrollToken: string };

const apiAuthLogin = mock<(_u: string, _p: string) => Promise<LoginMockResult>>(
  (_u: string, _p: string) => Promise.resolve({ user: { id: 'u1', name: 'Test' }, token: 'tok' }),
);
// Second-factor verification: exchanges a challenge token + code for the canonical
// { user, token }. Defaults to a successful login.
const apiAuthTotpChallenge = mock((_challengeToken: string, _code: string) =>
  Promise.resolve({ user: { id: 'u1', name: 'Test' }, token: 'tok' }),
);
// Forced-enrollment setup: returns the secret/QR/backup codes the wizard renders.
const apiAuthTotpSetup = mock((_bearerToken?: string) =>
  Promise.resolve({
    secret: 'SECRET123',
    otpauthUri: 'otpauth://totp/Praetor:test?secret=SECRET123',
    qrDataUri: 'data:image/png;base64,QR',
    backupCodes: ['code-1', 'code-2'],
  }),
);
// Forced-enrollment confirm: the enroll path also mints a session token + user.
const apiAuthTotpConfirm = mock((_code: string, _bearerToken?: string) =>
  Promise.resolve({
    enabled: true as const,
    token: 'enroll-tok',
    user: { id: 'u1', name: 'Test' },
  }),
);
const apiAuthConsumeSsoTicket = mock((_ticket: string) =>
  Promise.resolve({ user: { id: 'sso-user', name: 'SSO User' }, token: 'sso-token' }),
);
const apiAuthGetSsoStartUrl = mock(
  (protocol: 'oidc' | 'saml', slug: string) =>
    `http://localhost/api/auth/sso/${protocol}/${slug}/start`,
);
type PublicProviderFixture = { protocol: 'oidc' | 'saml'; slug: string; name: string };

const pendingProviderLoad = () => new Promise<PublicProviderFixture[]>(() => {});
const apiSsoListPublicProviders = mock(pendingProviderLoad);

const setTestUrl = (url: string) => {
  (window as unknown as { happyDOM: { setURL: (nextUrl: string) => void } }).happyDOM.setURL(url);
};

mock.module('../../services/api', () => ({
  default: {
    auth: {
      login: (username: string, password: string) => apiAuthLogin(username, password),
      totpChallenge: (challengeToken: string, code: string) =>
        apiAuthTotpChallenge(challengeToken, code),
      totpSetup: (bearerToken?: string) => apiAuthTotpSetup(bearerToken),
      totpConfirm: (code: string, bearerToken?: string) => apiAuthTotpConfirm(code, bearerToken),
      consumeSsoTicket: (ticket: string) => apiAuthConsumeSsoTicket(ticket),
      getSsoStartUrl: (protocol: 'oidc' | 'saml', slug: string) =>
        apiAuthGetSsoStartUrl(protocol, slug),
    },
    sso: {
      listPublicProviders: () => apiSsoListPublicProviders(),
    },
  },
  ApiError: ApiErrorStub,
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

clearSpyStateAfterAll();

const Login = (await import('../../components/Login')).default;

describe('<Login />', () => {
  beforeEach(() => {
    apiAuthLogin.mockReset();
    apiAuthTotpChallenge.mockReset();
    apiAuthTotpSetup.mockReset();
    apiAuthTotpConfirm.mockReset();
    apiAuthConsumeSsoTicket.mockReset();
    apiAuthGetSsoStartUrl.mockReset();
    apiSsoListPublicProviders.mockReset();
    apiAuthLogin.mockImplementation((_u: string, _p: string) =>
      Promise.resolve({ user: { id: 'u1', name: 'Test' }, token: 'tok' }),
    );
    apiAuthTotpChallenge.mockImplementation((_challengeToken: string, _code: string) =>
      Promise.resolve({ user: { id: 'u1', name: 'Test' }, token: 'tok' }),
    );
    apiAuthTotpSetup.mockImplementation((_bearerToken?: string) =>
      Promise.resolve({
        secret: 'SECRET123',
        otpauthUri: 'otpauth://totp/Praetor:test?secret=SECRET123',
        qrDataUri: 'data:image/png;base64,QR',
        backupCodes: ['code-1', 'code-2'],
      }),
    );
    apiAuthTotpConfirm.mockImplementation((_code: string, _bearerToken?: string) =>
      Promise.resolve({
        enabled: true as const,
        token: 'enroll-tok',
        user: { id: 'u1', name: 'Test' },
      }),
    );
    apiAuthConsumeSsoTicket.mockImplementation((_ticket: string) =>
      Promise.resolve({ user: { id: 'sso-user', name: 'SSO User' }, token: 'sso-token' }),
    );
    apiAuthGetSsoStartUrl.mockImplementation(
      (protocol: 'oidc' | 'saml', slug: string) =>
        `http://localhost/api/auth/sso/${protocol}/${slug}/start`,
    );
    apiSsoListPublicProviders.mockImplementation(pendingProviderLoad);
    setTestUrl('http://localhost/');
    localStorage.clear();
    colorSchemeListeners.clear();
    prefersDarkScheme = false;
    window.matchMedia = mockMatchMedia;
  });

  afterEach(() => {
    apiAuthLogin.mockReset();
    apiAuthTotpChallenge.mockReset();
    apiAuthTotpSetup.mockReset();
    apiAuthTotpConfirm.mockReset();
    apiAuthConsumeSsoTicket.mockReset();
    apiAuthGetSsoStartUrl.mockReset();
    apiSsoListPublicProviders.mockReset();
    window.matchMedia = originalMatchMedia;
    colorSchemeListeners.clear();
    prefersDarkScheme = false;
  });

  test('renders title and both input fields', () => {
    render(<Login onLogin={() => {}} />);
    expect(screen.getByText('auth:login.title')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('auth:login.username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('auth:login.password')).toBeInTheDocument();
  });

  test('username and password labels omit the required asterisk', () => {
    // The login form intentionally drops the red required-field markers, so the
    // RequiredMark "*" rendered by FieldLabel's `required` prop must be absent.
    render(<Login onLogin={() => {}} />);
    expect(screen.getByText('common:labels.username')).toBeInTheDocument();
    expect(screen.getByText('common:labels.password')).toBeInTheDocument();
    expect(screen.queryByText('*')).not.toBeInTheDocument();
  });

  test('submitting empty fields shows usernameRequired and passwordRequired errors', async () => {
    render(<Login onLogin={() => {}} />);
    const submit = screen.getByRole('button', { name: /auth:login.signIn/ });
    fireEvent.click(submit);
    expect(await screen.findByText('common:validation.usernameRequired')).toBeInTheDocument();
    expect(screen.getByText('common:validation.passwordRequired')).toBeInTheDocument();
    expect(apiAuthLogin).not.toHaveBeenCalled();
  });

  test('successful login calls onLogin with user and token', async () => {
    const onLogin = mock((_u: unknown, _t?: string) => {});
    render(<Login onLogin={onLogin} />);

    fireEvent.change(screen.getByPlaceholderText('auth:login.username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByPlaceholderText('auth:login.password'), {
      target: { value: 'password' },
    });

    const submit = screen.getByRole('button', { name: /auth:login.signIn/ });
    fireEvent.click(submit);

    await waitFor(() => expect(apiAuthLogin).toHaveBeenCalledWith('admin', 'password'));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith({ id: 'u1', name: 'Test' }, 'tok'));
  });

  test('login rejection surfaces error message', async () => {
    apiAuthLogin.mockImplementation(() => Promise.reject(new Error('Bad credentials')));

    render(<Login onLogin={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('auth:login.username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByPlaceholderText('auth:login.password'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /auth:login.signIn/ }));

    expect(await screen.findByText('Bad credentials')).toBeInTheDocument();
  });

  test('503 ldap_unavailable shows specific i18n message instead of server text', async () => {
    apiAuthLogin.mockImplementation(() =>
      Promise.reject(
        new ApiErrorStub(
          'Authentication service temporarily unavailable',
          503,
          false,
          'ldap_unavailable',
        ),
      ),
    );

    render(<Login onLogin={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('auth:login.username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByPlaceholderText('auth:login.password'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /auth:login.signIn/ }));

    expect(await screen.findByText('auth:login.errors.ldapUnavailable')).toBeInTheDocument();
  });

  test('password toggle flips input type between password and text', () => {
    render(<Login onLogin={() => {}} />);
    const passwordInput = screen.getByPlaceholderText('auth:login.password') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    // The toggle is identified by its aria-label, which flips with the revealed state.
    fireEvent.click(screen.getByLabelText('common:labels.showPassword'));
    expect(passwordInput.type).toBe('text');

    fireEvent.click(screen.getByLabelText('common:labels.hidePassword'));
    expect(passwordInput.type).toBe('password');
  });

  test('logoutReason="inactivity" renders banner; dismiss calls onClearLogoutReason', () => {
    const onClear = mock(() => {});
    render(<Login onLogin={() => {}} logoutReason="inactivity" onClearLogoutReason={onClear} />);
    expect(screen.getByText('auth:session.expired')).toBeInTheDocument();
    expect(screen.getByText('auth:session.expiredMessage')).toBeInTheDocument();

    const dismissButton = screen
      .getAllByRole('button')
      .find((btn) => btn.querySelector('i.fa-xmark'));
    if (!dismissButton) throw new Error('dismiss button not found');
    fireEvent.click(dismissButton);
    expect(onClear).toHaveBeenCalled();
  });

  test('without logoutReason banner does not render', () => {
    render(<Login onLogin={() => {}} />);
    expect(screen.queryByText('auth:session.expired')).not.toBeInTheDocument();
  });

  test('shows loading state while login promise pending', async () => {
    let resolveLogin:
      | ((value: { user: { id: string; name: string }; token: string }) => void)
      | undefined;
    apiAuthLogin.mockImplementation(
      () =>
        new Promise<{ user: { id: string; name: string }; token: string }>((resolve) => {
          resolveLogin = resolve;
        }),
    );

    render(<Login onLogin={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('auth:login.username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByPlaceholderText('auth:login.password'), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: /auth:login.signIn/ }));

    expect(await screen.findByText('auth:login.signingIn')).toBeInTheDocument();

    if (resolveLogin) resolveLogin({ user: { id: 'u', name: 'u' }, token: 't' });
    await waitFor(() => expect(screen.queryByText('auth:login.signingIn')).not.toBeInTheDocument());
  });

  test('typing clears the field error', async () => {
    render(<Login onLogin={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /auth:login.signIn/ }));
    expect(await screen.findByText('common:validation.usernameRequired')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('auth:login.username'), {
      target: { value: 'admin' },
    });
    await waitFor(() =>
      expect(screen.queryByText('common:validation.usernameRequired')).not.toBeInTheDocument(),
    );
  });

  test('submitting empty fields clears a pre-existing error banner', async () => {
    // A pre-existing SSO error banner must not linger once the user re-attempts login,
    // even when field validation blocks the submit.
    setTestUrl('http://localhost/?sso_error=invalid_response');
    render(<Login onLogin={() => {}} />);
    expect(screen.getByText('auth:admin.sso.loginErrors.invalid_response')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /auth:login.signIn/ }));

    await waitFor(() =>
      expect(
        screen.queryByText('auth:admin.sso.loginErrors.invalid_response'),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('common:validation.usernameRequired')).toBeInTheDocument();
  });

  test('renders public SSO providers and redirects to provider start URL', async () => {
    apiSsoListPublicProviders.mockResolvedValue([
      { protocol: 'oidc', slug: 'keycloak', name: 'Keycloak' },
    ]);

    render(<Login onLogin={() => {}} />);
    const button = await screen.findByRole('button', { name: /Keycloak/ });

    fireEvent.click(button);

    expect(apiAuthGetSsoStartUrl).toHaveBeenCalledWith('oidc', 'keycloak');
  });

  test('starts sso_ticket consumption and removes the query param', async () => {
    setTestUrl('http://localhost/?sso_ticket=ticket-1');
    apiAuthConsumeSsoTicket.mockImplementation(() => new Promise(() => {}));

    render(<Login onLogin={() => {}} />);

    await waitFor(() => {
      expect(apiAuthConsumeSsoTicket).toHaveBeenCalledWith('ticket-1');
    });
    expect(window.location.search).not.toContain('sso_ticket');
  });

  // Issue #604 — the URL `sso_error` param carries a stable code; the UI must translate it.
  // It must never render the code or any raw text from the URL verbatim.
  test('sso_error code is translated, not rendered verbatim', () => {
    setTestUrl('http://localhost/?sso_error=invalid_response');

    render(<Login onLogin={() => {}} />);

    expect(screen.getByText('auth:admin.sso.loginErrors.invalid_response')).toBeInTheDocument();
    // Negative assertion: the raw code must not be visible to the user.
    expect(screen.queryByText('invalid_response')).not.toBeInTheDocument();
    // The query param is cleaned from the URL after read.
    expect(window.location.search).not.toContain('sso_error');
  });

  test('unknown sso_error value falls back to the generic translation', () => {
    // Hand-crafted URL with attacker-influenced text — must never reach the DOM.
    setTestUrl('http://localhost/?sso_error=SAML+response+did+not+include+a+subject');

    render(<Login onLogin={() => {}} />);

    expect(screen.getByText('auth:admin.sso.loginErrors.generic')).toBeInTheDocument();
    expect(screen.queryByText(/SAML response did not include a subject/)).not.toBeInTheDocument();
  });

  describe('respects the OS/browser theme instead of the saved preference', () => {
    test('renders in dark mode when the OS prefers a dark color scheme', () => {
      setPrefersDarkScheme(true);

      const { container } = render(<Login onLogin={() => {}} />);
      const scope = container.querySelector('[data-shadcn-theme-scope]');

      expect(scope?.getAttribute('data-shadcn-theme')).toBe('dark');
      expect(scope?.classList.contains('dark')).toBe(true);
    });

    test('renders in light mode when the OS prefers a light color scheme', () => {
      setPrefersDarkScheme(false);

      const { container } = render(<Login onLogin={() => {}} />);
      const scope = container.querySelector('[data-shadcn-theme-scope]');

      expect(scope?.getAttribute('data-shadcn-theme')).toBe('light');
      expect(scope?.classList.contains('dark')).toBe(false);
    });

    test('ignores a saved theme preference and follows the OS instead', () => {
      // A previously signed-in user picked the dark theme...
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      // ...but the OS is in light mode, so the login screen must render light.
      setPrefersDarkScheme(false);

      const { container } = render(<Login onLogin={() => {}} />);
      const scope = container.querySelector('[data-shadcn-theme-scope]');

      expect(scope?.getAttribute('data-shadcn-theme')).toBe('light');
      expect(scope?.classList.contains('dark')).toBe(false);
      // The stored preference is left untouched for use after sign-in.
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });

    test('updates live when the OS color scheme changes', async () => {
      setPrefersDarkScheme(false);

      const { container } = render(<Login onLogin={() => {}} />);
      const scope = container.querySelector('[data-shadcn-theme-scope]');
      expect(scope?.classList.contains('dark')).toBe(false);

      await act(async () => {
        setPrefersDarkScheme(true);
      });

      await waitFor(() => expect(scope?.classList.contains('dark')).toBe(true));
    });
  });

  describe('dark-mode appearance', () => {
    test('uses a black page background and a flattened-white logo in dark mode', () => {
      setPrefersDarkScheme(true);

      const { container } = render(<Login onLogin={() => {}} />);
      const scope = container.querySelector('[data-shadcn-theme-scope]');
      const logo = screen.getByAltText('Praetor Logo');

      expect(scope?.classList.contains('bg-black')).toBe(true);
      expect(scope?.classList.contains('bg-muted/70')).toBe(false);
      // brightness-0 + invert renders the multi-color logo as solid white.
      expect(logo.classList.contains('brightness-0')).toBe(true);
      expect(logo.classList.contains('invert')).toBe(true);
    });

    // Regression: the card paired `bg-card` with no foreground token, so input
    // text fell back to the browser default (black) and was unreadable on the
    // dark card. The `text-card-foreground` token must travel with `bg-card` so
    // typed text adapts to the theme.
    test('card carries the card-foreground token alongside bg-card', () => {
      setPrefersDarkScheme(true);

      const { container } = render(<Login onLogin={() => {}} />);
      const card = container.querySelector('.bg-card');

      expect(card).not.toBeNull();
      expect(card?.classList.contains('text-card-foreground')).toBe(true);
    });

    test('keeps the muted background and original logo colors in light mode', () => {
      setPrefersDarkScheme(false);

      const { container } = render(<Login onLogin={() => {}} />);
      const scope = container.querySelector('[data-shadcn-theme-scope]');
      const logo = screen.getByAltText('Praetor Logo');

      expect(scope?.classList.contains('bg-muted/70')).toBe(true);
      expect(scope?.classList.contains('bg-black')).toBe(false);
      expect(logo.classList.contains('brightness-0')).toBe(false);
      expect(logo.classList.contains('invert')).toBe(false);
    });

    // The logout/error banners used a hardcoded light palette (bg-amber-50 / bg-red-50 with no
    // dark: variant), so they rendered as a pale slab on the dark login page. They now use the
    // same translucent treatment as the dialog banners plus explicit dark-mode text colors.
    test('the inactivity logout banner uses theme-aware amber, not a light slab', () => {
      render(<Login onLogin={() => {}} logoutReason="inactivity" />);
      const title = screen.getByText('auth:session.expired');
      const banner = title.parentElement?.parentElement;

      expect(banner?.classList.contains('bg-amber-500/10')).toBe(true);
      expect(banner?.classList.contains('border-amber-500/30')).toBe(true);
      // The old solid light slab is gone.
      expect(banner?.classList.contains('bg-amber-50')).toBe(false);
      expect(banner?.classList.contains('border-amber-200')).toBe(false);
      // The title carries an explicit dark-mode color so it stays legible on the dark page.
      expect(title.classList.contains('dark:text-amber-300')).toBe(true);
    });

    test('the server-unreachable banner uses theme-aware red, not a light slab', () => {
      render(<Login onLogin={() => {}} serverUnreachable />);
      // The red banner carries role="alert".
      const banner = screen.getByRole('alert');

      expect(banner.classList.contains('bg-red-500/10')).toBe(true);
      expect(banner.classList.contains('border-red-500/30')).toBe(true);
      expect(banner.classList.contains('bg-red-50')).toBe(false);
      expect(banner.classList.contains('border-red-200')).toBe(false);
      expect(
        screen
          .getByText('auth:session.serverUnreachableTitle')
          .classList.contains('dark:text-red-300'),
      ).toBe(true);
    });
  });

  describe('custom branding', () => {
    test('renders the uploaded logo and skips the dark-mode invert', () => {
      // Even in dark mode a custom logo keeps its own colors — only the bundled
      // multi-color Praetor logo is flattened to white via brightness-0 + invert.
      setPrefersDarkScheme(true);

      render(<Login onLogin={() => {}} companyName="Acme" logoUrl="/api/branding/logo?v=1" />);
      const logo = screen.getByAltText('Acme logo');

      expect(logo.getAttribute('src')).toBe('/api/branding/logo?v=1');
      expect(logo.classList.contains('brightness-0')).toBe(false);
      expect(logo.classList.contains('invert')).toBe(false);
    });

    test('falls back to the bundled Praetor logo when no custom logo is set', () => {
      render(<Login onLogin={() => {}} />);
      const logo = screen.getByAltText('Praetor Logo');
      expect(logo.getAttribute('src')).toBe('/praetor-logo.png');
    });

    test('falls back to the bundled logo (with dark-mode invert) if the custom logo fails to load', () => {
      // The server 404s a logo whose file is missing on disk, so the <img> errors; we must drop
      // back to the bundled Praetor logo instead of leaving the browser's broken-image glyph.
      setPrefersDarkScheme(true);
      render(<Login onLogin={() => {}} companyName="Acme" logoUrl="/api/branding/logo?v=1" />);

      expect(screen.getByAltText('Acme logo').getAttribute('src')).toBe('/api/branding/logo?v=1');

      fireEvent.error(screen.getByAltText('Acme logo'));

      // Now showing the bundled default, which regains the dark-mode white-flatten treatment.
      const logo = screen.getByAltText('Acme logo');
      expect(logo.getAttribute('src')).toBe('/praetor-logo.png');
      expect(logo.classList.contains('brightness-0')).toBe(true);
      expect(logo.classList.contains('invert')).toBe(true);
    });
  });
});

// Multi-step second factor: /auth/login can short-circuit into a TOTP challenge
// (existing 2FA user) or a forced-enrollment wizard (admin who must enable 2FA).
// These tests reset the shared api.auth mocks in the outer beforeEach/afterEach.
describe('<Login /> second factor', () => {
  beforeEach(() => {
    apiAuthLogin.mockReset();
    apiAuthTotpChallenge.mockReset();
    apiAuthTotpSetup.mockReset();
    apiAuthTotpConfirm.mockReset();
    apiAuthConsumeSsoTicket.mockReset();
    apiAuthGetSsoStartUrl.mockReset();
    apiSsoListPublicProviders.mockReset();
    apiAuthTotpChallenge.mockImplementation((_challengeToken: string, _code: string) =>
      Promise.resolve({ user: { id: 'u1', name: 'Test' }, token: 'tok' }),
    );
    apiAuthTotpSetup.mockImplementation((_bearerToken?: string) =>
      Promise.resolve({
        secret: 'SECRET123',
        otpauthUri: 'otpauth://totp/Praetor:test?secret=SECRET123',
        qrDataUri: 'data:image/png;base64,QR',
        backupCodes: ['code-1', 'code-2'],
      }),
    );
    apiAuthTotpConfirm.mockImplementation((_code: string, _bearerToken?: string) =>
      Promise.resolve({
        enabled: true as const,
        token: 'enroll-tok',
        user: { id: 'u1', name: 'Test' },
      }),
    );
    apiSsoListPublicProviders.mockImplementation(pendingProviderLoad);
    setTestUrl('http://localhost/');
    localStorage.clear();
    colorSchemeListeners.clear();
    prefersDarkScheme = false;
    window.matchMedia = mockMatchMedia;
  });

  afterEach(() => {
    apiAuthLogin.mockReset();
    apiAuthTotpChallenge.mockReset();
    apiAuthTotpSetup.mockReset();
    apiAuthTotpConfirm.mockReset();
    apiAuthConsumeSsoTicket.mockReset();
    apiAuthGetSsoStartUrl.mockReset();
    apiSsoListPublicProviders.mockReset();
    window.matchMedia = originalMatchMedia;
    colorSchemeListeners.clear();
    prefersDarkScheme = false;
  });

  // Drives the credentials form to submit so /auth/login is invoked. The supplied
  // login mock implementation decides which second-factor branch the UI enters.
  const submitCredentials = () => {
    fireEvent.change(screen.getByPlaceholderText('auth:login.username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByPlaceholderText('auth:login.password'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /auth:login.signIn/ }));
  };

  // input-otp renders a single hidden <input> (it forwards aria-label from the
  // InputOTP props). Writing the full 6-char value drives the controlled value
  // and fires the component's onComplete, which auto-submits the challenge.
  const typeOtp = (value: string) => {
    const otpInput = screen.getByLabelText('auth:totpChallenge.codeLabel');
    fireEvent.change(otpInput, { target: { value } });
  };

  // input-otp schedules deferred setTimeout(0/10/50) callbacks on mount that
  // dispatch a synthetic `input` event (caret/password-manager detection). Flush
  // them inside act() so those late state updates don't surface as act() warnings
  // after the test completes.
  const settleOtpTimers = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

  test('totpRequired response advances to the OTP challenge step', async () => {
    apiAuthLogin.mockImplementation(() =>
      Promise.resolve({ totpRequired: true, challengeToken: 'ct' }),
    );
    render(<Login onLogin={() => {}} />);

    submitCredentials();

    expect(await screen.findByText('auth:totpChallenge.title')).toBeInTheDocument();
    expect(screen.getByText('auth:totpChallenge.description')).toBeInTheDocument();
    // The credentials form is gone — we're on the challenge step now.
    expect(screen.queryByPlaceholderText('auth:login.password')).not.toBeInTheDocument();
    await settleOtpTimers();
  });

  test('entering a 6-digit code calls totpChallenge with the token and logs in', async () => {
    const onLogin = mock((_u: unknown, _t?: string) => {});
    apiAuthLogin.mockImplementation(() =>
      Promise.resolve({ totpRequired: true, challengeToken: 'ct' }),
    );
    render(<Login onLogin={onLogin} />);

    submitCredentials();
    await screen.findByText('auth:totpChallenge.title');

    typeOtp('123456');

    await waitFor(() => expect(apiAuthTotpChallenge).toHaveBeenCalledWith('ct', '123456'));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith({ id: 'u1', name: 'Test' }, 'tok'));
    await settleOtpTimers();
  });

  test('invalid_totp_code shows an inline error and does not log in', async () => {
    const onLogin = mock((_u: unknown, _t?: string) => {});
    apiAuthLogin.mockImplementation(() =>
      Promise.resolve({ totpRequired: true, challengeToken: 'ct' }),
    );
    apiAuthTotpChallenge.mockImplementation(() =>
      Promise.reject(new ApiErrorStub('Invalid code', 401, false, 'invalid_totp_code')),
    );
    render(<Login onLogin={onLogin} />);

    submitCredentials();
    await screen.findByText('auth:totpChallenge.title');

    typeOtp('000000');

    expect(await screen.findByText('auth:totpChallenge.invalidCode')).toBeInTheDocument();
    expect(apiAuthTotpChallenge).toHaveBeenCalledWith('ct', '000000');
    expect(onLogin).not.toHaveBeenCalled();
    // Still on the challenge step (not bounced back to credentials).
    expect(screen.getByText('auth:totpChallenge.title')).toBeInTheDocument();
    await settleOtpTimers();
  });

  test('totp_challenge_expired bounces back to credentials with a banner', async () => {
    const onLogin = mock((_u: unknown, _t?: string) => {});
    apiAuthLogin.mockImplementation(() =>
      Promise.resolve({ totpRequired: true, challengeToken: 'ct' }),
    );
    apiAuthTotpChallenge.mockImplementation(() =>
      Promise.reject(new ApiErrorStub('Expired', 401, false, 'totp_challenge_expired')),
    );
    render(<Login onLogin={onLogin} />);

    submitCredentials();
    await screen.findByText('auth:totpChallenge.title');

    typeOtp('123456');

    // The credentials form returns, carrying the expiry banner.
    expect(await screen.findByText('auth:totpChallenge.expired')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('auth:login.password')).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
    await settleOtpTimers();
  });

  test('"use a backup code" toggle swaps the OTP input for a free-text field', async () => {
    apiAuthLogin.mockImplementation(() =>
      Promise.resolve({ totpRequired: true, challengeToken: 'ct' }),
    );
    render(<Login onLogin={() => {}} />);

    submitCredentials();
    await screen.findByText('auth:totpChallenge.title');

    // Authenticator mode: the 6-digit OTP field is present.
    expect(screen.getByLabelText('auth:totpChallenge.codeLabel')).toBeInTheDocument();

    // The link label reads "use a backup code" while in authenticator mode.
    fireEvent.click(screen.getByRole('button', { name: 'auth:totpChallenge.useBackupCode' }));

    // Backup mode: a labelled free-text field replaces the OTP slots, and the
    // toggle now offers switching back to the authenticator.
    expect(screen.getByLabelText('auth:totpChallenge.useBackupCode')).toBeInTheDocument();
    expect(screen.queryByLabelText('auth:totpChallenge.codeLabel')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'auth:totpChallenge.useAuthenticator' }),
    ).toBeInTheDocument();
    await settleOtpTimers();
  });

  test('a backup code is submitted through totpChallenge', async () => {
    const onLogin = mock((_u: unknown, _t?: string) => {});
    apiAuthLogin.mockImplementation(() =>
      Promise.resolve({ totpRequired: true, challengeToken: 'ct' }),
    );
    render(<Login onLogin={onLogin} />);

    submitCredentials();
    await screen.findByText('auth:totpChallenge.title');

    fireEvent.click(screen.getByRole('button', { name: 'auth:totpChallenge.useBackupCode' }));
    fireEvent.change(screen.getByLabelText('auth:totpChallenge.useBackupCode'), {
      target: { value: 'backup-code-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /auth:totpChallenge.verify/ }));

    await waitFor(() => expect(apiAuthTotpChallenge).toHaveBeenCalledWith('ct', 'backup-code-1'));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith({ id: 'u1', name: 'Test' }, 'tok'));
    await settleOtpTimers();
  });

  test('totpEnrollmentRequired renders the setup wizard and runs setup with the enroll token', async () => {
    apiAuthLogin.mockImplementation(() =>
      Promise.resolve({ totpEnrollmentRequired: true, enrollToken: 'et' }),
    );
    render(<Login onLogin={() => {}} />);

    submitCredentials();

    // Login's enroll heading plus the wizard's scan step (settings namespace keys).
    expect(await screen.findByText('auth:totpEnroll.title')).toBeInTheDocument();
    expect(screen.getByText('auth:totpEnroll.description')).toBeInTheDocument();
    expect(await screen.findByText('twoFactor.setupTitle')).toBeInTheDocument();

    // The wizard's onSetup is wired to api.auth.totpSetup(enrollToken).
    await waitFor(() => expect(apiAuthTotpSetup).toHaveBeenCalledWith('et'));
    // No challenge call on the enrollment branch.
    expect(apiAuthTotpChallenge).not.toHaveBeenCalled();
  });
});
