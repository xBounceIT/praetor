import type { EmailConfig, GeneralSettings, LdapConfig } from './types';
import {
  DEFAULT_RIL_EXIT_TIME,
  DEFAULT_RIL_NOTE_OPTIONS,
  DEFAULT_RIL_START_TIME,
  DEFAULT_RIL_TRANSFER_OPTIONS,
} from './utils/ril';

// State variant: every optional field on the API-response type is present as
// a concrete value (empty string / default) so consumers never see `undefined`.
export type GeneralSettingsState = Required<GeneralSettings>;

// Defaults are shared module-level references reused by every reset; an
// in-place mutation by any consumer would silently re-introduce the leak
// these constants exist to prevent. Freeze recursively (Object.isFrozen
// guards against cycles) and return Readonly so the compiler flags writes
// before runtime does.
const deepFreeze = <T>(value: T): Readonly<T> => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
};

export const INITIAL_LDAP_CONFIG = deepFreeze<LdapConfig>({
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
});

export const INITIAL_GENERAL_SETTINGS = deepFreeze<GeneralSettingsState>({
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
  rilCompanyName: '',
  rilDefaultStartTime: DEFAULT_RIL_START_TIME,
  rilDefaultExitTime: DEFAULT_RIL_EXIT_TIME,
  rilLunchBreakMinutes: 60,
  rilNoteOptions: DEFAULT_RIL_NOTE_OPTIONS.map((option) => ({ ...option })),
  rilTransferOptions: [...DEFAULT_RIL_TRANSFER_OPTIONS],
});

export const INITIAL_EMAIL_CONFIG = deepFreeze<EmailConfig>({
  enabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpEncryption: 'tls',
  smtpRejectUnauthorized: true,
  smtpUser: '',
  smtpPassword: '',
  fromEmail: '',
  fromName: 'Praetor',
});
