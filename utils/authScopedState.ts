// Auth-scoped state lives on App.tsx and must be reset on login/logout so
// stale data from a previous session never bleeds into the next one. The
// helper below iterates a typed setter map so adding a new piece of
// auth-scoped state forces a compile error (via the `Record` below) until
// the App.tsx setters map registers it — instead of silently leaking on
// the next login/logout.
//
// Mirrors `utils/moduleScopedState.ts`, which solves the equivalent
// problem for module-navigation transitions.

export type AuthScopedStateKey =
  | 'hasLoadedGeneralSettings'
  | 'generalSettings'
  | 'hasLoadedLdapConfig'
  | 'ldapConfig'
  | 'hasLoadedEmailConfig'
  | 'emailConfig'
  | 'hasLoadedSsoProviders'
  | 'ssoProviders'
  | 'hasLoadedRoles'
  | 'roles'
  | 'users'
  | 'mfaExemptionUsers'
  | 'clients'
  | 'projects'
  | 'projectTasks'
  | 'resales'
  | 'resaleCategories'
  | 'resaleOrderOptions'
  | 'products'
  | 'quoteCommunicationChannels'
  | 'quotes'
  | 'clientOffers'
  | 'clientsOrders'
  | 'invoices'
  | 'suppliers'
  | 'supplierQuotes'
  | 'supplierOrders'
  | 'supplierInvoices'
  | 'entries'
  | 'workUnits'
  | 'responsibleUserOptions'
  | 'viewingUserAssignmentState';

export const ALL_AUTH_SCOPED_KEYS: readonly AuthScopedStateKey[] = [
  'hasLoadedGeneralSettings',
  'generalSettings',
  'hasLoadedLdapConfig',
  'ldapConfig',
  'hasLoadedEmailConfig',
  'emailConfig',
  'hasLoadedSsoProviders',
  'ssoProviders',
  'hasLoadedRoles',
  'roles',
  'users',
  'mfaExemptionUsers',
  'clients',
  'projects',
  'projectTasks',
  'resales',
  'resaleCategories',
  'resaleOrderOptions',
  'products',
  'quoteCommunicationChannels',
  'quotes',
  'clientOffers',
  'clientsOrders',
  'invoices',
  'suppliers',
  'supplierQuotes',
  'supplierOrders',
  'supplierInvoices',
  'entries',
  'workUnits',
  'responsibleUserOptions',
  'viewingUserAssignmentState',
];

// `Record` (not `Partial`) so a new union member that lacks a registered
// setter is a compile error — the entire point of the refactor.
export type AuthScopedStateResetters = Record<AuthScopedStateKey, () => void>;

export function clearAuthScopedState(resetters: AuthScopedStateResetters): void {
  for (const key of ALL_AUTH_SCOPED_KEYS) {
    resetters[key]();
  }
}
