// Maps each app module to the list of state-array keys it loads/owns.
// Used by App.tsx to clear stale data from previously-visited modules when a
// new module's data starts loading, so cross-module data doesn't leak into
// views that don't refresh it.

export type ModuleScopedStateKey =
  | 'clients'
  | 'suppliers'
  | 'projects'
  | 'projectTasks'
  | 'products'
  | 'quotes'
  | 'clientOffers'
  | 'clientsOrders'
  | 'invoices'
  | 'supplierQuotes'
  | 'supplierOrders'
  | 'supplierInvoices'
  | 'entries'
  | 'workUnits'
  | 'users';

// Every key listed here is a module-scoped state-array on App.tsx.
// Keep this list in sync with App.tsx's module-loading effect (the switch
// on `module`).
export const ALL_MODULE_SCOPED_KEYS: readonly ModuleScopedStateKey[] = [
  'clients',
  'suppliers',
  'projects',
  'projectTasks',
  'products',
  'quotes',
  'clientOffers',
  'clientsOrders',
  'invoices',
  'supplierQuotes',
  'supplierOrders',
  'supplierInvoices',
  'entries',
  'workUnits',
  'users',
];

// Per-module: which state keys are loaded/owned by that module.
// If a module doesn't appear here, no module-scoped state is associated
// with it (e.g. reports, settings, administration is users-only).
const MODULE_OWNED_KEYS: Record<string, readonly ModuleScopedStateKey[]> = {
  timesheets: ['entries', 'clients', 'projects', 'projectTasks', 'users'],
  hr: ['users', 'workUnits', 'clients', 'projects', 'projectTasks'],
  administration: ['users'],
  crm: ['clients', 'suppliers'],
  sales: ['quotes', 'clientOffers', 'supplierQuotes', 'clients', 'suppliers', 'products'],
  accounting: [
    'clientsOrders',
    'invoices',
    'supplierOrders',
    'supplierInvoices',
    'clients',
    'suppliers',
    'products',
  ],
  catalog: ['products'],
  projects: ['projects', 'projectTasks', 'clients', 'users', 'workUnits', 'clientsOrders'],
  suppliers: ['suppliers', 'supplierQuotes', 'products'],
  reports: [],
  settings: [],
};

/**
 * Returns the set of module-scoped state keys that should be cleared before
 * loading `incomingModule`. These are keys NOT owned by `incomingModule` —
 * i.e. data that the new module isn't going to refresh and that may be left
 * over from a previously-visited module.
 *
 * If `incomingModule` is unknown, returns an empty array (defensive: don't
 * wipe state we can't reason about).
 */
export function getStaleModuleScopedKeys(incomingModule: string | null): ModuleScopedStateKey[] {
  if (!incomingModule) return [];
  const owned = MODULE_OWNED_KEYS[incomingModule];
  if (!owned) return [];
  const ownedSet = new Set<ModuleScopedStateKey>(owned);
  return ALL_MODULE_SCOPED_KEYS.filter((key) => !ownedSet.has(key));
}

export type ModuleScopedStateSetters = Partial<Record<ModuleScopedStateKey, () => void>>;

/**
 * Invokes the empty-array setters for every state key that should be cleared
 * before loading `incomingModule`. The caller passes a record of
 * setter callbacks (each clears one state array). Setters not present in the
 * record are ignored, so callers can omit anything they don't manage.
 */
export function clearStaleModuleScopedState(
  incomingModule: string | null,
  setters: ModuleScopedStateSetters,
): ModuleScopedStateKey[] {
  const stale = getStaleModuleScopedKeys(incomingModule);
  const cleared: ModuleScopedStateKey[] = [];
  for (const key of stale) {
    const fn = setters[key];
    if (fn) {
      fn();
      cleared.push(key);
    }
  }
  return cleared;
}
