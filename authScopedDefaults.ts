import type { EmailConfig, GeneralSettings, LdapConfig } from './types';

// State variant: every optional field on the API-response type is present as
// a concrete value (empty string / default) so consumers never see `undefined`.
export type GeneralSettingsState = Required<GeneralSettings>;

export const INITIAL_LDAP_CONFIG: LdapConfig = {
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

export const INITIAL_GENERAL_SETTINGS: GeneralSettingsState = {
  currency: '€',
  dailyLimit: 8,
  startOfWeek: 'Monday',
  treatSaturdayAsHoliday: true,
  allowWeekendSelection: true,
  enableAiReporting: false,
  geminiApiKey: '',
  aiProvider: 'gemini',
  openrouterApiKey: '',
  geminiModelId: '',
  openrouterModelId: '',
  defaultLocation: 'remote',
};

export const INITIAL_EMAIL_CONFIG: EmailConfig = {
  enabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpEncryption: 'tls',
  smtpRejectUnauthorized: true,
  smtpUser: '',
  smtpPassword: '',
  fromEmail: '',
  fromName: 'Praetor',
};
