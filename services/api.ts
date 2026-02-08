/**
 * API Service Layer
 * Replaces localStorage with REST API calls to the backend server
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Token management
let authToken: string | null = localStorage.getItem('praetor_auth_token');

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) {
    localStorage.setItem('praetor_auth_token', token);
  } else {
    localStorage.removeItem('praetor_auth_token');
  }
};

export const getAuthToken = () => authToken;

// Base fetch wrapper with auth
const fetchApi = async <T>(endpoint: string, options: RequestInit = {}): Promise<T> => {
  const headers: HeadersInit = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  // Check for new token in header (sliding window auth)
  const newToken = response.headers.get('x-auth-token');
  if (newToken) {
    setAuthToken(newToken);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
};

// Types for API responses
import type {
  Client,
  ClientsOrder,
  ClientsOrderItem,
  EmailConfig,
  EmployeeType,
  Expense,
  GeneralSettings,
  Invoice,
  InvoiceItem,
  LdapConfig,
  Notification,
  Payment,
  Product,
  Project,
  ProjectTask,
  Quote,
  QuoteItem,
  Role,
  SpecialBid,
  Supplier,
  SupplierQuote,
  SupplierQuoteItem,
  TimeEntry,
  User,
  WorkUnit,
} from '../types';

// Normalization Helpers
const normalizeUser = (u: User): User => ({
  ...u,
  permissions: u.permissions || [],
  costPerHour: u.costPerHour ? Number(u.costPerHour) : 0,
  employeeType: u.employeeType || 'app_user',
});

const normalizeProduct = (p: Product): Product => ({
  ...p,
  costo: Number(p.costo || 0),
  taxRate: Number(p.taxRate || 0),
});

const normalizeQuoteItem = (item: QuoteItem): QuoteItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  productCost:
    item.productCost === undefined || item.productCost === null ? 0 : Number(item.productCost),
  productTaxRate:
    item.productTaxRate === undefined || item.productTaxRate === null
      ? 0
      : Number(item.productTaxRate),
  productMolPercentage:
    item.productMolPercentage === undefined || item.productMolPercentage === null
      ? null
      : Number(item.productMolPercentage),
  specialBidUnitPrice:
    item.specialBidUnitPrice === undefined || item.specialBidUnitPrice === null
      ? null
      : Number(item.specialBidUnitPrice),
  specialBidMolPercentage:
    item.specialBidMolPercentage === undefined || item.specialBidMolPercentage === null
      ? null
      : Number(item.specialBidMolPercentage),
  discount: Number(item.discount || 0),
  note: item.note || '',
});

const normalizeQuote = (q: Quote): Quote => ({
  ...q,
  discount: Number(q.discount || 0),
  // Ensure items is an array
  items: (q.items || []).map(normalizeQuoteItem),
});

const normalizeClientsOrderItem = (item: ClientsOrderItem): ClientsOrderItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  productCost:
    item.productCost === undefined || item.productCost === null ? 0 : Number(item.productCost),
  productTaxRate:
    item.productTaxRate === undefined || item.productTaxRate === null
      ? 0
      : Number(item.productTaxRate),
  productMolPercentage:
    item.productMolPercentage === undefined || item.productMolPercentage === null
      ? null
      : Number(item.productMolPercentage),
  specialBidUnitPrice:
    item.specialBidUnitPrice === undefined || item.specialBidUnitPrice === null
      ? null
      : Number(item.specialBidUnitPrice),
  specialBidMolPercentage:
    item.specialBidMolPercentage === undefined || item.specialBidMolPercentage === null
      ? null
      : Number(item.specialBidMolPercentage),
  discount: Number(item.discount || 0),
});

const normalizeClientsOrder = (o: ClientsOrder): ClientsOrder => ({
  ...o,
  discount: Number(o.discount || 0),
  items: (o.items || []).map(normalizeClientsOrderItem),
});

const normalizeTimeEntry = (e: TimeEntry): TimeEntry => ({
  ...e,
  duration: Number(e.duration || 0),
  hourlyCost: Number(e.hourlyCost || 0),
});

const normalizeTask = (t: ProjectTask): ProjectTask => ({
  ...t,
  recurrenceDuration: t.recurrenceDuration ? Number(t.recurrenceDuration) : 0,
});

const normalizeGeneralSettings = (s: GeneralSettings): GeneralSettings => ({
  ...s,
  dailyLimit: Number(s.dailyLimit || 0),
});

const normalizeInvoiceItem = (item: InvoiceItem): InvoiceItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  taxRate: Number(item.taxRate || 0),
  discount: Number(item.discount || 0),
});

const normalizeInvoice = (i: Invoice): Invoice => ({
  ...i,
  subtotal: Number(i.subtotal ?? 0),
  taxAmount: Number(i.taxAmount ?? 0),
  total: Number(i.total ?? 0),
  amountPaid: Number(i.amountPaid ?? 0),
  items: (i.items || []).map(normalizeInvoiceItem),
});

const normalizePayment = (p: Payment): Payment => ({
  ...p,
  amount: Number(p.amount || 0),
});

const normalizeExpense = (e: Expense): Expense => ({
  ...e,
  amount: Number(e.amount || 0),
});

const normalizeSupplierQuoteItem = (item: SupplierQuoteItem): SupplierQuoteItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  discount: Number(item.discount || 0),
  note: item.note || '',
});

const normalizeSupplierQuote = (q: SupplierQuote): SupplierQuote => ({
  ...q,
  discount: Number(q.discount || 0),
  items: (q.items || []).map(normalizeSupplierQuoteItem),
});

const normalizeSpecialBid = (b: SpecialBid): SpecialBid => ({
  ...b,
  unitPrice: Number(b.unitPrice || 0),
  molPercentage:
    b.molPercentage === undefined || b.molPercentage === null ? undefined : Number(b.molPercentage),
});

export interface LoginResponse {
  token: string;
  user: User;
}

export interface Settings {
  fullName: string;
  email: string;
  language?: 'en' | 'it' | 'auto';
}

// Auth API
export const authApi = {
  login: (username: string, password: string): Promise<LoginResponse> =>
    fetchApi('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: (): Promise<User> => fetchApi<User>('/auth/me').then(normalizeUser),

  switchRole: (roleId: string): Promise<LoginResponse> =>
    fetchApi('/auth/switch-role', {
      method: 'POST',
      body: JSON.stringify({ roleId }),
    }),
};

export const rolesApi = {
  list: (): Promise<Role[]> => fetchApi('/roles'),
  create: (name: string, permissions: string[] = []): Promise<Role> =>
    fetchApi('/roles', {
      method: 'POST',
      body: JSON.stringify({ name, permissions }),
    }),
  rename: (id: string, name: string): Promise<Role> =>
    fetchApi(`/roles/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  updatePermissions: (id: string, permissions: string[]): Promise<Role> =>
    fetchApi(`/roles/${id}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
  delete: (id: string): Promise<{ message: string }> =>
    fetchApi(`/roles/${id}`, {
      method: 'DELETE',
    }),
};

// Users API
export const usersApi = {
  list: (): Promise<User[]> => fetchApi<User[]>('/users').then((users) => users.map(normalizeUser)),

  create: (
    name: string,
    username: string,
    password: string,
    role: string,
    costPerHour?: number,
  ): Promise<User> =>
    fetchApi<User>('/users', {
      method: 'POST',
      body: JSON.stringify({ name, username, password, role, costPerHour }),
    }).then(normalizeUser),

  delete: (id: string): Promise<void> => fetchApi(`/users/${id}`, { method: 'DELETE' }),

  getAssignments: (
    id: string,
  ): Promise<{ clientIds: string[]; projectIds: string[]; taskIds: string[] }> =>
    fetchApi(`/users/${id}/assignments`),

  updateAssignments: (
    id: string,
    clientIds: string[],
    projectIds: string[],
    taskIds?: string[],
  ): Promise<void> =>
    fetchApi(`/users/${id}/assignments`, {
      method: 'POST',
      body: JSON.stringify({ clientIds, projectIds, taskIds }),
    }),

  update: (id: string, updates: Partial<User>): Promise<User> =>
    fetchApi<User>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeUser),

  getRoles: (id: string): Promise<{ roleIds: string[]; primaryRoleId: string }> =>
    fetchApi(`/users/${id}/roles`),

  updateRoles: (
    id: string,
    roleIds: string[],
    primaryRoleId: string,
  ): Promise<{ roleIds: string[]; primaryRoleId: string }> =>
    fetchApi(`/users/${id}/roles`, {
      method: 'PUT',
      body: JSON.stringify({ roleIds, primaryRoleId }),
    }),
};

// Employees API (for internal/external employees)
export const employeesApi = {
  create: (data: {
    name: string;
    employeeType: EmployeeType;
    costPerHour?: number;
  }): Promise<User> =>
    fetchApi<User>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then(normalizeUser),

  update: (id: string, updates: Partial<User>): Promise<User> =>
    fetchApi<User>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeUser),

  delete: (id: string): Promise<void> => fetchApi(`/users/${id}`, { method: 'DELETE' }),
};

// Clients API
export const clientsApi = {
  list: (): Promise<Client[]> => fetchApi('/clients'),

  create: (clientData: Partial<Client>): Promise<Client> =>
    fetchApi('/clients', {
      method: 'POST',
      body: JSON.stringify(clientData),
    }),

  update: (id: string, updates: Partial<Client>): Promise<Client> =>
    fetchApi(`/clients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string): Promise<void> => fetchApi(`/clients/${id}`, { method: 'DELETE' }),
};

// Projects API
export const projectsApi = {
  list: (): Promise<Project[]> => fetchApi('/projects'),

  create: (
    name: string,
    clientId: string,
    description?: string,
    color?: string,
  ): Promise<Project> =>
    fetchApi('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, clientId, description, color }),
    }),

  update: (id: string, updates: Partial<Project>): Promise<Project> =>
    fetchApi(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string): Promise<void> => fetchApi(`/projects/${id}`, { method: 'DELETE' }),
};

// Tasks API
export const tasksApi = {
  list: (): Promise<ProjectTask[]> =>
    fetchApi<ProjectTask[]>('/tasks').then((tasks) => tasks.map(normalizeTask)),

  create: (
    name: string,
    projectId: string,
    description?: string,
    isRecurring?: boolean,
    recurrencePattern?: string,
  ): Promise<ProjectTask> =>
    fetchApi<ProjectTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ name, projectId, description, isRecurring, recurrencePattern }),
    }).then(normalizeTask),

  update: (id: string, updates: Partial<ProjectTask>): Promise<ProjectTask> =>
    fetchApi<ProjectTask>(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeTask),

  delete: (id: string): Promise<void> => fetchApi(`/tasks/${id}`, { method: 'DELETE' }),

  getUsers: (id: string): Promise<string[]> => fetchApi(`/tasks/${id}/users`),

  updateUsers: (id: string, userIds: string[]): Promise<void> =>
    fetchApi(`/tasks/${id}/users`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),
};

// Time Entries API
export const entriesApi = {
  list: (userId?: string): Promise<TimeEntry[]> =>
    fetchApi<TimeEntry[]>(userId ? `/entries?userId=${userId}` : '/entries').then((entries) =>
      entries.map(normalizeTimeEntry),
    ),

  create: (entry: Omit<TimeEntry, 'id' | 'createdAt'>): Promise<TimeEntry> =>
    fetchApi<TimeEntry>('/entries', {
      method: 'POST',
      body: JSON.stringify(entry),
    }).then(normalizeTimeEntry),

  update: (id: string, updates: Partial<TimeEntry>): Promise<TimeEntry> =>
    fetchApi<TimeEntry>(`/entries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeTimeEntry),

  delete: (id: string): Promise<void> => fetchApi(`/entries/${id}`, { method: 'DELETE' }),

  bulkDelete: (
    projectId: string,
    task: string,
    options?: { futureOnly?: boolean; placeholderOnly?: boolean },
  ): Promise<void> => {
    const params = new URLSearchParams({ projectId, task });
    if (options?.futureOnly) params.append('futureOnly', 'true');
    if (options?.placeholderOnly) params.append('placeholderOnly', 'true');
    return fetchApi(`/entries?${params.toString()}`, { method: 'DELETE' });
  },
};

// Settings API
export const settingsApi = {
  get: (): Promise<Settings> => fetchApi('/settings'),

  update: (settings: Partial<Settings>): Promise<Settings> =>
    fetchApi('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  updatePassword: (currentPassword: string, newPassword: string): Promise<{ message: string }> =>
    fetchApi('/settings/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

// LDAP API
export const ldapApi = {
  getConfig: (): Promise<LdapConfig> => fetchApi('/ldap/config'),

  updateConfig: (config: Partial<LdapConfig>): Promise<LdapConfig> =>
    fetchApi('/ldap/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
};

// Products API
export const productsApi = {
  list: (): Promise<Product[]> =>
    fetchApi<Product[]>('/products').then((products) => products.map(normalizeProduct)),

  create: (productData: Partial<Product>): Promise<Product> =>
    fetchApi<Product>('/products', {
      method: 'POST',
      body: JSON.stringify(productData),
    }).then(normalizeProduct),

  update: (id: string, updates: Partial<Product>): Promise<Product> =>
    fetchApi<Product>(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeProduct),

  delete: (id: string): Promise<void> => fetchApi(`/products/${id}`, { method: 'DELETE' }),
};

// Work Units API
export const workUnitsApi = {
  list: (): Promise<WorkUnit[]> => fetchApi('/work-units'),

  create: (data: Partial<WorkUnit>): Promise<WorkUnit> =>
    fetchApi('/work-units', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, updates: Partial<WorkUnit>): Promise<WorkUnit> =>
    fetchApi(`/work-units/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string): Promise<void> => fetchApi(`/work-units/${id}`, { method: 'DELETE' }),

  getUsers: (id: string): Promise<string[]> => fetchApi(`/work-units/${id}/users`),

  updateUsers: (id: string, userIds: string[]): Promise<void> =>
    fetchApi(`/work-units/${id}/users`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),
};

// General Settings API
export const generalSettingsApi = {
  get: (): Promise<GeneralSettings> =>
    fetchApi<GeneralSettings>('/general-settings').then(normalizeGeneralSettings),

  update: (settings: Partial<GeneralSettings>): Promise<GeneralSettings> =>
    fetchApi<GeneralSettings>('/general-settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }).then(normalizeGeneralSettings),
};

// Client Quotes API (Sales module)
export const clientQuotesApi = {
  list: (): Promise<Quote[]> =>
    fetchApi<Quote[]>('/sales/client-quotes').then((quotes) => quotes.map(normalizeQuote)),

  create: (quoteData: Partial<Quote>): Promise<Quote> =>
    fetchApi<Quote>('/sales/client-quotes', {
      method: 'POST',
      body: JSON.stringify(quoteData),
    }).then(normalizeQuote),

  update: (id: string, updates: Partial<Quote>): Promise<Quote> =>
    fetchApi<Quote>(`/sales/client-quotes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeQuote),

  delete: (id: string): Promise<void> =>
    fetchApi(`/sales/client-quotes/${id}`, { method: 'DELETE' }),
};

// Clients Orders API
export const clientsOrdersApi = {
  list: (): Promise<ClientsOrder[]> =>
    fetchApi<ClientsOrder[]>('/clients-orders').then((orders) => orders.map(normalizeClientsOrder)),

  create: (orderData: Partial<ClientsOrder>): Promise<ClientsOrder> =>
    fetchApi<ClientsOrder>('/clients-orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    }).then(normalizeClientsOrder),

  update: (id: string, updates: Partial<ClientsOrder>): Promise<ClientsOrder> =>
    fetchApi<ClientsOrder>(`/clients-orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeClientsOrder),

  delete: (id: string): Promise<void> => fetchApi(`/clients-orders/${id}`, { method: 'DELETE' }),
};

// Invoices API
export const invoicesApi = {
  list: (): Promise<Invoice[]> =>
    fetchApi<Invoice[]>('/invoices').then((invoices) => invoices.map(normalizeInvoice)),

  create: (invoiceData: Partial<Invoice>): Promise<Invoice> =>
    fetchApi<Invoice>('/invoices', {
      method: 'POST',
      body: JSON.stringify(invoiceData),
    }).then(normalizeInvoice),

  update: (id: string, updates: Partial<Invoice>): Promise<Invoice> =>
    fetchApi<Invoice>(`/invoices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeInvoice),

  delete: (id: string): Promise<void> => fetchApi(`/invoices/${id}`, { method: 'DELETE' }),
};

// Payments API
export const paymentsApi = {
  list: (): Promise<Payment[]> =>
    fetchApi<Payment[]>('/payments').then((payments) => payments.map(normalizePayment)),

  create: (paymentData: Partial<Payment>): Promise<Payment> =>
    fetchApi<Payment>('/payments', {
      method: 'POST',
      body: JSON.stringify(paymentData),
    }).then(normalizePayment),

  update: (id: string, updates: Partial<Payment>): Promise<Payment> =>
    fetchApi<Payment>(`/payments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizePayment),

  delete: (id: string): Promise<void> => fetchApi(`/payments/${id}`, { method: 'DELETE' }),
};

// Expenses API
export const expensesApi = {
  list: (): Promise<Expense[]> =>
    fetchApi<Expense[]>('/expenses').then((expenses) => expenses.map(normalizeExpense)),

  create: (expenseData: Partial<Expense>): Promise<Expense> =>
    fetchApi<Expense>('/expenses', {
      method: 'POST',
      body: JSON.stringify(expenseData),
    }).then(normalizeExpense),

  update: (id: string, updates: Partial<Expense>): Promise<Expense> =>
    fetchApi<Expense>(`/expenses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeExpense),

  delete: (id: string): Promise<void> => fetchApi(`/expenses/${id}`, { method: 'DELETE' }),
};

// Suppliers API
export const suppliersApi = {
  list: (): Promise<Supplier[]> => fetchApi('/suppliers'),

  create: (supplierData: Partial<Supplier>): Promise<Supplier> =>
    fetchApi('/suppliers', {
      method: 'POST',
      body: JSON.stringify(supplierData),
    }),

  update: (id: string, updates: Partial<Supplier>): Promise<Supplier> =>
    fetchApi(`/suppliers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string): Promise<void> => fetchApi(`/suppliers/${id}`, { method: 'DELETE' }),
};

// Supplier Quotes API
export const supplierQuotesApi = {
  list: (): Promise<SupplierQuote[]> =>
    fetchApi<SupplierQuote[]>('/supplier-quotes').then((quotes) =>
      quotes.map(normalizeSupplierQuote),
    ),

  create: (quoteData: Partial<SupplierQuote>): Promise<SupplierQuote> =>
    fetchApi<SupplierQuote>('/supplier-quotes', {
      method: 'POST',
      body: JSON.stringify(quoteData),
    }).then(normalizeSupplierQuote),

  update: (id: string, updates: Partial<SupplierQuote>): Promise<SupplierQuote> =>
    fetchApi<SupplierQuote>(`/supplier-quotes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeSupplierQuote),

  delete: (id: string): Promise<void> => fetchApi(`/supplier-quotes/${id}`, { method: 'DELETE' }),
};

// Special Bids API
export const specialBidsApi = {
  list: (): Promise<SpecialBid[]> =>
    fetchApi<SpecialBid[]>('/special-bids').then((bids) => bids.map(normalizeSpecialBid)),

  create: (bidData: Partial<SpecialBid>): Promise<SpecialBid> =>
    fetchApi<SpecialBid>('/special-bids', {
      method: 'POST',
      body: JSON.stringify(bidData),
    }).then(normalizeSpecialBid),

  update: (id: string, updates: Partial<SpecialBid>): Promise<SpecialBid> =>
    fetchApi<SpecialBid>(`/special-bids/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeSpecialBid),

  delete: (id: string): Promise<void> => fetchApi(`/special-bids/${id}`, { method: 'DELETE' }),
};

// Notifications API
export const notificationsApi = {
  list: (): Promise<{ notifications: Notification[]; unreadCount: number }> =>
    fetchApi('/notifications'),

  markAsRead: (id: string): Promise<{ success: boolean }> =>
    fetchApi(`/notifications/${id}/read`, { method: 'PUT' }),

  markAllAsRead: (): Promise<{ success: boolean }> =>
    fetchApi('/notifications/read-all', { method: 'PUT' }),

  delete: (id: string): Promise<void> => fetchApi(`/notifications/${id}`, { method: 'DELETE' }),
};

// Email API
export const emailApi = {
  getConfig: (): Promise<EmailConfig> => fetchApi('/email/config'),

  updateConfig: (config: Partial<EmailConfig>): Promise<EmailConfig> =>
    fetchApi('/email/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  sendTestEmail: (
    recipientEmail: string,
  ): Promise<{
    success: boolean;
    code: string;
    params?: Record<string, string>;
    messageId?: string;
  }> =>
    fetchApi('/email/test', {
      method: 'POST',
      body: JSON.stringify({ recipientEmail }),
    }),

  testConnection: (): Promise<{ success: boolean; message: string }> =>
    fetchApi('/email/test-connection', { method: 'POST' }),
};

export default {
  auth: authApi,
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
  setAuthToken,
  getAuthToken,
};
