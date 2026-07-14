import type {
  LdapConfig,
  LdapSyncResponse,
  LdapTestResponse,
  SsoProtocol,
  SsoProvider,
} from '../../types';

export type SsoSecretFieldKey = 'clientSecret' | 'privateKey' | 'metadataXml' | 'idpCert';
export type AcsUrlState =
  | { status: 'loading' }
  | { status: 'ready'; template: string }
  | { status: 'error'; message: string };
export type AuthSettingsTab = 'ldap' | 'mfa' | 'session' | SsoProtocol;
export type StateUpdate<T> = T | ((prev: T) => T);

export type AuthSettingsState = {
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
  syncResult: LdapSyncResponse | null;
  syncError: string | null;
  isSyncingLdap: boolean;
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
  | { type: 'setSyncResult'; update: StateUpdate<AuthSettingsState['syncResult']> }
  | { type: 'setSyncError'; update: StateUpdate<AuthSettingsState['syncError']> }
  | { type: 'setIsSyncingLdap'; update: StateUpdate<AuthSettingsState['isSyncingLdap']> }
  | { type: 'setIsSavingLdap'; update: StateUpdate<AuthSettingsState['isSavingLdap']> }
  | { type: 'setSavingProvider'; update: StateUpdate<AuthSettingsState['savingProvider']> }
  | {
      type: 'setProviderSaveErrors';
      update: StateUpdate<AuthSettingsState['providerSaveErrors']>;
    }
  | { type: 'setAcsUrlState'; update: StateUpdate<AuthSettingsState['acsUrlState']> };

const resolveStateUpdate = <T>(current: T, update: StateUpdate<T>): T =>
  typeof update === 'function' ? (update as (prev: T) => T)(current) : update;

export const authSettingsReducer = (
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
    case 'setSyncResult':
      return { ...state, syncResult: resolveStateUpdate(state.syncResult, action.update) };
    case 'setSyncError':
      return { ...state, syncError: resolveStateUpdate(state.syncError, action.update) };
    case 'setIsSyncingLdap':
      return { ...state, isSyncingLdap: resolveStateUpdate(state.isSyncingLdap, action.update) };
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
    default:
      return state;
  }
};
