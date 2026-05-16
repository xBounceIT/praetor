import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import {
  type LdapConfig,
  MASKED_SECRET,
  type Role,
  type SsoProtocol,
  type SsoProvider,
} from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

const ldapApiMock = {
  testAuthentication: mock(async (_username: string, _password: string) => ({
    success: true,
    authenticated: true,
    username: 'alice',
    message: 'LDAP authentication succeeded',
    groups: [],
    roleIds: ['user'],
  })),
};

const ssoApiMock = {
  // Issue #602: the admin form must render the URL the backend will validate against, not
  // one built from the frontend's API base. Default the mock to a split-host setup so any
  // test that surfaces the ACS URL exercises the divergent-origin path.
  getSamlAcsUrlInfo: mock(async () => ({
    acsUrlTemplate: 'https://api.example.com/api/auth/sso/saml/{slug}/callback',
  })),
};

mock.module('../../../services/api/ldap', () => ({
  ldapApi: ldapApiMock,
}));

mock.module('../../../services/api/sso', () => ({
  ssoApi: ssoApiMock,
}));

clearSpyStateAfterAll();

const AuthSettings = (await import('../../../components/administration/AuthSettings')).default;

const ldapConfig: LdapConfig = {
  enabled: false,
  serverUrl: 'ldap://ldap.example.com:389',
  baseDn: 'dc=example,dc=com',
  bindDn: 'cn=admin,dc=example,dc=com',
  bindPassword: 'secret',
  userFilter: '(uid={0})',
  groupBaseDn: 'ou=groups,dc=example,dc=com',
  groupFilter: '(member={0})',
  roleMappings: [],
  tlsCaCertificate: '',
  autoProvisionAll: false,
};

const roles: Role[] = [
  {
    id: 'user',
    name: 'User',
    permissions: [],
    isAdmin: false,
    isSystem: true,
  },
];

const buildProvider = (protocol: SsoProtocol, patch: Partial<SsoProvider> = {}): SsoProvider => ({
  id: `${protocol}-provider`,
  protocol,
  enabled: false,
  slug: `${protocol}-provider`,
  name: `${protocol.toUpperCase()} Provider`,
  issuerUrl: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid profile email',
  metadataUrl: '',
  metadataXml: '',
  entryPoint: '',
  idpIssuer: '',
  idpCert: '',
  spIssuer: '',
  privateKey: '',
  publicCert: '',
  usernameAttribute: protocol === 'saml' ? 'nameID' : 'preferred_username',
  nameAttribute: 'name',
  emailAttribute: 'email',
  groupsAttribute: 'groups',
  roleMappings: [],
  ...patch,
});

const renderAuthSettings = (overrides: Partial<ComponentProps<typeof AuthSettings>> = {}) => {
  const defaultOnSaveSsoProvider = mock(async (provider: Partial<SsoProvider>) =>
    buildProvider(provider.protocol ?? 'oidc', provider),
  );
  const props: ComponentProps<typeof AuthSettings> = {
    config: ldapConfig,
    onSave: mock(async () => {}),
    roles,
    ssoProviders: [],
    onSaveSsoProvider: defaultOnSaveSsoProvider,
    onDeleteSsoProvider: mock(async () => {}),
    ...overrides,
  };

  render(<AuthSettings {...props} />);
  return props;
};

const inputForLabel = (label: string): HTMLInputElement => {
  const input = screen.getByText(label).parentElement?.querySelector('input');
  if (!input) throw new Error(`Input not found for label ${label}`);
  return input;
};

const fillMinimalOidcProvider = () => {
  fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.oidc' }));

  const heading = screen.getByText('admin.sso.newProvider');
  const form = heading.closest('form') as HTMLFormElement | null;
  if (!form) throw new Error('OIDC provider form not found');

  const getInputByLabel = (labelText: string) => {
    const label = [...form.querySelectorAll('label')].find(
      (element) => element.textContent === labelText,
    );
    const input = label?.parentElement?.querySelector('input');
    if (!input) throw new Error(`Input for "${labelText}" not found`);
    return input;
  };

  fireEvent.change(getInputByLabel('admin.sso.name'), { target: { value: 'Broken OIDC' } });
  fireEvent.change(getInputByLabel('admin.sso.slug'), { target: { value: 'broken-oidc' } });

  return form;
};

describe('<AuthSettings />', () => {
  beforeEach(() => {
    ldapApiMock.testAuthentication.mockClear();
  });

  test('allows testing the saved LDAP configuration before LDAP is enabled', async () => {
    renderAuthSettings();

    const testButton = screen.getByRole('button', { name: 'admin.ldap.testAuthentication' });
    expect(testButton).toBeEnabled();

    fireEvent.change(inputForLabel('admin.ldap.testUsername'), { target: { value: ' alice ' } });
    fireEvent.change(inputForLabel('admin.ldap.testPassword'), { target: { value: 'secret' } });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(ldapApiMock.testAuthentication).toHaveBeenCalledWith('alice', 'secret');
    });
  });

  test('shows the server error instead of the saved notification when LDAP save fails', async () => {
    const onSave = mock(async () => {
      throw new Error('Role mapping references a missing role');
    });

    renderAuthSettings({ onSave });

    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.saveConfiguration' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('alert')).toHaveTextContent('Role mapping references a missing role');
    });
    expect(screen.queryByText('admin.ldap.changesSaved')).not.toBeInTheDocument();
  });

  test('renders the SAML ACS URL using the backend-authoritative template (issue #602)', async () => {
    ssoApiMock.getSamlAcsUrlInfo.mockClear();
    renderAuthSettings();

    // Open SAML tab and type a slug into the new-provider form.
    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    const form = screen.getByText('admin.sso.newProvider').closest('form') as HTMLFormElement;
    const slugLabel = [...form.querySelectorAll('label')].find(
      (el) => el.textContent === 'admin.sso.slug',
    );
    const slugInput = slugLabel?.parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: 'okta' } });

    // The endpoint resolves asynchronously on mount, so wait for the URL to appear.
    const acsField = await waitFor(() => {
      const label = [...form.querySelectorAll('label')].find(
        (el) => el.textContent === 'admin.sso.acsUrl',
      );
      const input = label?.parentElement?.querySelector('input') as HTMLInputElement | null;
      if (!input?.readOnly) throw new Error('ACS URL field not yet rendered');
      return input;
    });

    expect(ssoApiMock.getSamlAcsUrlInfo).toHaveBeenCalledTimes(1);
    // Backend origin (api.example.com) wins over any frontend-derived value.
    expect(acsField.value).toBe('https://api.example.com/api/auth/sso/saml/okta/callback');
  });

  test('retries the ACS URL fetch if the user left SAML before the first request settled (#649 review)', async () => {
    ssoApiMock.getSamlAcsUrlInfo.mockClear();
    // First attempt never settles, simulating a slow network the user gives up on. The bug
    // guarded by this test: a ref-based lock set before settle would prevent the second
    // visit from refetching, stranding the preview in 'loading' forever.
    ssoApiMock.getSamlAcsUrlInfo.mockImplementationOnce(() => new Promise(() => {}));

    renderAuthSettings();

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    await waitFor(() => expect(ssoApiMock.getSamlAcsUrlInfo).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.ldap' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));

    await waitFor(() => expect(ssoApiMock.getSamlAcsUrlInfo).toHaveBeenCalledTimes(2));

    // And the retry produces a usable URL.
    const form = screen.getByText('admin.sso.newProvider').closest('form') as HTMLFormElement;
    const slugLabel = [...form.querySelectorAll('label')].find(
      (el) => el.textContent === 'admin.sso.slug',
    );
    const slugInput = slugLabel?.parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: 'okta' } });

    const acsField = await waitFor(() => {
      const label = [...form.querySelectorAll('label')].find(
        (el) => el.textContent === 'admin.sso.acsUrl',
      );
      const input = label?.parentElement?.querySelector('input') as HTMLInputElement | null;
      if (!input?.readOnly) throw new Error('ACS URL field not yet rendered');
      return input;
    });
    expect(acsField.value).toBe('https://api.example.com/api/auth/sso/saml/okta/callback');
  });

  test('retries the ACS URL fetch on SAML re-entry after a transient error (#649 review)', async () => {
    ssoApiMock.getSamlAcsUrlInfo.mockClear();
    // First attempt fails (transient 503), second attempt succeeds. Without retry-on-reentry,
    // a one-off failure would permanently disable the preview until a full page reload.
    ssoApiMock.getSamlAcsUrlInfo.mockImplementationOnce(async () => {
      throw new Error('temporary network failure');
    });

    renderAuthSettings();

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    await waitFor(() => expect(ssoApiMock.getSamlAcsUrlInfo).toHaveBeenCalledTimes(1));

    // Wait for the error UI so we know the first attempt resolved into the 'error' state.
    const form = screen.getByText('admin.sso.newProvider').closest('form') as HTMLFormElement;
    const slugLabel = [...form.querySelectorAll('label')].find(
      (el) => el.textContent === 'admin.sso.slug',
    );
    const slugInput = slugLabel?.parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: 'okta' } });
    await waitFor(() => {
      if (!within(form).queryByText(/temporary network failure/)) {
        throw new Error('Error not yet rendered');
      }
    });

    // Leave SAML and return — the retry should fire.
    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.ldap' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));

    await waitFor(() => expect(ssoApiMock.getSamlAcsUrlInfo).toHaveBeenCalledTimes(2));

    const acsField = await waitFor(() => {
      const refreshedForm = screen.getByText('admin.sso.newProvider').closest('form');
      const label = [...(refreshedForm?.querySelectorAll('label') ?? [])].find(
        (el) => el.textContent === 'admin.sso.acsUrl',
      );
      const input = label?.parentElement?.querySelector('input') as HTMLInputElement | null;
      if (!input?.readOnly) throw new Error('ACS URL field not yet rendered');
      return input;
    });
    expect(acsField.value).toBe('https://api.example.com/api/auth/sso/saml/okta/callback');
  });

  test('shows an error message when the backend cannot resolve the ACS URL (issue #602)', async () => {
    ssoApiMock.getSamlAcsUrlInfo.mockClear();
    ssoApiMock.getSamlAcsUrlInfo.mockImplementationOnce(async () => {
      throw new Error('SSO_CALLBACK_BASE_URL or FRONTEND_URL must be configured for SSO');
    });

    renderAuthSettings();

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    const form = screen.getByText('admin.sso.newProvider').closest('form') as HTMLFormElement;
    const slugLabel = [...form.querySelectorAll('label')].find(
      (el) => el.textContent === 'admin.sso.slug',
    );
    const slugInput = slugLabel?.parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: 'okta' } });

    const message = await waitFor(() => {
      const node = within(form).queryByText(/SSO_CALLBACK_BASE_URL or FRONTEND_URL/);
      if (!node) throw new Error('Configuration hint not rendered');
      return node;
    });
    expect(message).toBeInTheDocument();

    // The misleading editable ACS URL field must NOT appear when the backend can't resolve it.
    const acsLabel = [...form.querySelectorAll('label')].find(
      (el) => el.textContent === 'admin.sso.acsUrl',
    );
    expect(acsLabel?.parentElement?.querySelector('input')).toBeNull();
  });

  test('surfaces SSO provider save failures inline and restores the save button', async () => {
    const onSaveSsoProvider = mock(async () => {
      throw new Error('OIDC save failed');
    });
    renderAuthSettings({ onSaveSsoProvider });

    const form = fillMinimalOidcProvider();
    fireEvent.submit(form);

    await waitFor(() => expect(onSaveSsoProvider).toHaveBeenCalledTimes(1));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('admin.sso.errors.saveFailedTitle');
    expect(alert).toHaveTextContent('OIDC save failed');
    expect(screen.queryByText('admin.ldap.changesSaved')).not.toBeInTheDocument();

    expect(within(form).getByRole('button', { name: 'admin.sso.saveProvider' })).toBeEnabled();
  });

  test('blocks save and surfaces idpIssuer error for enabled manual SAML missing the issuer', async () => {
    // Issue #597: node-saml silently skips <Issuer> validation when idpIssuer is empty.
    // The form must refuse to send a save request for an enabled manual SAML config that
    // has not specified an IdP issuer.
    const onSaveSsoProvider = mock(async (provider: Partial<SsoProvider>) =>
      buildProvider(provider.protocol ?? 'saml', provider),
    );
    renderAuthSettings({
      onSaveSsoProvider,
      ssoProviders: [
        buildProvider('saml', {
          enabled: true,
          entryPoint: 'https://idp.example.com/sso',
          idpCert: 'MIIBdummyCert',
          // idpIssuer left empty — the violation under test.
        }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    // The form initially renders an empty "new provider" draft. Click the pen icon on the
    // listed SAML provider to load its values into the form.
    fireEvent.click(screen.getByRole('button', { name: 'admin.sso.editProvider' }));
    const heading = screen.getByText('admin.sso.editProvider', { selector: 'h3' });
    const form = heading.closest('form') as HTMLFormElement | null;
    if (!form) throw new Error('SAML provider form not found');

    fireEvent.submit(form);

    await waitFor(() => {
      expect(within(form).getByText('admin.sso.errors.idpIssuerRequired')).toBeInTheDocument();
    });
    expect(onSaveSsoProvider).not.toHaveBeenCalled();
  });

  test('locks stored masked secrets behind a Replace control on edit (issue #601)', async () => {
    // The backend returns MASKED_SECRET for clientSecret/privateKey/metadataXml/idpCert
    // when reading a provider with stored values. Previously the form populated the textarea
    // directly with `'********'`; a single accidental keystroke then overwrote the stored
    // secret with garbage like `'********x'`. The form must instead render a locked preview
    // until the admin explicitly opts into Replace mode.
    const onSaveSsoProvider = mock(async (provider: Partial<SsoProvider>) =>
      buildProvider(provider.protocol ?? 'saml', provider),
    );
    renderAuthSettings({
      onSaveSsoProvider,
      ssoProviders: [
        buildProvider('saml', {
          enabled: true,
          idpIssuer: 'https://idp.example.com/issuer',
          entryPoint: 'https://idp.example.com/sso',
          idpCert: MASKED_SECRET,
          metadataXml: MASKED_SECRET,
          privateKey: MASKED_SECRET,
        }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.sso.editProvider' }));
    const heading = screen.getByText('admin.sso.editProvider', { selector: 'h3' });
    const form = heading.closest('form') as HTMLFormElement | null;
    if (!form) throw new Error('SAML provider form not found');

    // The three masked SAML fields must not render their textarea — the locked preview
    // replaces them so accidental keystrokes can't reach the stored value.
    for (const labelText of [
      'admin.sso.idpCert',
      'admin.sso.metadataXml',
      'admin.sso.privateKey',
    ]) {
      const label = [...form.querySelectorAll('label')].find((el) => el.textContent === labelText);
      expect(label?.parentElement?.querySelector('textarea')).toBeNull();
    }
    // Three "Replace" buttons should be present (one per masked field).
    expect(within(form).getAllByRole('button', { name: 'admin.sso.replaceSecret' })).toHaveLength(
      3,
    );

    // Saving without touching anything must round-trip the mask so the server preserves the
    // stored values — never strip them, never send a partial edit.
    fireEvent.submit(form);
    await waitFor(() => expect(onSaveSsoProvider).toHaveBeenCalledTimes(1));
    const sentPayload = onSaveSsoProvider.mock.calls[0]?.[0] as Partial<SsoProvider>;
    expect(sentPayload.idpCert).toBe(MASKED_SECRET);
    expect(sentPayload.metadataXml).toBe(MASKED_SECRET);
    expect(sentPayload.privateKey).toBe(MASKED_SECRET);
  });

  test('Replace control swaps in an editable empty input and sends the new secret (issue #601)', async () => {
    const onSaveSsoProvider = mock(async (provider: Partial<SsoProvider>) =>
      buildProvider(provider.protocol ?? 'saml', provider),
    );
    renderAuthSettings({
      onSaveSsoProvider,
      ssoProviders: [
        buildProvider('saml', {
          enabled: true,
          idpIssuer: 'https://idp.example.com/issuer',
          entryPoint: 'https://idp.example.com/sso',
          idpCert: MASKED_SECRET,
        }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.sso.editProvider' }));
    const heading = screen.getByText('admin.sso.editProvider', { selector: 'h3' });
    const form = heading.closest('form') as HTMLFormElement | null;
    if (!form) throw new Error('SAML provider form not found');

    // Only idpCert is stored — exactly one Replace button.
    const replaceButtons = within(form).getAllByRole('button', { name: 'admin.sso.replaceSecret' });
    expect(replaceButtons).toHaveLength(1);
    fireEvent.click(replaceButtons[0]);

    // After Replace, the TextArea renders with a trailing "Keep stored value" button, which
    // wraps the label one level deeper. Walk up until we find the wrapper that owns the
    // textarea so the selector works in either layout.
    const idpCertLabel = [...form.querySelectorAll('label')].find(
      (el) => el.textContent === 'admin.sso.idpCert',
    );
    let wrapper: HTMLElement | null | undefined = idpCertLabel?.parentElement;
    while (wrapper && !wrapper.querySelector('textarea')) wrapper = wrapper.parentElement;
    const textarea = wrapper?.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('idpCert textarea did not appear after Replace');
    // The input starts empty — no '********' for stray keystrokes to corrupt.
    expect(textarea.value).toBe('');

    fireEvent.change(textarea, { target: { value: 'MIIBnewCertValue' } });
    fireEvent.submit(form);

    await waitFor(() => expect(onSaveSsoProvider).toHaveBeenCalledTimes(1));
    const sentPayload = onSaveSsoProvider.mock.calls[0]?.[0] as Partial<SsoProvider>;
    expect(sentPayload.idpCert).toBe('MIIBnewCertValue');
  });

  test('Replace mode left empty falls back to the mask so the server preserves the stored secret (issue #601)', async () => {
    // Clicking Replace and then saving without typing anything would otherwise send `''`,
    // which the backend interprets as "clear the stored value". Substitute the mask back so
    // the server's "preserve" branch wins for an accidental Replace click.
    const onSaveSsoProvider = mock(async (provider: Partial<SsoProvider>) =>
      buildProvider(provider.protocol ?? 'saml', provider),
    );
    renderAuthSettings({
      onSaveSsoProvider,
      ssoProviders: [
        buildProvider('saml', {
          enabled: true,
          idpIssuer: 'https://idp.example.com/issuer',
          entryPoint: 'https://idp.example.com/sso',
          idpCert: MASKED_SECRET,
        }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.saml' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.sso.editProvider' }));
    const heading = screen.getByText('admin.sso.editProvider', { selector: 'h3' });
    const form = heading.closest('form') as HTMLFormElement | null;
    if (!form) throw new Error('SAML provider form not found');

    fireEvent.click(within(form).getByRole('button', { name: 'admin.sso.replaceSecret' }));
    fireEvent.submit(form);

    await waitFor(() => expect(onSaveSsoProvider).toHaveBeenCalledTimes(1));
    const sentPayload = onSaveSsoProvider.mock.calls[0]?.[0] as Partial<SsoProvider>;
    expect(sentPayload.idpCert).toBe(MASKED_SECRET);
  });

  test('locks the OIDC clientSecret behind a Replace control on edit (issue #601)', async () => {
    // OIDC uses `<Field type="password">` rather than `<TextArea>`, so it exercises a
    // different render path than the SAML cert/key fields covered above. Same bug class.
    const onSaveSsoProvider = mock(async (provider: Partial<SsoProvider>) =>
      buildProvider(provider.protocol ?? 'oidc', provider),
    );
    renderAuthSettings({
      onSaveSsoProvider,
      ssoProviders: [
        buildProvider('oidc', {
          enabled: true,
          issuerUrl: 'https://idp.example.com',
          clientId: 'praetor',
          clientSecret: MASKED_SECRET,
        }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.tabs.oidc' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.sso.editProvider' }));
    const heading = screen.getByText('admin.sso.editProvider', { selector: 'h3' });
    const form = heading.closest('form') as HTMLFormElement | null;
    if (!form) throw new Error('OIDC provider form not found');

    // The stored clientSecret must not render a password input — the locked preview replaces it.
    const csLabel = [...form.querySelectorAll('label')].find(
      (el) => el.textContent === 'admin.sso.clientSecret',
    );
    expect(csLabel?.parentElement?.querySelector('input[type="password"]')).toBeNull();

    // Saving without touching anything must round-trip the mask.
    fireEvent.submit(form);
    await waitFor(() => expect(onSaveSsoProvider).toHaveBeenCalledTimes(1));
    const sentPayload = onSaveSsoProvider.mock.calls[0]?.[0] as Partial<SsoProvider>;
    expect(sentPayload.clientSecret).toBe(MASKED_SECRET);
  });

  test('locks the LDAP bindPassword behind a Replace control on edit (issue #601)', async () => {
    // LDAP's bindPassword uses the same `MASKED_SECRET` sentinel as the SSO fields and the
    // same accidental-keystroke corruption applies to it. The fix mirrors the SSO flow.
    const onSave = mock(async (_config: LdapConfig) => {});
    renderAuthSettings({
      onSave,
      config: { ...ldapConfig, bindPassword: MASKED_SECRET },
    });

    // LDAP is the default tab; submit without touching anything.
    const bindLabel = [...document.querySelectorAll('label')].find(
      (el) => el.textContent === 'admin.ldap.bindPasswordLabel',
    );
    if (!bindLabel) throw new Error('bindPassword label not found');
    // The masked input must NOT be rendered when bindPassword is stored — the locked preview
    // replaces it so a stray keystroke can't corrupt the stored credential.
    expect(bindLabel.parentElement?.querySelector('input[type="password"]')).toBeNull();
    // The Replace control must be present.
    expect(
      within(bindLabel.parentElement as HTMLElement).getByRole('button', {
        name: 'admin.sso.replaceSecret',
      }),
    ).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: 'admin.ldap.saveConfiguration' });
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const sent = onSave.mock.calls[0]?.[0] as LdapConfig;
    expect(sent.bindPassword).toBe(MASKED_SECRET);
  });

  test('LDAP bindPassword Replace mode left empty falls back to the mask (issue #601)', async () => {
    // An accidental Replace click followed by Save with no typed value must not clear the
    // stored bindPassword. The substituted payload sends the mask so the server preserves.
    const onSave = mock(async (_config: LdapConfig) => {});
    renderAuthSettings({
      onSave,
      config: { ...ldapConfig, bindPassword: MASKED_SECRET },
    });

    const bindLabel = [...document.querySelectorAll('label')].find(
      (el) => el.textContent === 'admin.ldap.bindPasswordLabel',
    );
    if (!bindLabel) throw new Error('bindPassword label not found');
    fireEvent.click(
      within(bindLabel.parentElement as HTMLElement).getByRole('button', {
        name: 'admin.sso.replaceSecret',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'admin.ldap.saveConfiguration' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const sent = onSave.mock.calls[0]?.[0] as LdapConfig;
    expect(sent.bindPassword).toBe(MASKED_SECRET);
  });
});
