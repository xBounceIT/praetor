import type { View } from '../types';

export const canonicalizeLegacyHash = (hash: string) => {
  if (hash === 'suppliers/manage') return 'crm/suppliers';
  if (hash === 'suppliers/quotes') return 'sales/supplier-quotes';
  if (hash === 'sales/supplier-offers') return 'sales/supplier-quotes';
  if (hash === 'administration/work-units') return 'hr/work-units';
  return hash;
};

export const VALID_VIEWS: View[] = [
  'timesheets/tracker',
  'timesheets/recurring',
  'administration/user-management',
  'administration/roles',
  'administration/authentication',
  'administration/general',
  'administration/email',
  'administration/logs',
  'crm/clients',
  'crm/suppliers',
  // Sales module
  'sales/client-quotes',
  'sales/client-offers',
  'sales/supplier-quotes',
  // Accounting module
  'accounting/clients-orders',
  'accounting/clients-invoices',
  'accounting/supplier-orders',
  'accounting/supplier-invoices',
  // Catalog module
  'catalog/internal-listing',
  'projects/manage',
  'projects/tasks',
  'hr/internal',
  'hr/external',
  'hr/work-units',
  // Reports module
  'reports/ai-reporting',
  'settings',
  'docs',
  'docs/api',
  'docs/frontend',
];

export const normalizeCurrencyForState = (currency: string) =>
  currency === 'USD' ? '$' : currency;
