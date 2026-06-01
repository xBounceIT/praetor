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

const apiAuthLogin = mock((_u: string, _p: string) =>
  Promise.resolve({ user: { id: 'u1', name: 'Test' }, token: 'tok' }),
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
    apiAuthConsumeSsoTicket.mockReset();
    apiAuthGetSsoStartUrl.mockReset();
    apiSsoListPublicProviders.mockReset();
    apiAuthLogin.mockImplementation((_u: string, _p: string) =>
      Promise.resolve({ user: { id: 'u1', name: 'Test' }, token: 'tok' }),
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
  });
});
