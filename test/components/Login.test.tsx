import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';

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
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

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
  });

  afterEach(() => {
    apiAuthLogin.mockReset();
    apiAuthConsumeSsoTicket.mockReset();
    apiAuthGetSsoStartUrl.mockReset();
    apiSsoListPublicProviders.mockReset();
  });

  test('renders title and both input fields', () => {
    render(<Login users={[]} onLogin={() => {}} />);
    expect(screen.getByText('auth:login.title')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('auth:login.username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('auth:login.password')).toBeInTheDocument();
  });

  test('submitting empty fields shows usernameRequired and passwordRequired errors', () => {
    render(<Login users={[]} onLogin={() => {}} />);
    const submit = screen.getByRole('button', { name: /auth:login.signIn/ });
    fireEvent.click(submit);
    expect(screen.getByText('common:validation.usernameRequired')).toBeInTheDocument();
    expect(screen.getByText('common:validation.passwordRequired')).toBeInTheDocument();
    expect(apiAuthLogin).not.toHaveBeenCalled();
  });

  test('successful login calls onLogin with user and token', async () => {
    const onLogin = mock((_u: unknown, _t?: string) => {});
    render(<Login users={[]} onLogin={onLogin} />);

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

    render(<Login users={[]} onLogin={() => {}} />);
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

  test('password toggle flips input type between password and text', () => {
    render(<Login users={[]} onLogin={() => {}} />);
    const passwordInput = screen.getByPlaceholderText('auth:login.password') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    // The toggle button is the only button without text — sibling of the password input.
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
    render(
      <Login
        users={[]}
        onLogin={() => {}}
        logoutReason="inactivity"
        onClearLogoutReason={onClear}
      />,
    );
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
    render(<Login users={[]} onLogin={() => {}} />);
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

    render(<Login users={[]} onLogin={() => {}} />);
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
    render(<Login users={[]} onLogin={() => {}} />);
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

    render(<Login users={[]} onLogin={() => {}} />);
    const button = await screen.findByRole('button', { name: /Keycloak/ });

    fireEvent.click(button);

    expect(apiAuthGetSsoStartUrl).toHaveBeenCalledWith('oidc', 'keycloak');
  });

  test('starts sso_ticket consumption and removes the query param', async () => {
    setTestUrl('http://localhost/?sso_ticket=ticket-1');
    apiAuthConsumeSsoTicket.mockImplementation(() => new Promise(() => {}));

    render(<Login users={[]} onLogin={() => {}} />);

    await waitFor(() => {
      expect(apiAuthConsumeSsoTicket).toHaveBeenCalledWith('ticket-1');
    });
    expect(window.location.search).not.toContain('sso_ticket');
  });
});
