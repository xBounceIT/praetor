/**
 * API Service Layer
 * Facade preserving the previous public API while implementation is split by domain.
 */

export { aiApi } from './api/ai';
export { authApi } from './api/auth';
export { getAuthToken, setAuthToken } from './api/client';
export { clientQuotesApi } from './api/clientQuotes';
export { clientsApi } from './api/clients';
export { clientsOrdersApi } from './api/clientsOrders';
export type { LoginResponse, Settings } from './api/contracts';
export { emailApi } from './api/email';
export { employeesApi } from './api/employees';
export { entriesApi } from './api/entries';
export { expensesApi } from './api/expenses';
export { generalSettingsApi } from './api/generalSettings';
export { invoicesApi } from './api/invoices';
export { ldapApi } from './api/ldap';
export { logsApi } from './api/logs';
export { notificationsApi } from './api/notifications';
export { paymentsApi } from './api/payments';
export { productsApi } from './api/products';
export { projectsApi } from './api/projects';
export { reportsApi } from './api/reports';
export { rolesApi } from './api/roles';
export { settingsApi } from './api/settings';
export { specialBidsApi } from './api/specialBids';
export { supplierQuotesApi } from './api/supplierQuotes';
export { suppliersApi } from './api/suppliers';
export { tasksApi } from './api/tasks';
export { usersApi } from './api/users';
export { workUnitsApi } from './api/workUnits';

import { aiApi } from './api/ai';
import { authApi } from './api/auth';
import { getAuthToken, setAuthToken } from './api/client';
import { clientQuotesApi } from './api/clientQuotes';
import { clientsApi } from './api/clients';
import { clientsOrdersApi } from './api/clientsOrders';
import { emailApi } from './api/email';
import { employeesApi } from './api/employees';
import { entriesApi } from './api/entries';
import { expensesApi } from './api/expenses';
import { generalSettingsApi } from './api/generalSettings';
import { invoicesApi } from './api/invoices';
import { ldapApi } from './api/ldap';
import { logsApi } from './api/logs';
import { notificationsApi } from './api/notifications';
import { paymentsApi } from './api/payments';
import { productsApi } from './api/products';
import { projectsApi } from './api/projects';
import { reportsApi } from './api/reports';
import { rolesApi } from './api/roles';
import { settingsApi } from './api/settings';
import { specialBidsApi } from './api/specialBids';
import { supplierQuotesApi } from './api/supplierQuotes';
import { suppliersApi } from './api/suppliers';
import { tasksApi } from './api/tasks';
import { usersApi } from './api/users';
import { workUnitsApi } from './api/workUnits';

export default {
  auth: authApi,
  ai: aiApi,
  reports: reportsApi,
  users: usersApi,
  employees: employeesApi,
  clients: clientsApi,
  projects: projectsApi,
  tasks: tasksApi,
  entries: entriesApi,
  products: productsApi,
  quotes: clientQuotesApi,
  clientsOrders: clientsOrdersApi,
  invoices: invoicesApi,
  payments: paymentsApi,
  expenses: expensesApi,
  suppliers: suppliersApi,
  supplierQuotes: supplierQuotesApi,
  specialBids: specialBidsApi,
  notifications: notificationsApi,
  workUnits: workUnitsApi,
  settings: settingsApi,
  ldap: ldapApi,
  generalSettings: generalSettingsApi,
  email: emailApi,
  roles: rolesApi,
  logs: logsApi,
  setAuthToken,
  getAuthToken,
};
