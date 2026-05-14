import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { siOpenid } from 'simple-icons';
import { getApiBase } from '../../services/api/client';
import { ldapApi } from '../../services/api/ldap';
import type {
  LdapConfig,
  LdapTestResponse,
  Role,
  SsoProtocol,
  SsoProvider,
  SsoRoleMapping,
} from '../../types';
import SelectControl from '../shared/SelectControl';
import Toggle from '../shared/Toggle';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';

const PEM_BEGIN_MARKER = '-----BEGIN CERTIFICATE-----';
const PEM_END_MARKER = '-----END CERTIFICATE-----';

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
});

const OpenIdIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg aria-hidden="true" className={className} role="img" viewBox="0 0 24 24" fill="currentColor">
    <path d={siOpenid.path} />
  </svg>
);

const renderProviderIcon = (protocol: SsoProtocol, className?: string) =>
  protocol === 'oidc' ? (
    <OpenIdIcon className={className} />
  ) : (
    <i className={`fa-solid fa-building-shield ${className ?? ''}`.trim()}></i>
  );

const buildSamlAcsUrl = (slug: string): string =>
  `${getApiBase()}/auth/sso/saml/${encodeURIComponent(slug)}/callback`;

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
  const [ldapForm, setLdapForm] = useState<LdapConfig>(config || DEFAULT_LDAP_CONFIG);
  const [providerDrafts, setProviderDrafts] = useState<Record<SsoProtocol, Partial<SsoProvider>>>({
    oidc: buildDefaultProvider('oidc'),
    saml: buildDefaultProvider('saml'),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testUsername, setTestUsername] = useState('');
  const [testPassword, setTestPassword] = useState('');
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<LdapTestResponse | null>(null);
  const [isTestingLdap, setIsTestingLdap] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isSavingLdap, setIsSavingLdap] = useState(false);
  const [savingProvider, setSavingProvider] = useState<SsoProtocol | null>(null);
  const tlsCaFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLdapForm(config || DEFAULT_LDAP_CONFIG);
  }, [config]);

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
      });
    } finally {
      setIsTestingLdap(false);
    }
  };

  const updateProviderDraft = (protocol: SsoProtocol, patch: Partial<SsoProvider>) => {
    setProviderDrafts((current) => ({
      ...current,
      [protocol]: { ...current[protocol], ...patch, protocol },
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
      const hasMetadata = !!provider.metadataUrl?.trim() || !!provider.metadataXml?.trim();
      const hasManual = !!provider.entryPoint?.trim() && !!provider.idpCert?.trim();
      if (!hasMetadata && !hasManual) {
        nextErrors[`${prefix}samlConfig`] = t(
          'admin.sso.errors.samlConfigRequired',
          'Metadata or manual IdP fields are required',
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
      setProviderDrafts((current) => ({ ...current, [protocol]: saved }));
      showSaved();
    } finally {
      setSavingProvider(null);
    }
  };

  const renderTabButton = (tab: 'ldap' | SsoProtocol, icon: React.ReactNode, label: string) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => setActiveTab(tab)}
      className={`relative pb-4 font-bold rounded-none bg-transparent hover:bg-transparent dark:hover:bg-transparent ${activeTab === tab ? 'text-primary hover:text-primary' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {icon}
      {label}
      {activeTab === tab && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"></div>
      )}
    </Button>
  );

  const renderRoleSelect = (value: string, onChange: (value: string) => void) => (
    <SelectControl
      options={roleOptions}
      value={value}
      onChange={(val) => onChange(val as string)}
    />
  );

  const renderProviderList = (protocol: SsoProtocol) => (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex items-center gap-3">
        {renderProviderIcon(protocol, 'size-4 text-praetor')}
        <h3 className="font-semibold text-zinc-800">
          {protocol === 'oidc'
            ? t('admin.sso.oidcProviders', 'OpenID Connect Providers')
            : t('admin.sso.samlProviders', 'SAML Providers')}
        </h3>
      </div>
      <div className="divide-y divide-zinc-100">
        {providersByProtocol[protocol].length === 0 ? (
          <p className="p-6 text-sm text-zinc-400">
            {t('admin.sso.noProviders', 'No providers configured.')}
          </p>
        ) : (
          providersByProtocol[protocol].map((provider) => (
            <div key={provider.id} className="p-4 flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-zinc-800">{provider.name}</span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${provider.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-emerald-700'}`}
                  >
                    {provider.enabled
                      ? t('admin.sso.enabled', 'Enabled')
                      : t('admin.sso.disabled', 'Disabled')}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 font-mono">{provider.slug}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => updateProviderDraft(protocol, provider)}
                  className="text-muted-foreground hover:text-primary"
                  title={t('admin.sso.editProvider', 'Edit provider')}
                >
                  <i className="fa-solid fa-pen"></i>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onDeleteSsoProvider(provider.id)}
                  className="text-muted-foreground hover:text-destructive"
                  title={t('admin.sso.deleteProvider', 'Delete provider')}
                >
                  <i className="fa-solid fa-trash-can"></i>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderProviderForm = (protocol: SsoProtocol) => {
    const draft = providerDrafts[protocol];
    const prefix = `${protocol}_`;
    return (
      <form
        onSubmit={(event) => handleSaveProvider(protocol, event)}
        className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden"
      >
        <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <i className={`fa-solid ${draft.id ? 'fa-pen' : 'fa-plus'} text-praetor`}></i>
            <h3 className="font-semibold text-zinc-800">
              {draft.id
                ? t('admin.sso.editProvider', 'Edit provider')
                : t('admin.sso.newProvider', 'New provider')}
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <Toggle
              checked={!!draft.enabled}
              onChange={(enabled) => updateProviderDraft(protocol, { enabled })}
            />
            <span className="text-sm font-medium text-zinc-600">
              {t('admin.sso.enabled', 'Enabled')}
            </span>
          </div>
        </div>

        <div className="p-6 space-y-6">
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
              <Field
                label={t('admin.sso.clientSecret', 'Client Secret')}
                type="password"
                value={draft.clientSecret || ''}
                monospace
                onChange={(clientSecret) => updateProviderDraft(protocol, { clientSecret })}
              />
              <Field
                label={t('admin.sso.scopes', 'Scopes')}
                value={draft.scopes || 'openid profile email'}
                monospace
                onChange={(scopes) => updateProviderDraft(protocol, { scopes })}
              />
            </div>
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
                onChange={(idpIssuer) => updateProviderDraft(protocol, { idpIssuer })}
              />
              <Field
                label={t('admin.sso.spIssuer', 'SP Issuer')}
                value={draft.spIssuer || ''}
                monospace
                onChange={(spIssuer) => updateProviderDraft(protocol, { spIssuer })}
              />
              <TextArea
                label={t('admin.sso.metadataXml', 'Metadata XML')}
                value={draft.metadataXml || ''}
                onChange={(metadataXml) => updateProviderDraft(protocol, { metadataXml })}
              />
              <TextArea
                label={t('admin.sso.idpCert', 'IdP Certificate')}
                value={draft.idpCert || ''}
                onChange={(idpCert) => updateProviderDraft(protocol, { idpCert })}
              />
              <TextArea
                label={t('admin.sso.privateKey', 'Signing Private Key')}
                value={draft.privateKey || ''}
                onChange={(privateKey) => updateProviderDraft(protocol, { privateKey })}
              />
              <TextArea
                label={t('admin.sso.publicCert', 'Signing Public Certificate')}
                value={draft.publicCert || ''}
                onChange={(publicCert) => updateProviderDraft(protocol, { publicCert })}
              />
              {!!draft.slug?.trim() && (
                <ReadOnlyField
                  label={t('admin.sso.acsUrl', 'ACS URL')}
                  value={buildSamlAcsUrl(draft.slug.trim().toLowerCase())}
                  monospace
                />
              )}
              {errors[`${prefix}samlConfig`] && (
                <p className="md:col-span-2 text-red-500 text-xs font-bold">
                  {errors[`${prefix}samlConfig`]}
                </p>
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
              onChange={(usernameAttribute) => updateProviderDraft(protocol, { usernameAttribute })}
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
            onChange={(index, field, value) => updateProviderMapping(protocol, index, field, value)}
            renderRoleSelect={renderRoleSelect}
          />
        </div>

        <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-200 flex justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => updateProviderDraft(protocol, buildDefaultProvider(protocol))}
            className="font-bold text-muted-foreground hover:text-foreground"
          >
            {t('admin.sso.clearForm', 'Clear')}
          </Button>
          <Button type="submit" size="lg" disabled={savingProvider === protocol}>
            {savingProvider === protocol ? (
              <i className="fa-solid fa-circle-notch fa-spin"></i>
            ) : (
              t('admin.sso.saveProvider', 'Save Provider')
            )}
          </Button>
        </div>
      </form>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-800">{t('admin.title')}</h2>
          <p className="text-sm text-zinc-500 mt-1">{t('admin.subtitle')}</p>
        </div>
        {isSaved && (
          <div className="bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-md animate-in fade-in slide-in-from-right-4 flex items-center gap-2">
            <i className="fa-solid fa-check"></i> {t('admin.ldap.changesSaved', 'Changes Saved')}
          </div>
        )}
      </div>

      <div className="flex border-b border-zinc-200 gap-8">
        {renderTabButton(
          'ldap',
          <i className="fa-solid fa-folder-tree"></i>,
          t('admin.tabs.ldap', 'LDAP / Active Directory'),
        )}
        {renderTabButton(
          'oidc',
          <OpenIdIcon className="size-4" />,
          t('admin.tabs.oidc', 'OpenID Connect'),
        )}
        {renderTabButton(
          'saml',
          <i className="fa-solid fa-building-shield"></i>,
          t('admin.tabs.saml', 'SAML'),
        )}
      </div>

      {activeTab === 'ldap' && (
        <div className="space-y-8">
          <form onSubmit={handleSaveLdap} className="space-y-8">
            <section className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <i className="fa-solid fa-server text-praetor"></i>
                  <h3 className="font-semibold text-zinc-800">{t('admin.ldap.serverConfig')}</h3>
                </div>
                <div className="flex items-center gap-3">
                  <Toggle
                    checked={ldapForm.enabled}
                    onChange={(enabled) => setLdapForm((prev) => ({ ...prev, enabled }))}
                  />
                  <span className="text-sm font-medium text-zinc-600">
                    {t('admin.ldap.enabled')}
                  </span>
                </div>
              </div>

              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
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
                <Field
                  label={t('admin.ldap.bindPasswordLabel')}
                  type="password"
                  value={ldapForm.bindPassword}
                  error={errors.bindCredentials}
                  monospace
                  onChange={(bindPassword) => setLdapForm((prev) => ({ ...prev, bindPassword }))}
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
              </div>

              <div className="border-t border-zinc-100 p-6 space-y-3">
                <div
                  id="ldap-provisioning-heading"
                  className="text-xs font-bold text-muted-foreground uppercase tracking-wider"
                >
                  {t('admin.ldap.provisioning.heading', 'User Provisioning Mode')}
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <span
                    className={`text-sm font-medium ${!ldapForm.autoProvisionAll ? 'text-foreground' : 'text-muted-foreground'}`}
                  >
                    {t('admin.ldap.provisioning.onLogin', 'Provision on Login')}
                  </span>
                  <Switch
                    checked={ldapForm.autoProvisionAll}
                    onCheckedChange={(autoProvisionAll) =>
                      setLdapForm((prev) => ({ ...prev, autoProvisionAll }))
                    }
                    aria-labelledby="ldap-provisioning-heading"
                  />
                  <span
                    className={`text-sm font-medium ${ldapForm.autoProvisionAll ? 'text-foreground' : 'text-muted-foreground'}`}
                  >
                    {t('admin.ldap.provisioning.autoAll', 'Auto provision all matching users')}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {ldapForm.autoProvisionAll
                    ? t(
                        'admin.ldap.provisioning.helpAutoAll',
                        'Periodic sync creates a local account for every LDAP entry that matches the user filter, and keeps existing users in sync.',
                      )
                    : t(
                        'admin.ldap.provisioning.helpOnLogin',
                        'Users are created the first time they sign in. Periodic sync only refreshes display names and role mappings of existing users.',
                      )}
                </p>
              </div>

              <div className="border-t border-zinc-100 p-6">
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
                  renderRoleSelect={renderRoleSelect}
                />
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex items-center gap-3">
                <i className="fa-solid fa-lock text-praetor"></i>
                <h3 className="font-semibold text-zinc-800">
                  {t('admin.ldap.tls.title', 'TLS / Certificates')}
                </h3>
              </div>
              <div className="p-6 space-y-3">
                <label
                  htmlFor="ldap-tls-ca-textarea"
                  className="block text-xs font-bold text-zinc-400 uppercase tracking-wider"
                >
                  {t('admin.ldap.tls.caCertificateLabel', 'Custom CA Certificate (Optional)')}
                </label>
                <p className="text-xs text-zinc-500">
                  {t(
                    'admin.ldap.tls.caCertificateHelp',
                    'Paste a PEM-encoded CA certificate or chain used to verify the LDAP server when using ldaps://. Required only if the server uses a certificate not signed by a publicly trusted CA.',
                  )}
                </p>
                <textarea
                  id="ldap-tls-ca-textarea"
                  rows={8}
                  value={ldapForm.tlsCaCertificate}
                  onChange={(event) => {
                    setLdapForm((prev) => ({ ...prev, tlsCaCertificate: event.target.value }));
                    if (errors.tlsCaCertificate)
                      setErrors((prev) => ({ ...prev, tlsCaCertificate: '' }));
                  }}
                  placeholder={`${PEM_BEGIN_MARKER}\nMIIDdzCCAl+gAwIBAgI...\n${PEM_END_MARKER}`}
                  className={`w-full px-4 py-2.5 bg-zinc-50 border rounded-lg focus:ring-2 outline-none font-mono text-xs leading-relaxed ${errors.tlsCaCertificate ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-zinc-200 focus:ring-praetor'}`}
                  spellCheck={false}
                />
                {errors.tlsCaCertificate && (
                  <p className="text-red-500 text-[10px] font-bold">{errors.tlsCaCertificate}</p>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => tlsCaFileInputRef.current?.click()}
                    className="text-xs font-bold"
                  >
                    <i className="fa-solid fa-file-arrow-up"></i>
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
                      <i className="fa-solid fa-trash-can"></i>
                      {t('admin.ldap.tls.clear', 'Clear')}
                    </Button>
                  )}
                  <span className="text-[10px] text-zinc-400 italic">
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
                  className="hidden"
                />
              </div>
            </section>

            {errors.general && (
              <div
                role="alert"
                className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive"
              >
                {errors.general}
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" size="lg" disabled={isSavingLdap}>
                {t('admin.ldap.saveConfiguration', 'Save Configuration')}
              </Button>
            </div>
          </form>

          <section className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex items-center gap-3">
              <i className="fa-solid fa-vial text-praetor"></i>
              <h3 className="font-semibold text-zinc-800">{t('admin.ldap.connectionTester')}</h3>
            </div>
            <div className="p-6 grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-8">
              <form onSubmit={handleTestLdap} className="space-y-4">
                <p className="text-xs text-zinc-500">
                  {t(
                    'admin.ldap.testDescription',
                    'Enter credentials to test authentication and group retrieval against the saved configuration.',
                  )}
                </p>
                {isLdapDirty && (
                  <p className="text-[10px] font-bold text-amber-600">
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
                    <i className="fa-solid fa-circle-notch fa-spin"></i>
                  ) : (
                    t('admin.ldap.testAuthentication')
                  )}
                </Button>
              </form>

              <div className="bg-zinc-900 rounded-xl p-4 font-mono text-xs overflow-y-auto min-h-64 border border-zinc-800 shadow-inner">
                {isTestingLdap ? (
                  <div className="text-zinc-400 animate-pulse">
                    {t('admin.ldap.test.connecting', 'Connecting to LDAP server...')}
                  </div>
                ) : testResult ? (
                  <div className="space-y-3">
                    <div
                      className={`font-bold ${testResult.authenticated ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      [
                      {testResult.authenticated
                        ? t('admin.ldap.test.success', 'SUCCESS')
                        : t('admin.ldap.test.failure', 'FAILURE')}
                      ] {testResult.message}
                    </div>
                    {testResult.authenticated && (
                      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-zinc-400">
                        <span>{t('admin.ldap.test.userDn', 'User DN')}</span>
                        <span className="text-zinc-200 break-all">{testResult.userDn || '-'}</span>
                        <span>{t('admin.ldap.test.roleIds', 'Mapped Roles')}</span>
                        <span className="text-zinc-200">
                          {testResult.roleIds.length ? testResult.roleIds.join(', ') : '-'}
                        </span>
                        <span>{t('admin.ldap.test.groupsFound', 'Groups Found:')}</span>
                        <span className="text-zinc-200">
                          {testResult.groups.length ? testResult.groups.join(', ') : '-'}
                        </span>
                      </div>
                    )}
                    <div className="border-t border-zinc-800 pt-3">
                      <div className="text-zinc-500 mb-2">
                        {t('admin.ldap.test.serverResponse', 'Server Response')}
                      </div>
                      <pre className="text-zinc-300 whitespace-pre-wrap break-words">
                        {JSON.stringify(testResult, null, 2)}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="text-zinc-600 italic">
                    {t('admin.ldap.test.waiting', 'Waiting for test execution...')}
                    <br />
                    <br />
                    <span className="opacity-50">
                      {t('admin.ldap.test.logOutput', 'Log output will appear here after testing.')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>
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
}) => (
  <div>
    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
      {label}
    </label>
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full px-4 py-2 bg-zinc-50 border rounded-lg focus:ring-2 outline-none text-sm ${monospace ? 'font-mono' : 'font-semibold text-zinc-700'} ${error ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-zinc-200 focus:ring-praetor'}`}
    />
    {error && <p className="text-red-500 text-[10px] font-bold mt-1">{error}</p>}
  </div>
);

type TextAreaProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

const TextArea: React.FC<TextAreaProps> = ({ label, value, onChange }) => (
  <div>
    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
      {label}
    </label>
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={5}
      className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-mono"
    />
  </div>
);

type ReadOnlyFieldProps = {
  label: string;
  value: string;
  monospace?: boolean;
};

const ReadOnlyField: React.FC<ReadOnlyFieldProps> = ({ label, value, monospace }) => (
  <div>
    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
      {label}
    </label>
    <input
      type="text"
      readOnly
      value={value}
      className={`w-full px-4 py-2 bg-zinc-100 border border-zinc-200 rounded-lg text-sm text-zinc-500 ${monospace ? 'font-mono' : 'font-semibold'}`}
    />
  </div>
);

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
  renderRoleSelect: (value: string, onChange: (value: string) => void) => React.ReactNode;
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
  renderRoleSelect,
}) => (
  <div>
    <div className="flex justify-between items-center mb-4">
      <h4 className="text-sm font-semibold text-zinc-800">{heading}</h4>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onAdd}
        className="text-xs font-bold"
      >
        <i className="fa-solid fa-plus"></i>
        {addLabel}
      </Button>
    </div>
    <div className="space-y-3">
      {mappings.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">{noMappingsLabel}</p>
      ) : (
        mappings.map((mapping, index) => (
          <div key={index} className="flex gap-4 items-start">
            <div className="flex-1">
              <input
                type="text"
                value={mapping.externalGroup}
                onChange={(event) => onChange(index, 'externalGroup', event.target.value)}
                placeholder={externalPlaceholder}
                className={`w-full px-3 py-2 bg-zinc-50 border rounded-lg text-sm font-mono focus:ring-2 outline-none ${errors[`${errorPrefix}${index}`] ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'focus:ring-praetor border-zinc-200'}`}
              />
              {errors[`${errorPrefix}${index}`] && (
                <p className="text-red-500 text-[10px] font-bold mt-1">
                  {errors[`${errorPrefix}${index}`]}
                </p>
              )}
            </div>
            <i className="fa-solid fa-arrow-right text-zinc-300 text-xs mt-3"></i>
            <div className="w-44">
              {renderRoleSelect(mapping.role || roleOptions[0]?.id || 'user', (role) =>
                onChange(index, 'role', role),
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onRemove(index)}
              className="text-muted-foreground hover:text-destructive"
            >
              <i className="fa-solid fa-trash-can"></i>
            </Button>
          </div>
        ))
      )}
    </div>
  </div>
);

export default AuthSettings;
