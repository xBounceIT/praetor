import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiErrorStub } from '../helpers/apiErrorStub';
import { installI18nMock } from '../helpers/i18n';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';

installI18nMock();

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
    // TEMP DIAG (remove): capture CI window/location state that makes new URL() throw.
    const wd = window as unknown as {
      happyDOM?: { setURL?: unknown };
      location: { href: unknown };
    };
    let urlOk = 'n/a';
    try {
      new URL(String(window.location.href));
      urlOk = 'ok';
    } catch (e) {
      urlOk = `throws:${(e as Error).message}`;
    }
    console.error(
      `[diag-login] href=${JSON.stringify(window.location.href)} typeofHref=${typeof wd.location.href} happyDOM=${typeof wd.happyDOM} setURL=${typeof wd.happyDOM?.setURL} sameWin=${(globalThis as { window?: unknown }).window === window} newURL=${urlOk}`,
    );
  });

  afterEach(() => {
    apiAuthLogin.mockReset();
    apiAuthConsumeSsoTicket.mockReset();
    apiAuthGetSsoStartUrl.mockReset();
    apiSsoListPublicProviders.mockReset();
  });

  test('renders title and both input fields', () => {
    render(<Login onLogin={() => {}} />);
    expect(screen.getByText('auth:login.title')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('auth:login.username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('auth:login.password')).toBeInTheDocument();
  });

  test('submitting empty fields shows usernameRequired and passwordRequired errors', () => {
    render(<Login onLogin={() => {}} />);
    const submit = screen.getByRole('button', { name: /auth:login.signIn/ });
    fireEvent.click(submit);
    expect(screen.getByText('common:validation.usernameRequired')).toBeInTheDocument();
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

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiAuthLogin).toHaveBeenCalledWith('admin', 'password');
    expect(onLogin).toHaveBeenCalledWith({ id: 'u1', name: 'Test' }, 'tok');
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

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText('Bad credentials')).toBeInTheDocument();
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

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText('auth:login.errors.ldapUnavailable')).toBeInTheDocument();
  });

  test('password toggle flips input type between password and text', () => {
    render(<Login onLogin={() => {}} />);
    const passwordInput = screen.getByPlaceholderText('auth:login.password') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    // The toggle button is the only button without text - sibling of the password input.
    const toggleButtons = screen.getAllByRole('button');
    const toggle = toggleButtons.find((btn) => btn.querySelector('i.fa-eye, i.fa-eye-slash'));
    if (!toggle) throw new Error('toggle button not found');

    fireEvent.click(toggle);
    expect(passwordInput.type).toBe('text');

    fireEvent.click(toggle);
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

    expect(screen.getByText('auth:login.signingIn')).toBeInTheDocument();

    if (resolveLogin) resolveLogin({ user: { id: 'u', name: 'u' }, token: 't' });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  test('typing clears the field error', () => {
    render(<Login onLogin={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /auth:login.signIn/ }));
    expect(screen.getByText('common:validation.usernameRequired')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('auth:login.username'), {
      target: { value: 'admin' },
    });
    expect(screen.queryByText('common:validation.usernameRequired')).not.toBeInTheDocument();
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
});
