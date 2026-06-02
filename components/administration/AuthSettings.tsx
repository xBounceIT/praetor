import {
  ArrowRight,
  Check,
  CircleAlert,
  FileUp,
  FlaskConical,
  FolderTree,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Save,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { siOpenid } from 'simple-icons';
import { cn } from '@/lib/utils';
import { useSecretReplaceState } from '../../hooks/useSecretReplaceState';
import { ldapApi } from '../../services/api/ldap';
import { ssoApi } from '../../services/api/sso';
import type {
  LdapConfig,
  LdapRoleResolution,
  LdapTestResponse,
  Role,
  SsoProtocol,
  SsoProvider,
  SsoRoleMapping,
} from '../../types';
import { isStoredSecret, MASKED_SECRET } from '../../utils/maskedSecret';
import SecretField from '../shared/SecretField';
import SelectControl from '../shared/SelectControl';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Button } from '../ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../ui/card';
import { FieldDescription, FieldError, FieldLabel, Field as UIField } from '../ui/field';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';

const PEM_BEGIN_MARKER = '-----BEGIN CERTIFICATE-----';
const PEM_END_MARKER = '-----END CERTIFICATE-----';

type SsoSecretFieldKey = 'clientSecret' | 'privateKey' | 'metadataXml' | 'idpCert';

export interface AuthSettingsProps {
  config: LdapConfig;
  onSave: (config: LdapConfig) => void | Promise<void>;
  roles: Role[];
  ssoProviders: SsoProvider[];
  onSaveSsoProvider: (provider: Partial<SsoProvider>) => Promise<SsoProvider>;
  onDeleteSsoProvider: (id: string) => Promise<void>;
}

const DEFAULT_LDAP_CONFIG: LdapConfig = {
  enabled: false,
  serverUrl: 'ldap://ldap.example.com:389',
  baseDn: 'dc=example,dc=com',
  bindDn: 'cn=read-only-admin,dc=example,dc=com',
  bindPassword: '',
  userFilter: '(uid={0})',
  groupBaseDn: 'ou=groups,dc=example,dc=com',
  groupFilter: '(member={0})',
  roleMappings: [],
  tlsCaCertificate: '',
  autoProvisionAll: false,
  provisionOnLogin: true,
};

const buildDefaultProvider = (protocol: SsoProtocol): Partial<SsoProvider> => ({
  protocol,
  enabled: false,
  slug: '',
  name: '',
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
  endSessionEnabled: false,
});

const OpenIdIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg aria-hidden="true" className={className} role="img" viewBox="0 0 24 24" fill="currentColor">
    <path d={siOpenid.path} />
  </svg>
);

const ProviderIcon: React.FC<{ protocol: SsoProtocol; className?: string }> = ({
  protocol,
  className,
}) =>
  protocol === 'oidc' ? (
    <OpenIdIcon className={className} />
  ) : (
    <ShieldCheck aria-hidden="true" className={className} />
  );

const AuthTabButton: React.FC<{
  tab: 'ldap' | SsoProtocol;
  activeTab: 'ldap' | SsoProtocol;
  icon: React.ReactNode;
  label: string;
  onSelect: (tab: 'ldap' | SsoProtocol) => void;
}> = ({ tab, activeTab, icon, label, onSelect }) => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    onClick={() => onSelect(tab)}
    className={`relative pb-4 font-bold rounded-none bg-transparent hover:bg-transparent dark:hover:bg-transparent ${activeTab === tab ? 'text-primary hover:text-primary' : 'text-muted-foreground hover:text-foreground'}`}
  >
    {icon}
    {label}
    {activeTab === tab && (
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"></div>
    )}
  </Button>
);

// The backend builds the SAML callback URL from SSO_CALLBACK_BASE_URL/FRONTEND_URL, not from
// the frontend's API base. In split-host deployments those origins differ, so we ask the server
// for the templated URL and render that — otherwise admins copy a URL the SAML library will
// later reject. See issue #602.
const SLUG_PLACEHOLDER = '{slug}';
const fillSlugTemplate = (template: string, slug: string): string =>
  template.replace(SLUG_PLACEHOLDER, encodeURIComponent(slug));

// Per-state translation keys for the LDAP tester role panel (#638). Matched is the default
// "Mapped Roles" label; preserved/default/rejected each get their own label plus a help line
// clarifying what real login would do. `none` is unreachable here because the help row only
// renders when `authenticated === true`.
const LDAP_ROLE_RESOLUTION_LABEL_KEYS: Record<LdapRoleResolution, string> = {
  matched: 'admin.ldap.test.roleIds',
  preserved: 'admin.ldap.test.preservedRoleLabel',
  default: 'admin.ldap.test.defaultRoleLabel',
  rejected: 'admin.ldap.test.rejectedRoleLabel',
  none: 'admin.ldap.test.roleIds',
};
const LDAP_ROLE_RESOLUTION_HELP_KEYS: Partial<Record<LdapRoleResolution, string>> = {
  preserved: 'admin.ldap.test.preservedRoleHelp',
  default: 'admin.ldap.test.defaultRoleHelp',
  rejected: 'admin.ldap.test.rejectedRoleHelp',
};

const AuthSettings: React.FC<AuthSettingsProps> = ({
  config,
  onSave,
  roles,
  ssoProviders,
  onSaveSsoProvider,
  onDeleteSsoProvider,
}) => {
  const { t } = useTranslation('auth');
  const [activeTab, setActiveTab] = useState<'ldap' | SsoProtocol>('ldap');
  const [ldapForm, setLdapForm] = useState<LdapConfig>(DEFAULT_LDAP_CONFIG);
  const loadedLdapConfigRef = useRef<LdapConfig | null | undefined>(null);
  const hasLoadedLdapConfigRef = useRef(false);
  const bindPasswordReplace = useSecretReplaceState(
    ldapForm.bindPassword,
    (bindPassword) => setLdapForm((prev) => ({ ...prev, bindPassword })),
    config,
  );
  const [providerDrafts, setProviderDrafts] = useState<Record<SsoProtocol, Partial<SsoProvider>>>({
    oidc: buildDefaultProvider('oidc'),
    saml: buildDefaultProvider('saml'),
  });
  const [replacingSecrets, setReplacingSecrets] = useState<
    Record<SsoProtocol, Partial<Record<SsoSecretFieldKey, boolean>>>
  >({ oidc: {}, saml: {} });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testUsername, setTestUsername] = useState('');
  const [testPassword, setTestPassword] = useState('');
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<LdapTestResponse | null>(null);
  const [isTestingLdap, setIsTestingLdap] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isSavingLdap, setIsSavingLdap] = useState(false);
  const [savingProvider, setSavingProvider] = useState<SsoProtocol | null>(null);
  const [providerSaveErrors, setProviderSaveErrors] = useState<
    Partial<Record<SsoProtocol, string>>
  >({});
  type AcsUrlState =
    | { status: 'loading' }
    | { status: 'ready'; template: string }
    | { status: 'error'; message: string };
  const [acsUrlState, setAcsUrlState] = useState<AcsUrlState>({ status: 'loading' });
  const tlsCaFileInputRef = useRef<HTMLInputElement>(null);

  if (!hasLoadedLdapConfigRef.current || loadedLdapConfigRef.current !== config) {
    hasLoadedLdapConfigRef.current = true;
    loadedLdapConfigRef.current = config;
    setLdapForm(config || DEFAULT_LDAP_CONFIG);
  }

  const handleActiveTabSelect = (tab: 'ldap' | SsoProtocol) => {
    setActiveTab(tab);
    // Re-entering the SAML tab after a transient failure resets the state to 'loading' so the
    // fetch effect below retries. Without this, a one-off 503/network error would permanently
    // disable the preview until a full page reload.
    if (tab === 'saml') {
      setAcsUrlState((prev) => (prev.status === 'error' ? { status: 'loading' } : prev));
    }
  };

  // Status-gated rather than ref-gated: if the user leaves the SAML tab mid-flight, the
  // cleanup discards the result and the state stays 'loading', so re-entering the tab kicks
  // off a fresh fetch. A ref locked before the fetch settled would strand the preview in
  // 'loading' forever.
  useEffect(() => {
    if (activeTab !== 'saml' || acsUrlState.status !== 'loading') return;
    let cancelled = false;
    ssoApi
      .getSamlAcsUrlInfo()
      .then(({ acsUrlTemplate }) => {
        if (cancelled) return;
        setAcsUrlState({ status: 'ready', template: acsUrlTemplate });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAcsUrlState({
          status: 'error',
          message: err instanceof Error ? err.message : '',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, acsUrlState.status]);

  const handleTlsCaFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately so picking the same file twice still fires onChange.
    event.target.value = '';
    if (!file) return;
    if (file.size > 65536) {
      setErrors((prev) => ({
        ...prev,
        tlsCaCertificate: t('admin.ldap.errors.tlsCaFileTooLarge', 'File too large (max 64 KB)'),
      }));
      return;
    }
    try {
      const text = await file.text();
      setLdapForm((prev) => ({ ...prev, tlsCaCertificate: text }));
      setErrors((prev) => ({ ...prev, tlsCaCertificate: '' }));
    } catch {
      setErrors((prev) => ({
        ...prev,
        tlsCaCertificate: t(
          'admin.ldap.errors.tlsCaFileReadFailed',
          'Could not read the selected file',
        ),
      }));
    }
  };

  const roleOptions = useMemo(
    () =>
      roles.length
        ? roles.map((role) => ({ id: role.id, name: role.name }))
        : [
            { id: 'admin', name: t('roles.admin', 'Admin') },
            { id: 'top_manager', name: t('roles.top_manager', 'Top Manager') },
            { id: 'manager', name: t('roles.manager', 'Manager') },
            { id: 'user', name: t('roles.user', 'User') },
          ],
    [roles, t],
  );

  const providersByProtocol = useMemo(
    () => ({
      oidc: ssoProviders.filter((provider) => provider.protocol === 'oidc'),
      saml: ssoProviders.filter((provider) => provider.protocol === 'saml'),
    }),
    [ssoProviders],
  );

  const showSaved = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const isLdapDirty = JSON.stringify(ldapForm) !== JSON.stringify(config || DEFAULT_LDAP_CONFIG);

  const updateLdapMapping = (index: number, field: 'ldapGroup' | 'role', value: string) => {
    const roleMappings = [...ldapForm.roleMappings];
    roleMappings[index] = { ...roleMappings[index], [field]: value };
    setLdapForm((prev) => ({ ...prev, roleMappings }));
  };

  const validateLdap = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (ldapForm.enabled) {
      if (!ldapForm.serverUrl.trim())
        nextErrors.serverUrl = t('admin.ldap.errors.serverUrlRequired');
      if (!ldapForm.baseDn.trim()) nextErrors.baseDn = t('admin.ldap.errors.baseDnRequired');
      if (!ldapForm.userFilter.trim())
        nextErrors.userFilter = t('admin.ldap.errors.userFilterRequired');
      else if (!ldapForm.userFilter.includes('{0}')) {
        nextErrors.userFilter = t('admin.ldap.errors.userFilterPlaceholderRequired');
      }
      if (!ldapForm.groupBaseDn.trim()) {
        nextErrors.groupBaseDn = t('admin.ldap.errors.groupBaseDnRequired');
      }
      if (!ldapForm.groupFilter.trim())
        nextErrors.groupFilter = t('admin.ldap.errors.groupFilterRequired');
      if (
        (ldapForm.bindDn && !ldapForm.bindPassword) ||
        (!ldapForm.bindDn && ldapForm.bindPassword)
      ) {
        nextErrors.bindCredentials = t('admin.ldap.errors.bindCredentialsRequired');
      }
    }
    const trimmedCa = ldapForm.tlsCaCertificate.trim();
    if (
      trimmedCa !== '' &&
      (!trimmedCa.includes(PEM_BEGIN_MARKER) || !trimmedCa.includes(PEM_END_MARKER))
    ) {
      nextErrors.tlsCaCertificate = t(
        'admin.ldap.errors.tlsCaInvalidPem',
        'Certificate must be PEM-encoded with BEGIN/END CERTIFICATE markers',
      );
    }
    ldapForm.roleMappings.forEach((mapping, index) => {
      if (!mapping.ldapGroup.trim()) {
        nextErrors[`ldapRoleMapping_${index}`] = t('admin.ldap.errors.ldapGroupRequired');
      }
    });
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSaveLdap = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateLdap()) return;
    setIsSaved(false);
    setIsSavingLdap(true);
    try {
      await onSave(ldapForm);
      showSaved();
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        general:
          err instanceof Error && err.message
            ? err.message
            : t('admin.ldap.errors.saveFailed', 'Failed to save LDAP configuration'),
      }));
    } finally {
      setIsSavingLdap(false);
    }
  };

  const handleTestLdap = async (event: React.FormEvent) => {
    event.preventDefault();
    setTestErrors({});
    setTestResult(null);

    const nextErrors: Record<string, string> = {};
    const username = testUsername.trim();
    if (!username) {
      nextErrors.testUsername = t(
        'admin.ldap.errors.testUsernameRequired',
        'Test username is required',
      );
    }
    if (!testPassword.trim()) {
      nextErrors.testPassword = t(
        'admin.ldap.errors.testPasswordRequired',
        'Test password is required',
      );
    }
    if (Object.keys(nextErrors).length > 0) {
      setTestErrors(nextErrors);
      return;
    }

    setIsTestingLdap(true);
    try {
      const result = await ldapApi.testAuthentication(username, testPassword);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        authenticated: false,
        username,
        message:
          err instanceof Error
            ? err.message
            : t('admin.ldap.test.failureMessage', 'Authentication failed.'),
        groups: [],
        roleIds: [],
        roleResolution: 'none',
      });
    } finally {
      setIsTestingLdap(false);
    }
  };

  const clearProviderSaveError = (protocol: SsoProtocol) => {
    setProviderSaveErrors((current) => {
      if (!current[protocol]) return current;
      const next = { ...current };
      delete next[protocol];
      return next;
    });
  };

  const getProviderSaveErrorMessage = (err: unknown) =>
    err instanceof Error && err.message.trim()
      ? err.message
      : t('admin.sso.errors.saveFailed', 'Could not save provider');

  const updateProviderDraft = (protocol: SsoProtocol, patch: Partial<SsoProvider>) => {
    clearProviderSaveError(protocol);
    setProviderDrafts((current) => ({
      ...current,
      [protocol]: { ...current[protocol], ...patch, protocol },
    }));
  };

  // Loading or resetting a draft must also clear any per-field "replace stored secret" flags so
  // that masked fields render as a "Secret stored — Replace" badge again.
  const loadProviderDraft = (protocol: SsoProtocol, next: Partial<SsoProvider>) => {
    clearProviderSaveError(protocol);
    setProviderDrafts((current) => ({ ...current, [protocol]: { ...next, protocol } }));
    setReplacingSecrets((current) => ({ ...current, [protocol]: {} }));
  };

  const startReplaceSecret = (protocol: SsoProtocol, field: SsoSecretFieldKey) => {
    updateProviderDraft(protocol, { [field]: '' } as Partial<SsoProvider>);
    setReplacingSecrets((current) => ({
      ...current,
      [protocol]: { ...current[protocol], [field]: true },
    }));
  };

  const cancelReplaceSecret = (protocol: SsoProtocol, field: SsoSecretFieldKey) => {
    updateProviderDraft(protocol, { [field]: MASKED_SECRET } as Partial<SsoProvider>);
    setReplacingSecrets((current) => ({
      ...current,
      [protocol]: { ...current[protocol], [field]: false },
    }));
  };

  const updateProviderMapping = (
    protocol: SsoProtocol,
    index: number,
    field: keyof SsoRoleMapping,
    value: string,
  ) => {
    const currentMappings = providerDrafts[protocol].roleMappings || [];
    const roleMappings = [...currentMappings];
    roleMappings[index] = { ...roleMappings[index], [field]: value } as SsoRoleMapping;
    updateProviderDraft(protocol, { roleMappings });
  };

  const validateProvider = (provider: Partial<SsoProvider>): boolean => {
    const nextErrors: Record<string, string> = {};
    const prefix = `${provider.protocol}_`;
    if (!provider.name?.trim())
      nextErrors[`${prefix}name`] = t('admin.sso.errors.nameRequired', 'Name is required');
    if (!provider.slug?.trim())
      nextErrors[`${prefix}slug`] = t('admin.sso.errors.slugRequired', 'Slug is required');
    else if (!/^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/.test(provider.slug.trim())) {
      nextErrors[`${prefix}slug`] = t(
        'admin.sso.errors.slugInvalid',
        'Use lowercase letters, numbers, and hyphens',
      );
    }
    if (provider.enabled && provider.protocol === 'oidc') {
      if (!provider.issuerUrl?.trim())
        nextErrors[`${prefix}issuerUrl`] = t(
          'admin.sso.errors.issuerRequired',
          'Issuer URL is required',
        );
      if (!provider.clientId?.trim())
        nextErrors[`${prefix}clientId`] = t(
          'admin.sso.errors.clientIdRequired',
          'Client ID is required',
        );
      if (!provider.usernameAttribute?.trim())
        nextErrors[`${prefix}usernameAttribute`] = t(
          'admin.sso.errors.usernameAttributeRequired',
          'Username claim is required',
        );
    }
    if (provider.enabled && provider.protocol === 'saml') {
      const hasMetadataXml = !!provider.metadataXml?.trim();
      const hasMetadata = !!provider.metadataUrl?.trim() || hasMetadataXml;
      const hasManual = !!provider.entryPoint?.trim() && !!provider.idpCert?.trim();
      if (!hasMetadata && !hasManual) {
        nextErrors[`${prefix}samlConfig`] = t(
          'admin.sso.errors.samlConfigRequired',
          'Metadata or manual IdP fields are required',
        );
      }
      // Mirror the server-side check in assertEnabledProviderConfig; the frontend cannot parse
      // metadataXml, so it requires the field whenever inline XML is not supplied.
      if (!hasMetadataXml && !provider.idpIssuer?.trim()) {
        nextErrors[`${prefix}idpIssuer`] = t(
          'admin.sso.errors.idpIssuerRequired',
          'IdP Issuer is required unless inline metadata XML provides it',
        );
      }
    }
    (provider.roleMappings || []).forEach((mapping, index) => {
      if (!mapping.externalGroup.trim()) {
        nextErrors[`${prefix}mapping_${index}`] = t(
          'admin.sso.errors.externalGroupRequired',
          'External group is required',
        );
      }
    });
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSaveProvider = async (protocol: SsoProtocol, event: React.FormEvent) => {
    event.preventDefault();
    clearProviderSaveError(protocol);
    const draft = providerDrafts[protocol];
    if (!validateProvider(draft)) return;
    setSavingProvider(protocol);
    try {
      const saved = await onSaveSsoProvider({
        ...draft,
        protocol,
        slug: draft.slug?.trim().toLowerCase(),
        name: draft.name?.trim(),
      });
      loadProviderDraft(protocol, saved);
      showSaved();
    } catch (err) {
      setProviderSaveErrors((current) => ({
        ...current,
        [protocol]: getProviderSaveErrorMessage(err),
      }));
    } finally {
      setSavingProvider(null);
    }
  };

  const renderProviderList = (protocol: SsoProtocol) => (
    <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
      <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <ProviderIcon protocol={protocol} className="size-4 text-praetor" />
          {protocol === 'oidc'
            ? t('admin.sso.oidcProviders', 'OpenID Connect Providers')
            : t('admin.sso.samlProviders', 'SAML Providers')}
        </CardTitle>
        <CardDescription>
          {protocol === 'oidc'
            ? t(
                'admin.sso.oidcProvidersDescription',
                'Manage OpenID Connect identity providers for single sign-on.',
              )
            : t(
                'admin.sso.samlProvidersDescription',
                'Manage SAML identity providers for single sign-on.',
              )}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {providersByProtocol[protocol].length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t('admin.sso.noProviders', 'No providers configured.')}
            </p>
          ) : (
            providersByProtocol[protocol].map((provider) => (
              <div key={provider.id} className="p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{provider.name}</span>
                    <span
                      className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-full',
                        provider.enabled
                          ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {provider.enabled
                        ? t('admin.sso.enabled', 'Enabled')
                        : t('admin.sso.disabled', 'Disabled')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{provider.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => loadProviderDraft(protocol, provider)}
                    className="text-muted-foreground hover:text-primary"
                    title={t('admin.sso.editProvider', 'Edit provider')}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDeleteSsoProvider(provider.id)}
                    className="text-muted-foreground hover:text-destructive"
                    title={t('admin.sso.deleteProvider', 'Delete provider')}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );

  const renderProviderForm = (protocol: SsoProtocol) => {
    const draft = providerDrafts[protocol];
    const prefix = `${protocol}_`;
    return (
      <form onSubmit={(event) => handleSaveProvider(protocol, event)}>
        <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
          <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
            <CardTitle className="flex items-center gap-3 text-base">
              {draft.id ? (
                <Pencil aria-hidden="true" className="size-4 text-praetor" />
              ) : (
                <Plus aria-hidden="true" className="size-4 text-praetor" />
              )}
              {draft.id
                ? t('admin.sso.editProvider', 'Edit provider')
                : t('admin.sso.newProvider', 'New provider')}
            </CardTitle>
            <CardDescription>
              {t(
                'admin.sso.providerFormDescription',
                'Configure the connection details and attribute mappings for this identity provider.',
              )}
            </CardDescription>
            <CardAction>
              <UIField className="flex-row items-center gap-2">
                <Switch
                  id={`provider-enabled-${protocol}`}
                  checked={!!draft.enabled}
                  onCheckedChange={(enabled) => updateProviderDraft(protocol, { enabled })}
                />
                <FieldLabel htmlFor={`provider-enabled-${protocol}`}>
                  {t('admin.sso.enabled', 'Enabled')}
                </FieldLabel>
              </UIField>
            </CardAction>
          </CardHeader>

          <CardContent className="p-6 space-y-6">
            {providerSaveErrors[protocol] && (
              <Alert variant="destructive" className="border-destructive/30">
                <CircleAlert />
                <AlertTitle>
                  {t('admin.sso.errors.saveFailedTitle', 'Provider could not be saved')}
                </AlertTitle>
                <AlertDescription>{providerSaveErrors[protocol]}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Field
                label={t('admin.sso.name', 'Name')}
                value={draft.name || ''}
                error={errors[`${prefix}name`]}
                onChange={(name) => updateProviderDraft(protocol, { name })}
              />
              <Field
                label={t('admin.sso.slug', 'Slug')}
                value={draft.slug || ''}
                error={errors[`${prefix}slug`]}
                monospace
                onChange={(slug) => updateProviderDraft(protocol, { slug: slug.toLowerCase() })}
              />
            </div>

            {protocol === 'oidc' ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Field
                    label={t('admin.sso.issuerUrl', 'Issuer URL')}
                    value={draft.issuerUrl || ''}
                    error={errors[`${prefix}issuerUrl`]}
                    monospace
                    onChange={(issuerUrl) => updateProviderDraft(protocol, { issuerUrl })}
                  />
                  <Field
                    label={t('admin.sso.clientId', 'Client ID')}
                    value={draft.clientId || ''}
                    error={errors[`${prefix}clientId`]}
                    monospace
                    onChange={(clientId) => updateProviderDraft(protocol, { clientId })}
                  />
                  <SecretField
                    label={t('admin.sso.clientSecret', 'Client Secret')}
                    value={draft.clientSecret || ''}
                    monospace
                    isStored={isStoredSecret(draft.clientSecret)}
                    isReplacing={!!replacingSecrets[protocol].clientSecret}
                    onStartReplace={() => startReplaceSecret(protocol, 'clientSecret')}
                    onCancelReplace={() => cancelReplaceSecret(protocol, 'clientSecret')}
                    onChange={(clientSecret) => updateProviderDraft(protocol, { clientSecret })}
                    storedLabel={t('admin.sso.secretStored', 'Secret stored')}
                    storedHelp={t(
                      'admin.sso.secretStoredHelp',
                      'Leave as-is to keep the stored secret, or click Replace to overwrite it.',
                    )}
                  />
                  <Field
                    label={t('admin.sso.scopes', 'Scopes')}
                    value={draft.scopes || 'openid profile email'}
                    monospace
                    onChange={(scopes) => updateProviderDraft(protocol, { scopes })}
                  />
                </div>
                <UIField className="flex-row items-start gap-3 rounded-lg border border-border bg-muted p-4">
                  <Switch
                    id={`provider-end-session-${protocol}`}
                    checked={!!draft.endSessionEnabled}
                    onCheckedChange={(endSessionEnabled) =>
                      updateProviderDraft(protocol, { endSessionEnabled })
                    }
                    className="mt-0.5"
                  />
                  <div className="flex flex-col gap-1">
                    <FieldLabel htmlFor={`provider-end-session-${protocol}`}>
                      {t('admin.sso.endSessionEnabled', 'Call IdP end-session endpoint on logout')}
                    </FieldLabel>
                    <FieldDescription>
                      {t(
                        'admin.sso.endSessionHint',
                        "When enabled, logging out of Praetor also terminates the user's session at the IdP (OIDC RP-Initiated Logout). Requires the IdP's discovery document to advertise an end_session_endpoint and the post-logout redirect URI to be registered with the IdP.",
                      )}
                    </FieldDescription>
                  </div>
                </UIField>
              </>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Field
                  label={t('admin.sso.metadataUrl', 'Metadata URL')}
                  value={draft.metadataUrl || ''}
                  monospace
                  onChange={(metadataUrl) => updateProviderDraft(protocol, { metadataUrl })}
                />
                <Field
                  label={t('admin.sso.entryPoint', 'Entry Point')}
                  value={draft.entryPoint || ''}
                  monospace
                  onChange={(entryPoint) => updateProviderDraft(protocol, { entryPoint })}
                />
                <Field
                  label={t('admin.sso.idpIssuer', 'IdP Issuer')}
                  value={draft.idpIssuer || ''}
                  monospace
                  error={errors[`${prefix}idpIssuer`]}
                  onChange={(idpIssuer) => updateProviderDraft(protocol, { idpIssuer })}
                />
                <Field
                  label={t('admin.sso.spIssuer', 'SP Issuer')}
                  value={draft.spIssuer || ''}
                  monospace
                  onChange={(spIssuer) => updateProviderDraft(protocol, { spIssuer })}
                />
                <SecretField
                  multiline
                  monospace
                  label={t('admin.sso.metadataXml', 'Metadata XML')}
                  value={draft.metadataXml || ''}
                  isStored={isStoredSecret(draft.metadataXml)}
                  isReplacing={!!replacingSecrets[protocol].metadataXml}
                  onStartReplace={() => startReplaceSecret(protocol, 'metadataXml')}
                  onCancelReplace={() => cancelReplaceSecret(protocol, 'metadataXml')}
                  onChange={(metadataXml) => updateProviderDraft(protocol, { metadataXml })}
                  storedLabel={t('admin.sso.metadataXmlStored', 'Metadata XML stored')}
                  storedHelp={t(
                    'admin.sso.metadataXmlStoredHelp',
                    'Leave as-is to keep the stored metadata, or click Replace to overwrite it.',
                  )}
                />
                <SecretField
                  multiline
                  monospace
                  label={t('admin.sso.idpCert', 'IdP Certificate')}
                  value={draft.idpCert || ''}
                  isStored={isStoredSecret(draft.idpCert)}
                  isReplacing={!!replacingSecrets[protocol].idpCert}
                  onStartReplace={() => startReplaceSecret(protocol, 'idpCert')}
                  onCancelReplace={() => cancelReplaceSecret(protocol, 'idpCert')}
                  onChange={(idpCert) => updateProviderDraft(protocol, { idpCert })}
                  storedLabel={t('admin.sso.idpCertStored', 'Certificate stored')}
                  storedHelp={t(
                    'admin.sso.idpCertStoredHelp',
                    'Leave as-is to keep the stored certificate, or click Replace to overwrite it.',
                  )}
                />
                <SecretField
                  multiline
                  monospace
                  label={t('admin.sso.privateKey', 'Signing Private Key')}
                  value={draft.privateKey || ''}
                  isStored={isStoredSecret(draft.privateKey)}
                  isReplacing={!!replacingSecrets[protocol].privateKey}
                  onStartReplace={() => startReplaceSecret(protocol, 'privateKey')}
                  onCancelReplace={() => cancelReplaceSecret(protocol, 'privateKey')}
                  onChange={(privateKey) => updateProviderDraft(protocol, { privateKey })}
                  storedLabel={t('admin.sso.privateKeyStored', 'Private key stored')}
                  storedHelp={t(
                    'admin.sso.privateKeyStoredHelp',
                    'Leave as-is to keep the stored key, or click Replace to overwrite it.',
                  )}
                />
                <TextArea
                  label={t('admin.sso.publicCert', 'Signing Public Certificate')}
                  value={draft.publicCert || ''}
                  onChange={(publicCert) => updateProviderDraft(protocol, { publicCert })}
                />
                {!!draft.slug?.trim() && acsUrlState.status !== 'loading' && (
                  <div className="md:col-span-2">
                    {acsUrlState.status === 'ready' ? (
                      <ReadOnlyField
                        label={t('admin.sso.acsUrl', 'ACS URL')}
                        value={fillSlugTemplate(
                          acsUrlState.template,
                          draft.slug.trim().toLowerCase(),
                        )}
                        monospace
                      />
                    ) : (
                      <UIField>
                        <FieldLabel>{t('admin.sso.acsUrl', 'ACS URL')}</FieldLabel>
                        <FieldError>
                          {acsUrlState.message ||
                            t(
                              'admin.sso.errors.acsUrlUnavailable',
                              'ACS URL unavailable: configure SSO_CALLBACK_BASE_URL on the backend.',
                            )}
                        </FieldError>
                      </UIField>
                    )}
                  </div>
                )}
                {errors[`${prefix}samlConfig`] && (
                  <FieldError className="md:col-span-2">{errors[`${prefix}samlConfig`]}</FieldError>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Field
                label={
                  protocol === 'oidc'
                    ? t('admin.sso.usernameClaim', 'Username Claim')
                    : t('admin.sso.usernameAttribute', 'Username Attribute')
                }
                value={draft.usernameAttribute || ''}
                error={errors[`${prefix}usernameAttribute`]}
                monospace
                onChange={(usernameAttribute) =>
                  updateProviderDraft(protocol, { usernameAttribute })
                }
              />
              <Field
                label={t('admin.sso.nameAttribute', 'Name Attribute')}
                value={draft.nameAttribute || ''}
                monospace
                onChange={(nameAttribute) => updateProviderDraft(protocol, { nameAttribute })}
              />
              <Field
                label={t('admin.sso.emailAttribute', 'Email Attribute')}
                value={draft.emailAttribute || ''}
                monospace
                onChange={(emailAttribute) => updateProviderDraft(protocol, { emailAttribute })}
              />
              <Field
                label={t('admin.sso.groupsAttribute', 'Groups Attribute')}
                value={draft.groupsAttribute || ''}
                monospace
                onChange={(groupsAttribute) => updateProviderDraft(protocol, { groupsAttribute })}
              />
            </div>

            <RoleMappings
              mappings={draft.roleMappings || []}
              roleOptions={roleOptions}
              errors={errors}
              errorPrefix={`${prefix}mapping_`}
              heading={t('admin.sso.roleMappings', 'Role Mappings')}
              addLabel={t('admin.sso.addMapping', 'Add Mapping')}
              noMappingsLabel={t('admin.sso.noMappingsConfigured', 'No mappings configured.')}
              externalPlaceholder={t('admin.sso.externalGroupPlaceholder', 'External group')}
              onAdd={() =>
                updateProviderDraft(protocol, {
                  roleMappings: [
                    ...(draft.roleMappings || []),
                    { externalGroup: '', role: roleOptions[0]?.id || 'user' },
                  ],
                })
              }
              onRemove={(index) =>
                updateProviderDraft(protocol, {
                  roleMappings: (draft.roleMappings || []).filter((_, idx) => idx !== index),
                })
              }
              onChange={(index, field, value) =>
                updateProviderMapping(protocol, index, field, value)
              }
            />
          </CardContent>

          <CardFooter className="justify-between border-t border-border px-6 py-4 [.border-t]:pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => loadProviderDraft(protocol, buildDefaultProvider(protocol))}
              className="font-bold text-muted-foreground hover:text-foreground"
            >
              {t('admin.sso.clearForm', 'Clear')}
            </Button>
            <Button type="submit" size="lg" disabled={savingProvider === protocol}>
              {savingProvider === protocol ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                t('admin.sso.saveProvider', 'Save Provider')
              )}
            </Button>
          </CardFooter>
        </Card>
      </form>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">{t('admin.title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('admin.subtitle')}</p>
        </div>
        {isSaved && (
          <div className="bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-md animate-in fade-in slide-in-from-right-4 flex items-center gap-2">
            <Check aria-hidden="true" className="size-4" />{' '}
            {t('admin.ldap.changesSaved', 'Changes Saved')}
          </div>
        )}
      </div>

      <div className="flex border-b border-border gap-8">
        <AuthTabButton
          tab="ldap"
          activeTab={activeTab}
          icon={<FolderTree aria-hidden="true" className="size-4" />}
          label={t('admin.tabs.ldap', 'LDAP / Active Directory')}
          onSelect={handleActiveTabSelect}
        />
        <AuthTabButton
          tab="oidc"
          activeTab={activeTab}
          icon={<OpenIdIcon className="size-4" />}
          label={t('admin.tabs.oidc', 'OpenID Connect')}
          onSelect={handleActiveTabSelect}
        />
        <AuthTabButton
          tab="saml"
          activeTab={activeTab}
          icon={<ShieldCheck aria-hidden="true" className="size-4" />}
          label={t('admin.tabs.saml', 'SAML')}
          onSelect={handleActiveTabSelect}
        />
      </div>

      {activeTab === 'ldap' && (
        <div className="space-y-8">
          <form onSubmit={handleSaveLdap} className="space-y-8">
            <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
              <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
                <CardTitle className="flex items-center gap-3 text-base">
                  <Server aria-hidden="true" className="size-4 text-praetor" />
                  {t('admin.ldap.serverConfig')}
                </CardTitle>
                <CardDescription>
                  {t(
                    'admin.ldap.serverConfigDescription',
                    'Connect Praetor to your LDAP or Active Directory to authenticate users.',
                  )}
                </CardDescription>
                <CardAction>
                  <UIField className="flex-row items-center gap-2">
                    <Switch
                      id="ldap-enabled"
                      checked={ldapForm.enabled}
                      onCheckedChange={(enabled) => setLdapForm((prev) => ({ ...prev, enabled }))}
                    />
                    <FieldLabel htmlFor="ldap-enabled">{t('admin.ldap.enabled')}</FieldLabel>
                  </UIField>
                </CardAction>
              </CardHeader>

              <CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <Field
                  label={t('admin.ldap.serverUrlLabel')}
                  value={ldapForm.serverUrl}
                  error={errors.serverUrl}
                  monospace
                  onChange={(serverUrl) => setLdapForm((prev) => ({ ...prev, serverUrl }))}
                />
                <Field
                  label={t('admin.ldap.baseDnLabel')}
                  value={ldapForm.baseDn}
                  error={errors.baseDn}
                  monospace
                  onChange={(baseDn) => setLdapForm((prev) => ({ ...prev, baseDn }))}
                />
                <Field
                  label={t('admin.ldap.userSearchFilter')}
                  value={ldapForm.userFilter}
                  error={errors.userFilter}
                  monospace
                  onChange={(userFilter) => setLdapForm((prev) => ({ ...prev, userFilter }))}
                />
                <Field
                  label={t('admin.ldap.bindDnLabel')}
                  value={ldapForm.bindDn}
                  error={errors.bindCredentials}
                  monospace
                  onChange={(bindDn) => setLdapForm((prev) => ({ ...prev, bindDn }))}
                />
                <SecretField
                  {...bindPasswordReplace}
                  label={t('admin.ldap.bindPasswordLabel')}
                  value={ldapForm.bindPassword}
                  monospace
                  onChange={(bindPassword) => setLdapForm((prev) => ({ ...prev, bindPassword }))}
                  storedLabel={t('admin.ldap.bindPasswordStored', 'Bind password stored')}
                  storedHelp={t(
                    'admin.ldap.bindPasswordStoredHelp',
                    'Leave as-is to keep the stored password, or click Replace to overwrite it.',
                  )}
                  error={errors.bindCredentials}
                  testId="ldap-bind-password"
                />
                <Field
                  label={t('admin.ldap.groupSearchBase')}
                  value={ldapForm.groupBaseDn}
                  error={errors.groupBaseDn}
                  monospace
                  onChange={(groupBaseDn) => setLdapForm((prev) => ({ ...prev, groupBaseDn }))}
                />
                <Field
                  label={t('admin.ldap.groupMemberFilter')}
                  value={ldapForm.groupFilter}
                  error={errors.groupFilter}
                  monospace
                  onChange={(groupFilter) => setLdapForm((prev) => ({ ...prev, groupFilter }))}
                />
              </CardContent>

              <fieldset className="border-t border-border p-6 space-y-4">
                <legend className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
                  {t('admin.ldap.provisioning.heading', 'User Provisioning')}
                </legend>
                <div className="flex items-start gap-3">
                  <Switch
                    id="ldap-provision-on-login"
                    checked={ldapForm.provisionOnLogin}
                    onCheckedChange={(provisionOnLogin) =>
                      setLdapForm((prev) => ({ ...prev, provisionOnLogin }))
                    }
                  />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <FieldLabel htmlFor="ldap-provision-on-login" className="cursor-pointer">
                      {t('admin.ldap.provisioning.onLoginLabel', 'Provision on first login')}
                    </FieldLabel>
                    <FieldDescription>
                      {t(
                        'admin.ldap.provisioning.onLoginHelp',
                        'When on, any LDAP user that authenticates successfully gets a local account created on first sign-in. Turn off to restrict logins to users that already have a local account (created manually or via sync).',
                      )}
                    </FieldDescription>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Switch
                    id="ldap-auto-provision-all"
                    checked={ldapForm.autoProvisionAll}
                    onCheckedChange={(autoProvisionAll) =>
                      setLdapForm((prev) => ({ ...prev, autoProvisionAll }))
                    }
                  />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <FieldLabel htmlFor="ldap-auto-provision-all" className="cursor-pointer">
                      {t('admin.ldap.provisioning.autoAllLabel', 'Bulk-provision during sync')}
                    </FieldLabel>
                    <FieldDescription>
                      {t(
                        'admin.ldap.provisioning.autoAllHelp',
                        'When on, the periodic sync creates a local account for every LDAP entry that matches the user filter, applying group role mappings at creation. When off, sync only refreshes display names of users that already exist. Either way, role mappings are never re-applied to users that already exist in Praetor.',
                      )}
                    </FieldDescription>
                  </div>
                </div>
              </fieldset>

              <div className="border-t border-border p-6">
                <RoleMappings
                  mappings={ldapForm.roleMappings.map((mapping) => ({
                    externalGroup: mapping.ldapGroup,
                    role: mapping.role,
                  }))}
                  roleOptions={roleOptions}
                  errors={errors}
                  errorPrefix="ldapRoleMapping_"
                  heading={t('admin.ldap.roleMappings')}
                  addLabel={t('admin.ldap.addMapping')}
                  noMappingsLabel={t('admin.ldap.noMappingsConfigured')}
                  externalPlaceholder={t('admin.ldap.ldapGroupPlaceholder', 'LDAP Group CN')}
                  onAdd={() =>
                    setLdapForm((prev) => ({
                      ...prev,
                      roleMappings: [
                        ...ldapForm.roleMappings,
                        { ldapGroup: '', role: roleOptions[0]?.id || 'user' },
                      ],
                    }))
                  }
                  onRemove={(index) =>
                    setLdapForm((prev) => ({
                      ...prev,
                      roleMappings: ldapForm.roleMappings.filter((_, idx) => idx !== index),
                    }))
                  }
                  onChange={(index, field, value) =>
                    updateLdapMapping(
                      index,
                      field === 'externalGroup' ? 'ldapGroup' : 'role',
                      value,
                    )
                  }
                />
              </div>
            </Card>

            <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
              <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
                <CardTitle className="flex items-center gap-3 text-base">
                  <Lock aria-hidden="true" className="size-4 text-praetor" />
                  {t('admin.ldap.tls.title', 'TLS / Certificates')}
                </CardTitle>
                <CardDescription>
                  {t(
                    'admin.ldap.tls.description',
                    "Verify the LDAP server's certificate when connecting over ldaps://.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <UIField>
                  <FieldLabel htmlFor="ldap-tls-ca-textarea">
                    {t('admin.ldap.tls.caCertificateLabel', 'Custom CA Certificate (Optional)')}
                  </FieldLabel>
                  <FieldDescription>
                    {t(
                      'admin.ldap.tls.caCertificateHelp',
                      'Paste a PEM-encoded CA certificate or chain used to verify the LDAP server when using ldaps://. Required only if the server uses a certificate not signed by a publicly trusted CA.',
                    )}
                  </FieldDescription>
                  <Textarea
                    id="ldap-tls-ca-textarea"
                    rows={8}
                    value={ldapForm.tlsCaCertificate}
                    onChange={(event) => {
                      setLdapForm((prev) => ({ ...prev, tlsCaCertificate: event.target.value }));
                      if (errors.tlsCaCertificate)
                        setErrors((prev) => ({ ...prev, tlsCaCertificate: '' }));
                    }}
                    placeholder={`${PEM_BEGIN_MARKER}\nMIIDdzCCAl+gAwIBAgI...\n${PEM_END_MARKER}`}
                    aria-label={t(
                      'admin.ldap.tls.caCertificateLabel',
                      'Custom CA Certificate (Optional)',
                    )}
                    aria-invalid={!!errors.tlsCaCertificate}
                    className="font-mono text-xs leading-relaxed"
                    spellCheck={false}
                  />
                  {errors.tlsCaCertificate && (
                    <FieldError errors={[{ message: errors.tlsCaCertificate }]} />
                  )}
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => tlsCaFileInputRef.current?.click()}
                      className="text-xs font-bold"
                    >
                      <FileUp aria-hidden="true" />
                      {t('admin.ldap.tls.importPemFile', 'Import .pem file')}
                    </Button>
                    {ldapForm.tlsCaCertificate.trim() !== '' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setLdapForm((prev) => ({ ...prev, tlsCaCertificate: '' }));
                          if (errors.tlsCaCertificate)
                            setErrors((prev) => ({ ...prev, tlsCaCertificate: '' }));
                        }}
                        className="text-xs font-bold text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 aria-hidden="true" />
                        {t('admin.ldap.tls.clear', 'Clear')}
                      </Button>
                    )}
                    <span className="text-[10px] text-muted-foreground italic">
                      {t(
                        'admin.ldap.tls.caClearedHint',
                        'Leave blank to use the system trust store (or LDAP_TLS_CA_FILE env var if set).',
                      )}
                    </span>
                  </div>
                  <input
                    ref={tlsCaFileInputRef}
                    type="file"
                    accept=".pem,.crt,.cer,.cert"
                    onChange={handleTlsCaFileImport}
                    aria-label={t('admin.ldap.tls.importPemFile', 'Import .pem file')}
                    className="hidden"
                  />
                </UIField>
              </CardContent>
            </Card>

            {errors.general && (
              <div
                role="alert"
                className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive"
              >
                {errors.general}
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" size="lg" disabled={isSavingLdap || !isLdapDirty}>
                <Save aria-hidden="true" />
                {t('admin.ldap.saveConfiguration', 'Save Configuration')}
              </Button>
            </div>
          </form>

          <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
            <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
              <CardTitle className="flex items-center gap-3 text-base">
                <FlaskConical aria-hidden="true" className="size-4 text-praetor" />
                {t('admin.ldap.connectionTester')}
              </CardTitle>
              <CardDescription>
                {t(
                  'admin.ldap.testDescription',
                  'Enter credentials to test authentication and group retrieval against the saved configuration.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-8">
              <form onSubmit={handleTestLdap} className="space-y-4">
                {isLdapDirty && (
                  <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                    {t(
                      'admin.ldap.test.unsavedChanges',
                      'Save the LDAP configuration before testing recent changes.',
                    )}
                  </p>
                )}
                <Field
                  label={t('admin.ldap.testUsername')}
                  value={testUsername}
                  error={testErrors.testUsername}
                  onChange={(value) => {
                    setTestUsername(value);
                    if (testErrors.testUsername)
                      setTestErrors((prev) => ({ ...prev, testUsername: '' }));
                  }}
                />
                <Field
                  label={t('admin.ldap.testPassword')}
                  value={testPassword}
                  type="password"
                  error={testErrors.testPassword}
                  onChange={(value) => {
                    setTestPassword(value);
                    if (testErrors.testPassword)
                      setTestErrors((prev) => ({ ...prev, testPassword: '' }));
                  }}
                />
                <Button type="submit" size="lg" className="w-full" disabled={isTestingLdap}>
                  {isTestingLdap ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    t('admin.ldap.testAuthentication')
                  )}
                </Button>
              </form>

              <div className="min-h-64 overflow-y-auto rounded-md border border-border bg-muted/40 p-4 font-mono text-xs">
                {isTestingLdap ? (
                  <div className="text-muted-foreground animate-pulse">
                    {t('admin.ldap.test.connecting', 'Connecting to LDAP server...')}
                  </div>
                ) : testResult ? (
                  <div className="space-y-3">
                    <div
                      className={cn(
                        'font-bold',
                        testResult.authenticated
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-destructive',
                      )}
                    >
                      [
                      {testResult.authenticated
                        ? t('admin.ldap.test.success', 'SUCCESS')
                        : t('admin.ldap.test.failure', 'FAILURE')}
                      ] {testResult.message}
                    </div>
                    {testResult.authenticated &&
                      (() => {
                        const helpKey = LDAP_ROLE_RESOLUTION_HELP_KEYS[testResult.roleResolution];
                        return (
                          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-muted-foreground">
                            <span>{t('admin.ldap.test.userDn', 'User DN')}</span>
                            <span className="text-foreground break-all">
                              {testResult.userDn || '-'}
                            </span>
                            <span>
                              {t(LDAP_ROLE_RESOLUTION_LABEL_KEYS[testResult.roleResolution])}
                            </span>
                            <span className="text-foreground">
                              {testResult.roleIds.length ? testResult.roleIds.join(', ') : '-'}
                            </span>
                            {helpKey && (
                              <span
                                className="col-span-2 text-xs text-muted-foreground"
                                data-testid="ldap-test-role-resolution-help"
                              >
                                {t(helpKey)}
                              </span>
                            )}
                            <span>{t('admin.ldap.test.groupsFound', 'Groups Found:')}</span>
                            <span className="text-foreground">
                              {testResult.groups.length ? testResult.groups.join(', ') : '-'}
                            </span>
                          </div>
                        );
                      })()}
                    <div className="border-t border-border pt-3">
                      <div className="text-muted-foreground mb-2">
                        {t('admin.ldap.test.serverResponse', 'Server Response')}
                      </div>
                      <pre className="text-foreground/80 whitespace-pre-wrap break-words">
                        {JSON.stringify(testResult, null, 2)}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground italic">
                    {t('admin.ldap.test.waiting', 'Waiting for test execution...')}
                    <br />
                    <br />
                    <span className="opacity-70">
                      {t('admin.ldap.test.logOutput', 'Log output will appear here after testing.')}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {(activeTab === 'oidc' || activeTab === 'saml') && (
        <div className="space-y-8">
          {renderProviderList(activeTab)}
          {renderProviderForm(activeTab)}
        </div>
      )}
    </div>
  );
};

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  monospace?: boolean;
};

const Field: React.FC<FieldProps> = ({
  label,
  value,
  onChange,
  error,
  type = 'text',
  monospace,
}) => {
  const id = useId();
  return (
    <UIField>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        aria-invalid={!!error}
        className={cn(monospace && 'font-mono')}
      />
      {error && <FieldError errors={[{ message: error }]} />}
    </UIField>
  );
};

type TextAreaProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

const TextArea: React.FC<TextAreaProps> = ({ label, value, onChange }) => {
  const id = useId();
  return (
    <UIField>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        aria-label={label}
        className="font-mono"
      />
    </UIField>
  );
};

type ReadOnlyFieldProps = {
  label: string;
  value: string;
  monospace?: boolean;
};

const ReadOnlyField: React.FC<ReadOnlyFieldProps> = ({ label, value, monospace }) => {
  const id = useId();
  return (
    <UIField>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="text"
        readOnly
        value={value}
        aria-label={label}
        className={cn('bg-muted text-muted-foreground', monospace && 'font-mono')}
      />
    </UIField>
  );
};

type RoleMappingsProps = {
  mappings: SsoRoleMapping[];
  roleOptions: { id: string; name: string }[];
  errors: Record<string, string>;
  errorPrefix: string;
  heading: string;
  addLabel: string;
  noMappingsLabel: string;
  externalPlaceholder: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, field: keyof SsoRoleMapping, value: string) => void;
};

const RoleMappings: React.FC<RoleMappingsProps> = ({
  mappings,
  roleOptions,
  errors,
  errorPrefix,
  heading,
  addLabel,
  noMappingsLabel,
  externalPlaceholder,
  onAdd,
  onRemove,
  onChange,
}) => (
  <div>
    <div className="flex justify-between items-center mb-4">
      <h4 className="text-sm font-semibold text-foreground">{heading}</h4>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onAdd}
        className="text-xs font-bold"
      >
        <Plus aria-hidden="true" />
        {addLabel}
      </Button>
    </div>
    <div className="space-y-3">
      {mappings.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{noMappingsLabel}</p>
      ) : (
        mappings.map((mapping, index) => (
          <div
            key={`${mapping.externalGroup || 'external-group'}:${mapping.role || roleOptions[0]?.id || 'user'}`}
            className="flex gap-4 items-start"
          >
            <div className="flex-1">
              <Input
                type="text"
                value={mapping.externalGroup}
                onChange={(event) => onChange(index, 'externalGroup', event.target.value)}
                placeholder={externalPlaceholder}
                aria-label={externalPlaceholder}
                aria-invalid={!!errors[`${errorPrefix}${index}`]}
                className="font-mono"
              />
              {errors[`${errorPrefix}${index}`] && (
                <FieldError
                  className="mt-1"
                  errors={[{ message: errors[`${errorPrefix}${index}`] }]}
                />
              )}
            </div>
            <ArrowRight aria-hidden="true" className="size-3 text-muted-foreground mt-3 shrink-0" />
            <div className="w-44">
              <SelectControl
                options={roleOptions}
                value={mapping.role || roleOptions[0]?.id || 'user'}
                onChange={(role) => onChange(index, 'role', role as string)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onRemove(index)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))
      )}
    </div>
  </div>
);

export default AuthSettings;
