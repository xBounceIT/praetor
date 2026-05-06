import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiBase } from '../../services/api/client';
import type { LdapConfig, Role, SsoProtocol, SsoProvider, SsoRoleMapping } from '../../types';
import CustomSelect from '../shared/CustomSelect';
import Toggle from '../shared/Toggle';

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

const providerIcons: Record<SsoProtocol, string> = {
  oidc: 'fa-key',
  saml: 'fa-building-shield',
};

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
  const [isSaved, setIsSaved] = useState(false);
  const [savingProvider, setSavingProvider] = useState<SsoProtocol | null>(null);

  useEffect(() => {
    setLdapForm(config || DEFAULT_LDAP_CONFIG);
  }, [config]);

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

  const updateLdapMapping = (index: number, field: 'ldapGroup' | 'role', value: string) => {
    const roleMappings = [...ldapForm.roleMappings];
    roleMappings[index] = { ...roleMappings[index], [field]: value };
    setLdapForm({ ...ldapForm, roleMappings });
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
    await onSave(ldapForm);
    showSaved();
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

  const renderTabButton = (tab: 'ldap' | SsoProtocol, icon: string, label: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(tab)}
      className={`pb-4 text-sm font-bold transition-all relative ${activeTab === tab ? 'text-praetor' : 'text-slate-400 hover:text-slate-600'}`}
    >
      <i className={`fa-solid ${icon} mr-2`}></i>
      {label}
      {activeTab === tab && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
      )}
    </button>
  );

  const renderRoleSelect = (value: string, onChange: (value: string) => void) => (
    <CustomSelect options={roleOptions} value={value} onChange={(val) => onChange(val as string)} />
  );

  const renderProviderList = (protocol: SsoProtocol) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
        <i className={`fa-solid ${providerIcons[protocol]} text-praetor`}></i>
        <h3 className="font-bold text-slate-800">
          {protocol === 'oidc'
            ? t('admin.sso.oidcProviders', 'OpenID Connect Providers')
            : t('admin.sso.samlProviders', 'SAML Providers')}
        </h3>
      </div>
      <div className="divide-y divide-slate-100">
        {providersByProtocol[protocol].length === 0 ? (
          <p className="p-6 text-sm text-slate-400">
            {t('admin.sso.noProviders', 'No providers configured.')}
          </p>
        ) : (
          providersByProtocol[protocol].map((provider) => (
            <div key={provider.id} className="p-4 flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800">{provider.name}</span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${provider.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}
                  >
                    {provider.enabled
                      ? t('admin.sso.enabled', 'Enabled')
                      : t('admin.sso.disabled', 'Disabled')}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono">{provider.slug}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateProviderDraft(protocol, provider)}
                  className="text-slate-400 hover:text-praetor p-2"
                  title={t('admin.sso.editProvider', 'Edit provider')}
                >
                  <i className="fa-solid fa-pen"></i>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteSsoProvider(provider.id)}
                  className="text-slate-400 hover:text-red-500 p-2"
                  title={t('admin.sso.deleteProvider', 'Delete provider')}
                >
                  <i className="fa-solid fa-trash-can"></i>
                </button>
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
        className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
      >
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <i className={`fa-solid ${draft.id ? 'fa-pen' : 'fa-plus'} text-praetor`}></i>
            <h3 className="font-bold text-slate-800">
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
            <span className="text-sm font-medium text-slate-600">
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

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-between">
          <button
            type="button"
            onClick={() => updateProviderDraft(protocol, buildDefaultProvider(protocol))}
            className="text-sm font-bold text-slate-400 hover:text-slate-600"
          >
            {t('admin.sso.clearForm', 'Clear')}
          </button>
          <button
            type="submit"
            disabled={savingProvider === protocol}
            className="bg-praetor text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50"
          >
            {savingProvider === protocol ? (
              <i className="fa-solid fa-circle-notch fa-spin"></i>
            ) : (
              t('admin.sso.saveProvider', 'Save Provider')
            )}
          </button>
        </div>
      </form>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">{t('admin.title')}</h2>
          <p className="text-sm text-slate-500 mt-1">{t('admin.subtitle')}</p>
        </div>
        {isSaved && (
          <div className="bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-md animate-in fade-in slide-in-from-right-4 flex items-center gap-2">
            <i className="fa-solid fa-check"></i> {t('admin.ldap.changesSaved', 'Changes Saved')}
          </div>
        )}
      </div>

      <div className="flex border-b border-slate-200 gap-8">
        {renderTabButton('ldap', 'fa-folder-tree', t('admin.tabs.ldap', 'LDAP / Active Directory'))}
        {renderTabButton('oidc', 'fa-key', t('admin.tabs.oidc', 'OpenID Connect'))}
        {renderTabButton('saml', 'fa-building-shield', t('admin.tabs.saml', 'SAML'))}
      </div>

      {activeTab === 'ldap' && (
        <form onSubmit={handleSaveLdap} className="space-y-8">
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <i className="fa-solid fa-server text-praetor"></i>
                <h3 className="font-bold text-slate-800">{t('admin.ldap.serverConfig')}</h3>
              </div>
              <div className="flex items-center gap-3">
                <Toggle
                  checked={ldapForm.enabled}
                  onChange={(enabled) => setLdapForm({ ...ldapForm, enabled })}
                />
                <span className="text-sm font-medium text-slate-600">
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
                onChange={(serverUrl) => setLdapForm({ ...ldapForm, serverUrl })}
              />
              <Field
                label={t('admin.ldap.baseDnLabel')}
                value={ldapForm.baseDn}
                error={errors.baseDn}
                monospace
                onChange={(baseDn) => setLdapForm({ ...ldapForm, baseDn })}
              />
              <Field
                label={t('admin.ldap.userSearchFilter')}
                value={ldapForm.userFilter}
                error={errors.userFilter}
                monospace
                onChange={(userFilter) => setLdapForm({ ...ldapForm, userFilter })}
              />
              <Field
                label={t('admin.ldap.bindDnLabel')}
                value={ldapForm.bindDn}
                error={errors.bindCredentials}
                monospace
                onChange={(bindDn) => setLdapForm({ ...ldapForm, bindDn })}
              />
              <Field
                label={t('admin.ldap.bindPasswordLabel')}
                type="password"
                value={ldapForm.bindPassword}
                error={errors.bindCredentials}
                monospace
                onChange={(bindPassword) => setLdapForm({ ...ldapForm, bindPassword })}
              />
              <Field
                label={t('admin.ldap.groupSearchBase')}
                value={ldapForm.groupBaseDn}
                error={errors.groupBaseDn}
                monospace
                onChange={(groupBaseDn) => setLdapForm({ ...ldapForm, groupBaseDn })}
              />
              <Field
                label={t('admin.ldap.groupMemberFilter')}
                value={ldapForm.groupFilter}
                error={errors.groupFilter}
                monospace
                onChange={(groupFilter) => setLdapForm({ ...ldapForm, groupFilter })}
              />
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
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
                setLdapForm({
                  ...ldapForm,
                  roleMappings: [
                    ...ldapForm.roleMappings,
                    { ldapGroup: '', role: roleOptions[0]?.id || 'user' },
                  ],
                })
              }
              onRemove={(index) =>
                setLdapForm({
                  ...ldapForm,
                  roleMappings: ldapForm.roleMappings.filter((_, idx) => idx !== index),
                })
              }
              onChange={(index, field, value) =>
                updateLdapMapping(index, field === 'externalGroup' ? 'ldapGroup' : 'role', value)
              }
              renderRoleSelect={renderRoleSelect}
            />
          </section>

          <div className="flex justify-end">
            <button
              type="submit"
              className="bg-praetor text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-slate-200 hover:bg-slate-800 transition-all"
            >
              {t('admin.ldap.saveConfiguration', 'Save Configuration')}
            </button>
          </div>
        </form>
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
    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
      {label}
    </label>
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none text-sm ${monospace ? 'font-mono' : 'font-semibold text-slate-700'} ${error ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
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
    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
      {label}
    </label>
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={5}
      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-mono"
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
    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
      {label}
    </label>
    <input
      type="text"
      readOnly
      value={value}
      className={`w-full px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-500 ${monospace ? 'font-mono' : 'font-semibold'}`}
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
      <h4 className="text-sm font-bold text-slate-800">{heading}</h4>
      <button
        type="button"
        onClick={onAdd}
        className="text-xs bg-slate-100 text-praetor px-3 py-1.5 rounded-lg font-bold hover:bg-slate-200 transition-colors"
      >
        <i className="fa-solid fa-plus mr-1"></i> {addLabel}
      </button>
    </div>
    <div className="space-y-3">
      {mappings.length === 0 ? (
        <p className="text-xs text-slate-400 italic">{noMappingsLabel}</p>
      ) : (
        mappings.map((mapping, index) => (
          <div key={index} className="flex gap-4 items-start">
            <div className="flex-1">
              <input
                type="text"
                value={mapping.externalGroup}
                onChange={(event) => onChange(index, 'externalGroup', event.target.value)}
                placeholder={externalPlaceholder}
                className={`w-full px-3 py-2 bg-slate-50 border rounded-lg text-sm font-mono focus:ring-2 outline-none ${errors[`${errorPrefix}${index}`] ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'focus:ring-praetor border-slate-200'}`}
              />
              {errors[`${errorPrefix}${index}`] && (
                <p className="text-red-500 text-[10px] font-bold mt-1">
                  {errors[`${errorPrefix}${index}`]}
                </p>
              )}
            </div>
            <i className="fa-solid fa-arrow-right text-slate-300 text-xs mt-3"></i>
            <div className="w-44">
              {renderRoleSelect(mapping.role || roleOptions[0]?.id || 'user', (role) =>
                onChange(index, 'role', role),
              )}
            </div>
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="text-slate-400 hover:text-red-500 p-2"
            >
              <i className="fa-solid fa-trash-can"></i>
            </button>
          </div>
        ))
      )}
    </div>
  </div>
);

export default AuthSettings;
