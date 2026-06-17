import {
  ArrowRight,
  Building2,
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
import { useCallback, useEffect, useId, useMemo, useReducer, useRef } from 'react';
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
type AcsUrlState =
  | { status: 'loading' }
  | { status: 'ready'; template: string }
  | { status: 'error'; message: string };
type RoleOption = { id: string; name: string };

export interface AuthSettingsProps {
  config: LdapConfig;
  onSave: (config: LdapConfig) => void | Promise<void>;
  roles: Role[];
  ssoProviders: SsoProvider[];
  onSaveSsoProvider: (provider: Partial<SsoProvider>) => Promise<SsoProvider>;
  onDeleteSsoProvider: (id: string) => Promise<void>;
  // 2FA org policy (all persisted through the general-settings endpoint). `enableTotp` is the global
  // feature switch; `enforceTotp` the master enforcement switch; the role-id lists scope enforcement.
  enableTotp: boolean;
  onSetEnableTotp: (value: boolean) => void | Promise<void>;
  enforceTotp: boolean;
  onSetEnforceTotp: (value: boolean) => void | Promise<void>;
  enforcedRoleIds: string[];
  onSetEnforcedRoleIds: (value: string[]) => void | Promise<void>;
  exemptRoleIds: string[];
  onSetExemptRoleIds: (value: string[]) => void | Promise<void>;
  // The 2FA policy persists through the general-settings endpoint (administration.general.update).
  // The controls live on this auth page for discoverability, so we hide the MFA tab from users who
  // can view auth settings but lack general.update — otherwise they would see controls that 403 on
  // save. Visible iff usable.
  canManageMfa: boolean;
}

const DEFAULT_LDAP_CONFIG: LdapConfig = {
  enabled: false,
  serverUrl: 'ldap://ldap.example.com:389',
  baseDn: 'dc=example,dc=com',
  bindDn: 'cn=read-only-admin,dc=example,dc=com',
  bindPassword: '',
  userFilter: '(uid={0})',
  firstNameAttribute: 'givenName',
  lastNameAttribute: 'sn',
  emailAttribute: 'mail',
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
    <Building2 aria-hidden="true" className={className} />
  );

const AuthTabButton: React.FC<{
  tab: 'ldap' | 'mfa' | SsoProtocol;
  activeTab: 'ldap' | 'mfa' | SsoProtocol;
  icon: React.ReactNode;
  label: string;
  onSelect: (tab: 'ldap' | 'mfa' | SsoProtocol) => void;
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

type AuthSettingsTab = 'ldap' | 'mfa' | SsoProtocol;
type StateUpdate<T> = T | ((prev: T) => T);

type AuthSettingsState = {
  activeTab: AuthSettingsTab;
  ldapForm: LdapConfig;
  providerDrafts: Record<SsoProtocol, Partial<SsoProvider>>;
  replacingSecrets: Record<SsoProtocol, Partial<Record<SsoSecretFieldKey, boolean>>>;
  errors: Record<string, string>;
  testUsername: string;
  testPassword: string;
  testErrors: Record<string, string>;
  testResult: LdapTestResponse | null;
  isTestingLdap: boolean;
  isSaved: boolean;
  isSavingLdap: boolean;
  savingProvider: SsoProtocol | null;
  providerSaveErrors: Partial<Record<SsoProtocol, string>>;
  acsUrlState: AcsUrlState;
};

type AuthSettingsAction =
  | { type: 'setActiveTab'; update: StateUpdate<AuthSettingsState['activeTab']> }
  | { type: 'setLdapForm'; update: StateUpdate<AuthSettingsState['ldapForm']> }
  | { type: 'setProviderDrafts'; update: StateUpdate<AuthSettingsState['providerDrafts']> }
  | { type: 'setReplacingSecrets'; update: StateUpdate<AuthSettingsState['replacingSecrets']> }
  | { type: 'setErrors'; update: StateUpdate<AuthSettingsState['errors']> }
  | { type: 'setTestUsername'; update: StateUpdate<AuthSettingsState['testUsername']> }
  | { type: 'setTestPassword'; update: StateUpdate<AuthSettingsState['testPassword']> }
  | { type: 'setTestErrors'; update: StateUpdate<AuthSettingsState['testErrors']> }
  | { type: 'setTestResult'; update: StateUpdate<AuthSettingsState['testResult']> }
  | { type: 'setIsTestingLdap'; update: StateUpdate<AuthSettingsState['isTestingLdap']> }
  | { type: 'setIsSaved'; update: StateUpdate<AuthSettingsState['isSaved']> }
  | { type: 'setIsSavingLdap'; update: StateUpdate<AuthSettingsState['isSavingLdap']> }
  | { type: 'setSavingProvider'; update: StateUpdate<AuthSettingsState['savingProvider']> }
  | {
      type: 'setProviderSaveErrors';
      update: StateUpdate<AuthSettingsState['providerSaveErrors']>;
    }
  | { type: 'setAcsUrlState'; update: StateUpdate<AuthSettingsState['acsUrlState']> };

const resolveStateUpdate = <T,>(current: T, update: StateUpdate<T>): T =>
  typeof update === 'function' ? (update as (prev: T) => T)(current) : update;

const createAuthSettingsState = (): AuthSettingsState => ({
  activeTab: 'ldap',
  ldapForm: DEFAULT_LDAP_CONFIG,
  providerDrafts: {
    oidc: buildDefaultProvider('oidc'),
    saml: buildDefaultProvider('saml'),
  },
  replacingSecrets: { oidc: {}, saml: {} },
  errors: {},
  testUsername: '',
  testPassword: '',
  testErrors: {},
  testResult: null,
  isTestingLdap: false,
  isSaved: false,
  isSavingLdap: false,
  savingProvider: null,
  providerSaveErrors: {},
  acsUrlState: { status: 'loading' },
});

const authSettingsReducer = (
  state: AuthSettingsState,
  action: AuthSettingsAction,
): AuthSettingsState => {
  switch (action.type) {
    case 'setActiveTab':
      return { ...state, activeTab: resolveStateUpdate(state.activeTab, action.update) };
    case 'setLdapForm':
      return { ...state, ldapForm: resolveStateUpdate(state.ldapForm, action.update) };
    case 'setProviderDrafts':
      return {
        ...state,
        providerDrafts: resolveStateUpdate(state.providerDrafts, action.update),
      };
    case 'setReplacingSecrets':
      return {
        ...state,
        replacingSecrets: resolveStateUpdate(state.replacingSecrets, action.update),
      };
    case 'setErrors':
      return { ...state, errors: resolveStateUpdate(state.errors, action.update) };
    case 'setTestUsername':
      return { ...state, testUsername: resolveStateUpdate(state.testUsername, action.update) };
    case 'setTestPassword':
      return { ...state, testPassword: resolveStateUpdate(state.testPassword, action.update) };
    case 'setTestErrors':
      return { ...state, testErrors: resolveStateUpdate(state.testErrors, action.update) };
    case 'setTestResult':
      return { ...state, testResult: resolveStateUpdate(state.testResult, action.update) };
    case 'setIsTestingLdap':
      return { ...state, isTestingLdap: resolveStateUpdate(state.isTestingLdap, action.update) };
    case 'setIsSaved':
      return { ...state, isSaved: resolveStateUpdate(state.isSaved, action.update) };
    case 'setIsSavingLdap':
      return { ...state, isSavingLdap: resolveStateUpdate(state.isSavingLdap, action.update) };
    case 'setSavingProvider':
      return { ...state, savingProvider: resolveStateUpdate(state.savingProvider, action.update) };
    case 'setProviderSaveErrors':
      return {
        ...state,
        providerSaveErrors: resolveStateUpdate(state.providerSaveErrors, action.update),
      };
    case 'setAcsUrlState':
      return { ...state, acsUrlState: resolveStateUpdate(state.acsUrlState, action.update) };
  }
};

const useAuthSettingsController = ({
  config,
  onSave,
  roles,
  ssoProviders,
  onSaveSsoProvider,
  onDeleteSsoProvider,
  enableTotp,
  onSetEnableTotp,
  enforceTotp,
  onSetEnforceTotp,
  enforcedRoleIds,
  onSetEnforcedRoleIds,
  exemptRoleIds,
  onSetExemptRoleIds,
  canManageMfa,
}: AuthSettingsProps) => {
  const { t } = useTranslation('auth');
  const [authState, dispatchAuthState] = useReducer(
    authSettingsReducer,
    undefined,
    createAuthSettingsState,
  );
  const {
    activeTab,
    ldapForm,
    providerDrafts,
    replacingSecrets,
    errors,
    testUsername,
    testPassword,
    testErrors,
    testResult,
    isTestingLdap,
    isSaved,
    isSavingLdap,
    savingProvider,
    providerSaveErrors,
    acsUrlState,
  } = authState;
  const setActiveTab = useCallback(
    (update: StateUpdate<AuthSettingsState['activeTab']>) =>
      dispatchAuthState({ type: 'setActiveTab', update }),
    [],
  );
  const setLdapForm = useCallback(
    (update: StateUpdate<AuthSettingsState['ldapForm']>) =>
      dispatchAuthState({ type: 'setLdapForm', update }),
    [],
  );
  const setProviderDrafts = useCallback(
    (update: StateUpdate<AuthSettingsState['providerDrafts']>) =>
      dispatchAuthState({ type: 'setProviderDrafts', update }),
    [],
  );
  const setReplacingSecrets = useCallback(
    (update: StateUpdate<AuthSettingsState['replacingSecrets']>) =>
      dispatchAuthState({ type: 'setReplacingSecrets', update }),
    [],
  );
  const setErrors = useCallback(
    (update: StateUpdate<AuthSettingsState['errors']>) =>
      dispatchAuthState({ type: 'setErrors', update }),
    [],
  );
  const setTestUsername = useCallback(
    (update: StateUpdate<AuthSettingsState['testUsername']>) =>
      dispatchAuthState({ type: 'setTestUsername', update }),
    [],
  );
  const setTestPassword = useCallback(
    (update: StateUpdate<AuthSettingsState['testPassword']>) =>
      dispatchAuthState({ type: 'setTestPassword', update }),
    [],
  );
  const setTestErrors = useCallback(
    (update: StateUpdate<AuthSettingsState['testErrors']>) =>
      dispatchAuthState({ type: 'setTestErrors', update }),
    [],
  );
  const setTestResult = useCallback(
    (update: StateUpdate<AuthSettingsState['testResult']>) =>
      dispatchAuthState({ type: 'setTestResult', update }),
    [],
  );
  const setIsTestingLdap = useCallback(
    (update: StateUpdate<AuthSettingsState['isTestingLdap']>) =>
      dispatchAuthState({ type: 'setIsTestingLdap', update }),
    [],
  );
  const setIsSaved = useCallback(
    (update: StateUpdate<AuthSettingsState['isSaved']>) =>
      dispatchAuthState({ type: 'setIsSaved', update }),
    [],
  );
  const setIsSavingLdap = useCallback(
    (update: StateUpdate<AuthSettingsState['isSavingLdap']>) =>
      dispatchAuthState({ type: 'setIsSavingLdap', update }),
    [],
  );
  const setSavingProvider = useCallback(
    (update: StateUpdate<AuthSettingsState['savingProvider']>) =>
      dispatchAuthState({ type: 'setSavingProvider', update }),
    [],
  );
  const setProviderSaveErrors = useCallback(
    (update: StateUpdate<AuthSettingsState['providerSaveErrors']>) =>
      dispatchAuthState({ type: 'setProviderSaveErrors', update }),
    [],
  );
  const setAcsUrlState = useCallback(
    (update: StateUpdate<AuthSettingsState['acsUrlState']>) =>
      dispatchAuthState({ type: 'setAcsUrlState', update }),
    [],
  );
  const loadedLdapConfigRef = useRef<LdapConfig | null | undefined>(null);
  const hasLoadedLdapConfigRef = useRef(false);
  const bindPasswordReplace = useSecretReplaceState(
    ldapForm.bindPassword,
    (bindPassword) => setLdapForm((prev) => ({ ...prev, bindPassword })),
    config,
  );
  const tlsCaFileInputRef = useRef<HTMLInputElement>(null);

  if (!hasLoadedLdapConfigRef.current || loadedLdapConfigRef.current !== config) {
    hasLoadedLdapConfigRef.current = true;
    loadedLdapConfigRef.current = config;
    setLdapForm(config || DEFAULT_LDAP_CONFIG);
  }

  const handleActiveTabSelect = (tab: 'ldap' | 'mfa' | SsoProtocol) => {
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
  }, [activeTab, acsUrlState.status, setAcsUrlState]);

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

  return {
    acsUrlState,
    activeTab,
    bindPasswordReplace,
    canManageMfa,
    enableTotp,
    enforceTotp,
    enforcedRoleIds,
    errors,
    exemptRoleIds,
    handleActiveTabSelect,
    handleSaveLdap,
    handleSaveProvider,
    handleTestLdap,
    handleTlsCaFileImport,
    isLdapDirty,
    isSaved,
    isSavingLdap,
    isTestingLdap,
    ldapForm,
    loadProviderDraft,
    onDeleteSsoProvider,
    onSetEnableTotp,
    onSetEnforceTotp,
    onSetEnforcedRoleIds,
    onSetExemptRoleIds,
    providerDrafts,
    providerSaveErrors,
    providersByProtocol,
    replacingSecrets,
    roleOptions,
    savingProvider,
    setErrors,
    setLdapForm,
    setTestErrors,
    setTestPassword,
    setTestUsername,
    startReplaceSecret,
    cancelReplaceSecret,
    t,
    testErrors,
    testPassword,
    testResult,
    testUsername,
    tlsCaFileInputRef,
    updateLdapMapping,
    updateProviderDraft,
    updateProviderMapping,
  };
};

type AuthSettingsController = ReturnType<typeof useAuthSettingsController>;

const AuthSettings: React.FC<AuthSettingsProps> = (props) => {
  const controller = useAuthSettingsController(props);
  return <AuthSettingsLayout controller={controller} />;
};

const AuthSettingsLayout: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
    <AuthSettingsHeader controller={controller} />
    <AuthSettingsTabs controller={controller} />
    <AuthSettingsPanel controller={controller} />
  </div>
);

const AuthSettingsHeader: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <div className="flex justify-between items-center">
    <div>
      <h2 className="text-2xl font-semibold text-foreground">{controller.t('admin.title')}</h2>
      <p className="text-sm text-muted-foreground mt-1">{controller.t('admin.subtitle')}</p>
    </div>
    {controller.isSaved && (
      <div className="bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-md animate-in fade-in slide-in-from-right-4 flex items-center gap-2">
        <Check aria-hidden="true" className="size-4" />{' '}
        {controller.t('admin.ldap.changesSaved', 'Changes Saved')}
      </div>
    )}
  </div>
);

const AuthSettingsTabs: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <div className="flex border-b border-border gap-8">
    <AuthTabButton
      tab="ldap"
      activeTab={controller.activeTab}
      icon={<FolderTree aria-hidden="true" className="size-4" />}
      label={controller.t('admin.tabs.ldap', 'LDAP / Active Directory')}
      onSelect={controller.handleActiveTabSelect}
    />
    <AuthTabButton
      tab="oidc"
      activeTab={controller.activeTab}
      icon={<OpenIdIcon className="size-4" />}
      label={controller.t('admin.tabs.oidc', 'OpenID Connect')}
      onSelect={controller.handleActiveTabSelect}
    />
    <AuthTabButton
      tab="saml"
      activeTab={controller.activeTab}
      icon={<Building2 aria-hidden="true" className="size-4" />}
      label={controller.t('admin.tabs.saml', 'SAML')}
      onSelect={controller.handleActiveTabSelect}
    />
    {controller.canManageMfa && (
      <AuthTabButton
        tab="mfa"
        activeTab={controller.activeTab}
        icon={<ShieldCheck aria-hidden="true" className="size-4" />}
        label={controller.t('admin.tabs.mfa', 'Multi-Factor Auth')}
        onSelect={controller.handleActiveTabSelect}
      />
    )}
  </div>
);

const AuthSettingsPanel: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => {
  if (controller.activeTab === 'mfa' && controller.canManageMfa) {
    return <MfaPolicyPanel controller={controller} />;
  }
  if (controller.activeTab === 'ldap') return <LdapSettingsPanel controller={controller} />;
  if (controller.activeTab === 'oidc' || controller.activeTab === 'saml') {
    return <SsoSettingsPanel controller={controller} protocol={controller.activeTab} />;
  }
  return null;
};

const MfaPolicyPanel: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <div className="space-y-8">
    <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
      <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <ShieldCheck aria-hidden="true" className="size-4 text-praetor" />
          {controller.t('mfa.enable.label', 'Enable two-factor authentication')}
        </CardTitle>
        <CardDescription>
          {controller.t(
            'mfa.enable.description',
            'Allow users with local or LDAP credentials to secure their account with an authenticator app. When off, 2FA is unavailable org-wide and no one is challenged at sign-in.',
          )}
        </CardDescription>
        <CardAction>
          <Switch
            id="enable-totp"
            checked={controller.enableTotp}
            onCheckedChange={controller.onSetEnableTotp}
            aria-label={controller.t('mfa.enable.label', 'Enable two-factor authentication')}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="p-6">
        <p className="text-xs text-muted-foreground">
          {controller.t(
            'mfa.ssoNote',
            'Users signing in through SSO (OIDC or SAML) are governed by their identity provider and are never subject to Praetor 2FA.',
          )}
        </p>
      </CardContent>
    </Card>
    <MfaEnforcementCard controller={controller} />
  </div>
);

const MfaEnforcementCard: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
    <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
      <CardTitle className="flex items-center gap-3 text-base">
        <ShieldCheck aria-hidden="true" className="size-4 text-praetor" />
        {controller.t('mfa.enforce.label', 'Enforce two-factor authentication')}
      </CardTitle>
      <CardDescription>
        {controller.t(
          'mfa.enforce.description',
          'Require enrolled 2FA for the selected roles. Affected users without 2FA are guided through setup at their next sign-in.',
        )}
      </CardDescription>
      <CardAction>
        <Switch
          id="enforce-totp"
          checked={controller.enforceTotp}
          disabled={!controller.enableTotp}
          onCheckedChange={controller.onSetEnforceTotp}
          aria-label={controller.t('mfa.enforce.label', 'Enforce two-factor authentication')}
        />
      </CardAction>
    </CardHeader>
    <CardContent className="space-y-6 p-6">
      <MfaRoleSelect
        controller={controller}
        id="totp-enforced-roles"
        label={controller.t('mfa.enforcedRoles.label', 'Enforce 2FA for these roles')}
        description={controller.t(
          'mfa.enforcedRoles.description',
          'Users holding any selected role must use 2FA. Leave empty to require it for everyone (local/LDAP).',
        )}
        value={controller.enforcedRoleIds}
        placeholder={controller.t('mfa.enforcedRoles.placeholder', 'Everyone (local/LDAP)')}
        onChange={controller.onSetEnforcedRoleIds}
      />
      <MfaRoleSelect
        controller={controller}
        id="totp-exempt-roles"
        label={controller.t('mfa.exemptRoles.label', 'Exempt these roles from 2FA')}
        description={controller.t(
          'mfa.exemptRoles.description',
          'Users holding any selected role are never required to use 2FA, even if another of their roles is enforced.',
        )}
        value={controller.exemptRoleIds}
        placeholder={controller.t('mfa.exemptRoles.placeholder', 'No exemptions')}
        onChange={controller.onSetExemptRoleIds}
      />
    </CardContent>
  </Card>
);

const MfaRoleSelect: React.FC<{
  controller: AuthSettingsController;
  id: string;
  label: string;
  description: string;
  value: string[];
  placeholder: string;
  onChange: (value: string[]) => void | Promise<void>;
}> = ({ controller, id, label, description, value, placeholder, onChange }) => (
  <UIField>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <FieldDescription>{description}</FieldDescription>
    <SelectControl
      id={id}
      isMulti
      searchable
      disabled={!controller.enableTotp || !controller.enforceTotp}
      options={controller.roleOptions}
      value={value}
      onChange={(nextValue) => onChange(Array.isArray(nextValue) ? nextValue : [nextValue])}
      placeholder={placeholder}
    />
  </UIField>
);

const LdapSettingsPanel: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <div className="space-y-8">
    <form onSubmit={controller.handleSaveLdap} className="space-y-8">
      <LdapServerCard controller={controller} />
      <LdapTlsCard controller={controller} />
      {controller.errors.general && (
        <div
          role="alert"
          className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive"
        >
          {controller.errors.general}
        </div>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="lg"
          disabled={controller.isSavingLdap || !controller.isLdapDirty}
        >
          <Save aria-hidden="true" />
          {controller.t('admin.ldap.saveConfiguration', 'Save Configuration')}
        </Button>
      </div>
    </form>
    <LdapTesterCard controller={controller} />
  </div>
);

const LdapServerCard: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
    <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
      <CardTitle className="flex items-center gap-3 text-base">
        <Server aria-hidden="true" className="size-4 text-praetor" />
        {controller.t('admin.ldap.serverConfig')}
      </CardTitle>
      <CardDescription>
        {controller.t(
          'admin.ldap.serverConfigDescription',
          'Connect Praetor to your LDAP or Active Directory to authenticate users.',
        )}
      </CardDescription>
      <CardAction>
        <UIField className="flex-row items-center gap-2">
          <Switch
            id="ldap-enabled"
            checked={controller.ldapForm.enabled}
            onCheckedChange={(enabled) => controller.setLdapForm((prev) => ({ ...prev, enabled }))}
          />
          <FieldLabel htmlFor="ldap-enabled">{controller.t('admin.ldap.enabled')}</FieldLabel>
        </UIField>
      </CardAction>
    </CardHeader>
    <LdapConnectionFields controller={controller} />
    <LdapAttributeMapping controller={controller} />
    <LdapProvisioningSettings controller={controller} />
    <LdapRoleMappings controller={controller} />
  </Card>
);

const LdapConnectionFields: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
    <Field
      label={controller.t('admin.ldap.serverUrlLabel')}
      value={controller.ldapForm.serverUrl}
      error={controller.errors.serverUrl}
      monospace
      required={controller.ldapForm.enabled}
      onChange={(serverUrl) => controller.setLdapForm((prev) => ({ ...prev, serverUrl }))}
    />
    <Field
      label={controller.t('admin.ldap.baseDnLabel')}
      value={controller.ldapForm.baseDn}
      error={controller.errors.baseDn}
      monospace
      required={controller.ldapForm.enabled}
      onChange={(baseDn) => controller.setLdapForm((prev) => ({ ...prev, baseDn }))}
    />
    <Field
      label={controller.t('admin.ldap.userSearchFilter')}
      value={controller.ldapForm.userFilter}
      error={controller.errors.userFilter}
      monospace
      required={controller.ldapForm.enabled}
      onChange={(userFilter) => controller.setLdapForm((prev) => ({ ...prev, userFilter }))}
    />
    <Field
      label={controller.t('admin.ldap.bindDnLabel')}
      value={controller.ldapForm.bindDn}
      error={controller.errors.bindCredentials}
      monospace
      onChange={(bindDn) => controller.setLdapForm((prev) => ({ ...prev, bindDn }))}
    />
    <SecretField
      {...controller.bindPasswordReplace}
      label={controller.t('admin.ldap.bindPasswordLabel')}
      value={controller.ldapForm.bindPassword}
      monospace
      onChange={(bindPassword) => controller.setLdapForm((prev) => ({ ...prev, bindPassword }))}
      storedLabel={controller.t('admin.ldap.bindPasswordStored', 'Bind password stored')}
      storedHelp={controller.t(
        'admin.ldap.bindPasswordStoredHelp',
        'Leave as-is to keep the stored password, or click Replace to overwrite it.',
      )}
      error={controller.errors.bindCredentials}
      testId="ldap-bind-password"
    />
    <Field
      label={controller.t('admin.ldap.groupSearchBase')}
      value={controller.ldapForm.groupBaseDn}
      error={controller.errors.groupBaseDn}
      monospace
      required={controller.ldapForm.enabled}
      onChange={(groupBaseDn) => controller.setLdapForm((prev) => ({ ...prev, groupBaseDn }))}
    />
    <Field
      label={controller.t('admin.ldap.groupMemberFilter')}
      value={controller.ldapForm.groupFilter}
      error={controller.errors.groupFilter}
      monospace
      required={controller.ldapForm.enabled}
      onChange={(groupFilter) => controller.setLdapForm((prev) => ({ ...prev, groupFilter }))}
    />
  </CardContent>
);

const LdapAttributeMapping: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <fieldset className="border-t border-border p-6 space-y-4">
    <legend className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
      {controller.t('admin.ldap.attributeMapping.heading', 'Attribute Mapping')}
    </legend>
    <FieldDescription>
      {controller.t(
        'admin.ldap.attributeMapping.description',
        'Directory attributes used to populate each user’s name and email. Leave blank to use the defaults (givenName, sn, mail).',
      )}
    </FieldDescription>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Field
        label={controller.t('admin.ldap.attributeMapping.firstNameLabel', 'First Name Attribute')}
        value={controller.ldapForm.firstNameAttribute}
        monospace
        onChange={(firstNameAttribute) =>
          controller.setLdapForm((prev) => ({ ...prev, firstNameAttribute }))
        }
      />
      <Field
        label={controller.t('admin.ldap.attributeMapping.lastNameLabel', 'Surname Attribute')}
        value={controller.ldapForm.lastNameAttribute}
        monospace
        onChange={(lastNameAttribute) =>
          controller.setLdapForm((prev) => ({ ...prev, lastNameAttribute }))
        }
      />
      <Field
        label={controller.t('admin.ldap.attributeMapping.emailLabel', 'Email Attribute')}
        value={controller.ldapForm.emailAttribute}
        monospace
        onChange={(emailAttribute) =>
          controller.setLdapForm((prev) => ({ ...prev, emailAttribute }))
        }
      />
    </div>
  </fieldset>
);

const LdapProvisioningSettings: React.FC<{ controller: AuthSettingsController }> = ({
  controller,
}) => (
  <fieldset className="border-t border-border p-6 space-y-4">
    <legend className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
      {controller.t('admin.ldap.provisioning.heading', 'User Provisioning')}
    </legend>
    <LdapProvisioningSwitch
      controller={controller}
      id="ldap-provision-on-login"
      checked={controller.ldapForm.provisionOnLogin}
      onChange={(provisionOnLogin) =>
        controller.setLdapForm((prev) => ({ ...prev, provisionOnLogin }))
      }
      label={controller.t('admin.ldap.provisioning.onLoginLabel', 'Provision on first login')}
      description={controller.t(
        'admin.ldap.provisioning.onLoginHelp',
        'When on, any LDAP user that authenticates successfully gets a local account created on first sign-in. Turn off to restrict logins to users that already have a local account (created manually or via sync).',
      )}
    />
    <LdapProvisioningSwitch
      controller={controller}
      id="ldap-auto-provision-all"
      checked={controller.ldapForm.autoProvisionAll}
      onChange={(autoProvisionAll) =>
        controller.setLdapForm((prev) => ({ ...prev, autoProvisionAll }))
      }
      label={controller.t('admin.ldap.provisioning.autoAllLabel', 'Bulk-provision during sync')}
      description={controller.t(
        'admin.ldap.provisioning.autoAllHelp',
        'When on, the periodic sync creates a local account for every LDAP entry that matches the user filter, applying group role mappings at creation. When off, sync only refreshes display names of users that already exist. Either way, role mappings are never re-applied to users that already exist in Praetor.',
      )}
    />
  </fieldset>
);

const LdapProvisioningSwitch: React.FC<{
  controller: AuthSettingsController;
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}> = ({ id, checked, onChange, label, description }) => (
  <div className="flex items-start gap-3">
    <Switch id={id} checked={checked} onCheckedChange={onChange} />
    <div className="flex flex-1 flex-col gap-1.5">
      <FieldLabel htmlFor={id} className="cursor-pointer">
        {label}
      </FieldLabel>
      <FieldDescription>{description}</FieldDescription>
    </div>
  </div>
);

const LdapRoleMappings: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <div className="border-t border-border p-6">
    <RoleMappings
      mappings={controller.ldapForm.roleMappings.map((mapping) => ({
        externalGroup: mapping.ldapGroup,
        role: mapping.role,
      }))}
      roleOptions={controller.roleOptions}
      errors={controller.errors}
      errorPrefix="ldapRoleMapping_"
      heading={controller.t('admin.ldap.roleMappings')}
      addLabel={controller.t('admin.ldap.addMapping')}
      noMappingsLabel={controller.t('admin.ldap.noMappingsConfigured')}
      externalPlaceholder={controller.t('admin.ldap.ldapGroupPlaceholder', 'LDAP Group CN')}
      onAdd={() =>
        controller.setLdapForm((prev) => ({
          ...prev,
          roleMappings: [
            ...controller.ldapForm.roleMappings,
            { ldapGroup: '', role: controller.roleOptions[0]?.id || 'user' },
          ],
        }))
      }
      onRemove={(index) =>
        controller.setLdapForm((prev) => ({
          ...prev,
          roleMappings: controller.ldapForm.roleMappings.filter((_, idx) => idx !== index),
        }))
      }
      onChange={(index, field, value) =>
        controller.updateLdapMapping(index, field === 'externalGroup' ? 'ldapGroup' : 'role', value)
      }
    />
  </div>
);

const LdapTlsCard: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
    <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
      <CardTitle className="flex items-center gap-3 text-base">
        <Lock aria-hidden="true" className="size-4 text-praetor" />
        {controller.t('admin.ldap.tls.title', 'TLS / Certificates')}
      </CardTitle>
      <CardDescription>
        {controller.t(
          'admin.ldap.tls.description',
          "Verify the LDAP server's certificate when connecting over ldaps://.",
        )}
      </CardDescription>
    </CardHeader>
    <CardContent className="p-6">
      <UIField>
        <FieldLabel htmlFor="ldap-tls-ca-textarea">
          {controller.t('admin.ldap.tls.caCertificateLabel', 'Custom CA Certificate (Optional)')}
        </FieldLabel>
        <FieldDescription>
          {controller.t(
            'admin.ldap.tls.caCertificateHelp',
            'Paste a PEM-encoded CA certificate or chain used to verify the LDAP server when using ldaps://. Required only if the server uses a certificate not signed by a publicly trusted CA.',
          )}
        </FieldDescription>
        <LdapTlsTextarea controller={controller} />
      </UIField>
    </CardContent>
  </Card>
);

const LdapTlsTextarea: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <>
    <Textarea
      id="ldap-tls-ca-textarea"
      rows={8}
      value={controller.ldapForm.tlsCaCertificate}
      onChange={(event) => {
        controller.setLdapForm((prev) => ({ ...prev, tlsCaCertificate: event.target.value }));
        if (controller.errors.tlsCaCertificate) {
          controller.setErrors((prev) => ({ ...prev, tlsCaCertificate: '' }));
        }
      }}
      placeholder={`${PEM_BEGIN_MARKER}\nMIIDdzCCAl+gAwIBAgI...\n${PEM_END_MARKER}`}
      aria-label={controller.t(
        'admin.ldap.tls.caCertificateLabel',
        'Custom CA Certificate (Optional)',
      )}
      aria-invalid={!!controller.errors.tlsCaCertificate}
      className="font-mono text-xs leading-relaxed"
      spellCheck={false}
    />
    {controller.errors.tlsCaCertificate && (
      <FieldError errors={[{ message: controller.errors.tlsCaCertificate }]} />
    )}
    <div className="flex items-center gap-3 flex-wrap">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => controller.tlsCaFileInputRef.current?.click()}
        className="text-xs font-bold"
      >
        <FileUp aria-hidden="true" />
        {controller.t('admin.ldap.tls.importPemFile', 'Import .pem file')}
      </Button>
      {controller.ldapForm.tlsCaCertificate.trim() !== '' && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            controller.setLdapForm((prev) => ({ ...prev, tlsCaCertificate: '' }));
            if (controller.errors.tlsCaCertificate) {
              controller.setErrors((prev) => ({ ...prev, tlsCaCertificate: '' }));
            }
          }}
          className="text-xs font-bold text-muted-foreground hover:text-destructive"
        >
          <Trash2 aria-hidden="true" />
          {controller.t('admin.ldap.tls.clear', 'Clear')}
        </Button>
      )}
      <span className="text-[10px] text-muted-foreground italic">
        {controller.t(
          'admin.ldap.tls.caClearedHint',
          'Leave blank to use the system trust store (or LDAP_TLS_CA_FILE env var if set).',
        )}
      </span>
    </div>
    <input
      ref={controller.tlsCaFileInputRef}
      type="file"
      accept=".pem,.crt,.cer,.cert"
      onChange={controller.handleTlsCaFileImport}
      aria-label={controller.t('admin.ldap.tls.importPemFile', 'Import .pem file')}
      className="hidden"
    />
  </>
);

const LdapTesterCard: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
    <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
      <CardTitle className="flex items-center gap-3 text-base">
        <FlaskConical aria-hidden="true" className="size-4 text-praetor" />
        {controller.t('admin.ldap.connectionTester')}
      </CardTitle>
      <CardDescription>
        {controller.t(
          'admin.ldap.testDescription',
          'Enter credentials to test authentication and group retrieval against the saved configuration.',
        )}
      </CardDescription>
    </CardHeader>
    <CardContent className="p-6 grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-8">
      <LdapTesterForm controller={controller} />
      <LdapTesterOutput controller={controller} />
    </CardContent>
  </Card>
);

const LdapTesterForm: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <form onSubmit={controller.handleTestLdap} className="space-y-4">
    {controller.isLdapDirty && (
      <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
        {controller.t(
          'admin.ldap.test.unsavedChanges',
          'Save the LDAP configuration before testing recent changes.',
        )}
      </p>
    )}
    <Field
      label={controller.t('admin.ldap.testUsername')}
      value={controller.testUsername}
      error={controller.testErrors.testUsername}
      required
      onChange={(value) => {
        controller.setTestUsername(value);
        if (controller.testErrors.testUsername) {
          controller.setTestErrors((prev) => ({ ...prev, testUsername: '' }));
        }
      }}
    />
    <Field
      label={controller.t('admin.ldap.testPassword')}
      value={controller.testPassword}
      type="password"
      error={controller.testErrors.testPassword}
      required
      onChange={(value) => {
        controller.setTestPassword(value);
        if (controller.testErrors.testPassword) {
          controller.setTestErrors((prev) => ({ ...prev, testPassword: '' }));
        }
      }}
    />
    <Button type="submit" size="lg" className="w-full" disabled={controller.isTestingLdap}>
      {controller.isTestingLdap ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : (
        controller.t('admin.ldap.testAuthentication')
      )}
    </Button>
  </form>
);

const LdapTesterOutput: React.FC<{ controller: AuthSettingsController }> = ({ controller }) => (
  <div className="min-h-64 overflow-y-auto rounded-md border border-border bg-muted/40 p-4 font-mono text-xs">
    {controller.isTestingLdap ? (
      <div className="text-muted-foreground animate-pulse">
        {controller.t('admin.ldap.test.connecting', 'Connecting to LDAP server...')}
      </div>
    ) : controller.testResult ? (
      <LdapTestResult controller={controller} result={controller.testResult} />
    ) : (
      <div className="text-muted-foreground italic">
        {controller.t('admin.ldap.test.waiting', 'Waiting for test execution...')}
        <br />
        <br />
        <span className="opacity-70">
          {controller.t('admin.ldap.test.logOutput', 'Log output will appear here after testing.')}
        </span>
      </div>
    )}
  </div>
);

const LdapTestResult: React.FC<{
  controller: AuthSettingsController;
  result: LdapTestResponse;
}> = ({ controller, result }) => (
  <div className="space-y-3">
    <div
      className={cn(
        'font-bold',
        result.authenticated ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
      )}
    >
      [
      {result.authenticated
        ? controller.t('admin.ldap.test.success', 'SUCCESS')
        : controller.t('admin.ldap.test.failure', 'FAILURE')}
      ] {result.message}
    </div>
    {result.authenticated && <LdapAuthenticatedResult controller={controller} result={result} />}
    <div className="border-t border-border pt-3">
      <div className="text-muted-foreground mb-2">
        {controller.t('admin.ldap.test.serverResponse', 'Server Response')}
      </div>
      <pre className="text-foreground/80 whitespace-pre-wrap break-words">
        {JSON.stringify(result, null, 2)}
      </pre>
    </div>
  </div>
);

const LdapAuthenticatedResult: React.FC<{
  controller: AuthSettingsController;
  result: LdapTestResponse;
}> = ({ controller, result }) => {
  const helpKey = LDAP_ROLE_RESOLUTION_HELP_KEYS[result.roleResolution];
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-muted-foreground">
      <span>{controller.t('admin.ldap.test.userDn', 'User DN')}</span>
      <span className="text-foreground break-all">{result.userDn || '-'}</span>
      <span>{controller.t('admin.ldap.test.resolvedName', 'Name')}</span>
      <span className="text-foreground break-all">
        {[result.firstName, result.lastName].filter(Boolean).join(' ') || '-'}
      </span>
      <span>{controller.t('admin.ldap.test.resolvedEmail', 'Email')}</span>
      <span className="text-foreground break-all">{result.email || '-'}</span>
      <span>{controller.t(LDAP_ROLE_RESOLUTION_LABEL_KEYS[result.roleResolution])}</span>
      <span className="text-foreground">
        {result.roleIds.length ? result.roleIds.join(', ') : '-'}
      </span>
      {helpKey && (
        <span
          className="col-span-2 text-xs text-muted-foreground"
          data-testid="ldap-test-role-resolution-help"
        >
          {controller.t(helpKey)}
        </span>
      )}
      <span>{controller.t('admin.ldap.test.groupsFound', 'Groups Found:')}</span>
      <span className="text-foreground">
        {result.groups.length ? result.groups.join(', ') : '-'}
      </span>
    </div>
  );
};

const SsoSettingsPanel: React.FC<{
  controller: AuthSettingsController;
  protocol: SsoProtocol;
}> = ({ controller, protocol }) => (
  <div className="space-y-8">
    <SsoProviderList
      protocol={protocol}
      providers={controller.providersByProtocol[protocol]}
      onEdit={(provider) => controller.loadProviderDraft(protocol, provider)}
      onDelete={controller.onDeleteSsoProvider}
    />
    <SsoProviderForm
      protocol={protocol}
      draft={controller.providerDrafts[protocol]}
      errors={controller.errors}
      roleOptions={controller.roleOptions}
      replacingSecrets={controller.replacingSecrets[protocol]}
      saveError={controller.providerSaveErrors[protocol]}
      saving={controller.savingProvider === protocol}
      acsUrlState={controller.acsUrlState}
      onSubmit={(event) => controller.handleSaveProvider(protocol, event)}
      onDraftChange={(updates) => controller.updateProviderDraft(protocol, updates)}
      onStartReplace={(field) => controller.startReplaceSecret(protocol, field)}
      onCancelReplace={(field) => controller.cancelReplaceSecret(protocol, field)}
      onMappingChange={(index, field, value) =>
        controller.updateProviderMapping(protocol, index, field, value)
      }
      onClear={() => controller.loadProviderDraft(protocol, buildDefaultProvider(protocol))}
    />
  </div>
);

interface SsoProviderListProps {
  protocol: SsoProtocol;
  providers: SsoProvider[];
  onEdit: (provider: SsoProvider) => void;
  onDelete: (id: string) => void | Promise<void>;
}

const SsoProviderList: React.FC<SsoProviderListProps> = ({
  protocol,
  providers,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation('auth');

  return (
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
          {providers.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t('admin.sso.noProviders', 'No providers configured.')}
            </p>
          ) : (
            providers.map((provider) => (
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
                    onClick={() => onEdit(provider)}
                    className="text-muted-foreground hover:text-primary"
                    title={t('admin.sso.editProvider', 'Edit provider')}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDelete(provider.id)}
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
};

interface SsoProviderFormProps {
  protocol: SsoProtocol;
  draft: Partial<SsoProvider>;
  errors: Record<string, string>;
  roleOptions: RoleOption[];
  replacingSecrets: Partial<Record<SsoSecretFieldKey, boolean>>;
  saveError?: string;
  saving: boolean;
  acsUrlState: AcsUrlState;
  onSubmit: (event: React.FormEvent) => void;
  onDraftChange: (updates: Partial<SsoProvider>) => void;
  onStartReplace: (field: SsoSecretFieldKey) => void;
  onCancelReplace: (field: SsoSecretFieldKey) => void;
  onMappingChange: (
    index: number,
    field: keyof Pick<SsoRoleMapping, 'externalGroup' | 'role'>,
    value: string,
  ) => void;
  onClear: () => void;
}

const SsoProviderForm: React.FC<SsoProviderFormProps> = ({
  protocol,
  draft,
  errors,
  roleOptions,
  replacingSecrets,
  saveError,
  saving,
  acsUrlState,
  onSubmit,
  onDraftChange,
  onStartReplace,
  onCancelReplace,
  onMappingChange,
  onClear,
}) => {
  const { t } = useTranslation('auth');
  const prefix = `${protocol}_`;

  return (
    <form onSubmit={onSubmit}>
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
                onCheckedChange={(enabled) => onDraftChange({ enabled })}
              />
              <FieldLabel htmlFor={`provider-enabled-${protocol}`}>
                {t('admin.sso.enabled', 'Enabled')}
              </FieldLabel>
            </UIField>
          </CardAction>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {saveError && (
            <Alert variant="destructive" className="border-destructive/30">
              <CircleAlert />
              <AlertTitle>
                {t('admin.sso.errors.saveFailedTitle', 'Provider could not be saved')}
              </AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field
              label={t('admin.sso.name', 'Name')}
              value={draft.name || ''}
              error={errors[`${prefix}name`]}
              required
              onChange={(name) => onDraftChange({ name })}
            />
            <Field
              label={t('admin.sso.slug', 'Slug')}
              value={draft.slug || ''}
              error={errors[`${prefix}slug`]}
              monospace
              required
              onChange={(slug) => onDraftChange({ slug: slug.toLowerCase() })}
            />
          </div>

          {protocol === 'oidc' ? (
            <OidcProviderFields
              draft={draft}
              errors={errors}
              errorPrefix={prefix}
              replacingSecrets={replacingSecrets}
              onDraftChange={onDraftChange}
              onStartReplace={onStartReplace}
              onCancelReplace={onCancelReplace}
            />
          ) : (
            <SamlProviderFields
              draft={draft}
              errors={errors}
              errorPrefix={prefix}
              replacingSecrets={replacingSecrets}
              acsUrlState={acsUrlState}
              onDraftChange={onDraftChange}
              onStartReplace={onStartReplace}
              onCancelReplace={onCancelReplace}
            />
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
              required={protocol === 'oidc' && !!draft.enabled}
              onChange={(usernameAttribute) => onDraftChange({ usernameAttribute })}
            />
            <Field
              label={t('admin.sso.nameAttribute', 'Name Attribute')}
              value={draft.nameAttribute || ''}
              monospace
              onChange={(nameAttribute) => onDraftChange({ nameAttribute })}
            />
            <Field
              label={t('admin.sso.emailAttribute', 'Email Attribute')}
              value={draft.emailAttribute || ''}
              monospace
              onChange={(emailAttribute) => onDraftChange({ emailAttribute })}
            />
            <Field
              label={t('admin.sso.groupsAttribute', 'Groups Attribute')}
              value={draft.groupsAttribute || ''}
              monospace
              onChange={(groupsAttribute) => onDraftChange({ groupsAttribute })}
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
              onDraftChange({
                roleMappings: [
                  ...(draft.roleMappings || []),
                  { externalGroup: '', role: roleOptions[0]?.id || 'user' },
                ],
              })
            }
            onRemove={(index) =>
              onDraftChange({
                roleMappings: (draft.roleMappings || []).filter((_, idx) => idx !== index),
              })
            }
            onChange={onMappingChange}
          />
        </CardContent>

        <CardFooter className="justify-between border-t border-border px-6 py-4 [.border-t]:pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="font-bold text-muted-foreground hover:text-foreground"
          >
            {t('admin.sso.clearForm', 'Clear')}
          </Button>
          <Button type="submit" size="lg" disabled={saving}>
            {saving ? (
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

interface ProviderProtocolFieldsProps {
  draft: Partial<SsoProvider>;
  errors: Record<string, string>;
  errorPrefix: string;
  replacingSecrets: Partial<Record<SsoSecretFieldKey, boolean>>;
  onDraftChange: (updates: Partial<SsoProvider>) => void;
  onStartReplace: (field: SsoSecretFieldKey) => void;
  onCancelReplace: (field: SsoSecretFieldKey) => void;
}

const OidcProviderFields: React.FC<ProviderProtocolFieldsProps> = ({
  draft,
  errors,
  errorPrefix,
  replacingSecrets,
  onDraftChange,
  onStartReplace,
  onCancelReplace,
}) => {
  const { t } = useTranslation('auth');

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Field
          label={t('admin.sso.issuerUrl', 'Issuer URL')}
          value={draft.issuerUrl || ''}
          error={errors[`${errorPrefix}issuerUrl`]}
          monospace
          required={!!draft.enabled}
          onChange={(issuerUrl) => onDraftChange({ issuerUrl })}
        />
        <Field
          label={t('admin.sso.clientId', 'Client ID')}
          value={draft.clientId || ''}
          error={errors[`${errorPrefix}clientId`]}
          monospace
          required={!!draft.enabled}
          onChange={(clientId) => onDraftChange({ clientId })}
        />
        <SecretField
          label={t('admin.sso.clientSecret', 'Client Secret')}
          value={draft.clientSecret || ''}
          monospace
          isStored={isStoredSecret(draft.clientSecret)}
          isReplacing={!!replacingSecrets.clientSecret}
          onStartReplace={() => onStartReplace('clientSecret')}
          onCancelReplace={() => onCancelReplace('clientSecret')}
          onChange={(clientSecret) => onDraftChange({ clientSecret })}
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
          onChange={(scopes) => onDraftChange({ scopes })}
        />
      </div>
      <UIField className="flex-row items-start gap-3 rounded-lg border border-border bg-muted p-4">
        <Switch
          id="provider-end-session-oidc"
          checked={!!draft.endSessionEnabled}
          onCheckedChange={(endSessionEnabled) => onDraftChange({ endSessionEnabled })}
          className="mt-0.5"
        />
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="provider-end-session-oidc">
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
  );
};

interface SamlProviderFieldsProps extends ProviderProtocolFieldsProps {
  acsUrlState: AcsUrlState;
}

const SamlProviderFields: React.FC<SamlProviderFieldsProps> = ({
  draft,
  errors,
  errorPrefix,
  replacingSecrets,
  acsUrlState,
  onDraftChange,
  onStartReplace,
  onCancelReplace,
}) => {
  const { t } = useTranslation('auth');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Field
        label={t('admin.sso.metadataUrl', 'Metadata URL')}
        value={draft.metadataUrl || ''}
        monospace
        onChange={(metadataUrl) => onDraftChange({ metadataUrl })}
      />
      <Field
        label={t('admin.sso.entryPoint', 'Entry Point')}
        value={draft.entryPoint || ''}
        monospace
        onChange={(entryPoint) => onDraftChange({ entryPoint })}
      />
      <Field
        label={t('admin.sso.idpIssuer', 'IdP Issuer')}
        value={draft.idpIssuer || ''}
        monospace
        error={errors[`${errorPrefix}idpIssuer`]}
        onChange={(idpIssuer) => onDraftChange({ idpIssuer })}
      />
      <Field
        label={t('admin.sso.spIssuer', 'SP Issuer')}
        value={draft.spIssuer || ''}
        monospace
        onChange={(spIssuer) => onDraftChange({ spIssuer })}
      />
      <SecretField
        multiline
        monospace
        label={t('admin.sso.metadataXml', 'Metadata XML')}
        value={draft.metadataXml || ''}
        isStored={isStoredSecret(draft.metadataXml)}
        isReplacing={!!replacingSecrets.metadataXml}
        onStartReplace={() => onStartReplace('metadataXml')}
        onCancelReplace={() => onCancelReplace('metadataXml')}
        onChange={(metadataXml) => onDraftChange({ metadataXml })}
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
        isReplacing={!!replacingSecrets.idpCert}
        onStartReplace={() => onStartReplace('idpCert')}
        onCancelReplace={() => onCancelReplace('idpCert')}
        onChange={(idpCert) => onDraftChange({ idpCert })}
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
        isReplacing={!!replacingSecrets.privateKey}
        onStartReplace={() => onStartReplace('privateKey')}
        onCancelReplace={() => onCancelReplace('privateKey')}
        onChange={(privateKey) => onDraftChange({ privateKey })}
        storedLabel={t('admin.sso.privateKeyStored', 'Private key stored')}
        storedHelp={t(
          'admin.sso.privateKeyStoredHelp',
          'Leave as-is to keep the stored key, or click Replace to overwrite it.',
        )}
      />
      <TextArea
        label={t('admin.sso.publicCert', 'Signing Public Certificate')}
        value={draft.publicCert || ''}
        onChange={(publicCert) => onDraftChange({ publicCert })}
      />
      {!!draft.slug?.trim() && acsUrlState.status !== 'loading' && (
        <div className="md:col-span-2">
          {acsUrlState.status === 'ready' ? (
            <ReadOnlyField
              label={t('admin.sso.acsUrl', 'ACS URL')}
              value={fillSlugTemplate(acsUrlState.template, draft.slug.trim().toLowerCase())}
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
      {errors[`${errorPrefix}samlConfig`] && (
        <FieldError className="md:col-span-2">{errors[`${errorPrefix}samlConfig`]}</FieldError>
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
  required?: boolean;
};

const Field: React.FC<FieldProps> = ({
  label,
  value,
  onChange,
  error,
  type = 'text',
  monospace,
  required,
}) => {
  const id = useId();
  return (
    <UIField>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
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
