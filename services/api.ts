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
const fetchApi = async <T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> => {
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
import type { User, Client, Project, ProjectTask, TimeEntry, LdapConfig, GeneralSettings, Product, Quote, QuoteItem, WorkUnit, Sale, SaleItem, Invoice, InvoiceItem, Payment, Expense, Supplier, SupplierQuote, SupplierQuoteItem } from '../types';

// Normalization Helpers
const normalizeUser = (u: User): User => ({
    ...u,
    costPerHour: u.costPerHour ? Number(u.costPerHour) : 0
});

const normalizeProduct = (p: Product): Product => ({
    ...p,
    salePrice: Number(p.salePrice || 0),
    cost: Number(p.cost || 0),
    taxRate: Number(p.taxRate || 0)
});

const normalizeQuoteItem = (item: QuoteItem): QuoteItem => ({
    ...item,
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unitPrice || 0),
    discount: Number(item.discount || 0),
    note: item.note || ''
});

const normalizeQuote = (q: Quote): Quote => ({
    ...q,
    discount: Number(q.discount || 0),
    // Ensure items is an array
    items: (q.items || []).map(normalizeQuoteItem)
});

const normalizeSaleItem = (item: SaleItem): SaleItem => ({
    ...item,
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unitPrice || 0),
    discount: Number(item.discount || 0)
});

const normalizeSale = (s: Sale): Sale => ({
    ...s,
    discount: Number(s.discount || 0),
    items: (s.items || []).map(normalizeSaleItem)
});

const normalizeTimeEntry = (e: TimeEntry): TimeEntry => ({
    ...e,
    duration: Number(e.duration || 0),
    hourlyCost: Number(e.hourlyCost || 0)
});

const normalizeTask = (t: ProjectTask): ProjectTask => ({
    ...t,
    recurrenceDuration: t.recurrenceDuration ? Number(t.recurrenceDuration) : 0
});

const normalizeGeneralSettings = (s: GeneralSettings): GeneralSettings => ({
    ...s,
    dailyLimit: Number(s.dailyLimit || 0)
});

const normalizeInvoiceItem = (item: InvoiceItem): InvoiceItem => ({
    ...item,
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unitPrice || 0),
    taxRate: Number(item.taxRate || 0),
    discount: Number(item.discount || 0)
});

const normalizeInvoice = (i: Invoice): Invoice => ({
    ...i,
    subtotal: Number(i.subtotal ?? 0),
    taxAmount: Number(i.taxAmount ?? 0),
    total: Number(i.total ?? 0),
    amountPaid: Number(i.amountPaid ?? 0),
    items: (i.items || []).map(normalizeInvoiceItem)
});

const normalizePayment = (p: Payment): Payment => ({
    ...p,
    amount: Number(p.amount || 0)
});

const normalizeExpense = (e: Expense): Expense => ({
    ...e,
    amount: Number(e.amount || 0)
});

const normalizeSupplierQuoteItem = (item: SupplierQuoteItem): SupplierQuoteItem => ({
    ...item,
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unitPrice || 0),
    discount: Number(item.discount || 0),
    note: item.note || ''
});

const normalizeSupplierQuote = (q: SupplierQuote): SupplierQuote => ({
    ...q,
    discount: Number(q.discount || 0),
    items: (q.items || []).map(normalizeSupplierQuoteItem)
});

export interface LoginResponse {
    token: string;
    user: User;
}

export interface Settings {
    fullName: string;
    email: string;
}

// Auth API
export const authApi = {
    login: (username: string, password: string): Promise<LoginResponse> =>
        fetchApi('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        }),

    me: (): Promise<User> => fetchApi<User>('/auth/me').then(normalizeUser),
};

// Users API
export const usersApi = {
    list: (): Promise<User[]> => fetchApi<User[]>('/users').then(users => users.map(normalizeUser)),

    create: (name: string, username: string, password: string, role: string, costPerHour?: number): Promise<User> =>
        fetchApi<User>('/users', {
            method: 'POST',
            body: JSON.stringify({ name, username, password, role, costPerHour }),
        }).then(normalizeUser),

    delete: (id: string): Promise<void> =>
        fetchApi(`/users/${id}`, { method: 'DELETE' }),

    getAssignments: (id: string): Promise<{ clientIds: string[], projectIds: string[], taskIds: string[] }> =>
        fetchApi(`/users/${id}/assignments`),

    updateAssignments: (id: string, clientIds: string[], projectIds: string[], taskIds: string[]): Promise<void> =>
        fetchApi(`/users/${id}/assignments`, {
            method: 'POST',
            body: JSON.stringify({ clientIds, projectIds, taskIds }),
        }),

    update: (id: string, updates: Partial<User>): Promise<User> =>
        fetchApi<User>(`/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }).then(normalizeUser),
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

    delete: (id: string): Promise<void> =>
        fetchApi(`/clients/${id}`, { method: 'DELETE' }),
};

// Projects API
export const projectsApi = {
    list: (): Promise<Project[]> => fetchApi('/projects'),

    create: (name: string, clientId: string, description?: string, color?: string): Promise<Project> =>
        fetchApi('/projects', {
            method: 'POST',
            body: JSON.stringify({ name, clientId, description, color }),
        }),

    update: (id: string, updates: Partial<Project>): Promise<Project> =>
        fetchApi(`/projects/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }),

    delete: (id: string): Promise<void> =>
        fetchApi(`/projects/${id}`, { method: 'DELETE' }),
};

// Tasks API
export const tasksApi = {
    list: (): Promise<ProjectTask[]> => fetchApi<ProjectTask[]>('/tasks').then(tasks => tasks.map(normalizeTask)),

    create: (name: string, projectId: string, description?: string, isRecurring?: boolean, recurrencePattern?: string): Promise<ProjectTask> =>
        fetchApi<ProjectTask>('/tasks', {
            method: 'POST',
            body: JSON.stringify({ name, projectId, description, isRecurring, recurrencePattern }),
        }).then(normalizeTask),

    update: (id: string, updates: Partial<ProjectTask>): Promise<ProjectTask> =>
        fetchApi<ProjectTask>(`/tasks/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }).then(normalizeTask),

    delete: (id: string): Promise<void> =>
        fetchApi(`/tasks/${id}`, { method: 'DELETE' }),

    getUsers: (id: string): Promise<string[]> =>
        fetchApi(`/tasks/${id}/users`),

    updateUsers: (id: string, userIds: string[]): Promise<void> =>
        fetchApi(`/tasks/${id}/users`, {
            method: 'POST',
            body: JSON.stringify({ userIds }),
        }),
};

// Time Entries API
export const entriesApi = {
    list: (userId?: string): Promise<TimeEntry[]> =>
        fetchApi<TimeEntry[]>(userId ? `/entries?userId=${userId}` : '/entries').then(entries => entries.map(normalizeTimeEntry)),

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

    delete: (id: string): Promise<void> =>
        fetchApi(`/entries/${id}`, { method: 'DELETE' }),

    bulkDelete: (projectId: string, task: string, options?: { futureOnly?: boolean; placeholderOnly?: boolean }): Promise<void> => {
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
    list: (): Promise<Product[]> => fetchApi<Product[]>('/products').then(products => products.map(normalizeProduct)),

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

    delete: (id: string): Promise<void> =>
        fetchApi(`/products/${id}`, { method: 'DELETE' }),
};

// Work Units API
export const workUnitsApi = {
    list: (): Promise<WorkUnit[]> => fetchApi('/work-units'),

    create: (data: any): Promise<WorkUnit> =>
        fetchApi('/work-units', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    update: (id: string, updates: any): Promise<WorkUnit> =>
        fetchApi(`/work-units/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }),

    delete: (id: string): Promise<void> =>
        fetchApi(`/work-units/${id}`, { method: 'DELETE' }),

    getUsers: (id: string): Promise<string[]> =>
        fetchApi(`/work-units/${id}/users`),

    updateUsers: (id: string, userIds: string[]): Promise<void> =>
        fetchApi(`/work-units/${id}/users`, {
            method: 'POST',
            body: JSON.stringify({ userIds }),
        }),
};

// General Settings API
export const generalSettingsApi = {
    get: (): Promise<GeneralSettings> => fetchApi<GeneralSettings>('/general-settings').then(normalizeGeneralSettings),

    update: (settings: Partial<GeneralSettings>): Promise<GeneralSettings> =>
        fetchApi<GeneralSettings>('/general-settings', {
            method: 'PUT',
            body: JSON.stringify(settings),
        }).then(normalizeGeneralSettings),
};

// Quotes API
export const quotesApi = {
    list: (): Promise<Quote[]> => fetchApi<Quote[]>('/quotes').then(quotes => quotes.map(normalizeQuote)),

    create: (quoteData: Partial<Quote>): Promise<Quote> =>
        fetchApi<Quote>('/quotes', {
            method: 'POST',
            body: JSON.stringify(quoteData),
        }).then(normalizeQuote),

    update: (id: string, updates: Partial<Quote>): Promise<Quote> =>
        fetchApi<Quote>(`/quotes/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }).then(normalizeQuote),

    delete: (id: string): Promise<void> =>
        fetchApi(`/quotes/${id}`, { method: 'DELETE' }),
};

// Sales API
export const salesApi = {
    list: (): Promise<Sale[]> => fetchApi<Sale[]>('/sales').then(sales => sales.map(normalizeSale)),

    create: (saleData: Partial<Sale>): Promise<Sale> =>
        fetchApi<Sale>('/sales', {
            method: 'POST',
            body: JSON.stringify(saleData),
        }).then(normalizeSale),

    update: (id: string, updates: Partial<Sale>): Promise<Sale> =>
        fetchApi<Sale>(`/sales/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }).then(normalizeSale),

    delete: (id: string): Promise<void> =>
        fetchApi(`/sales/${id}`, { method: 'DELETE' }),
};

// Invoices API
export const invoicesApi = {
    list: (): Promise<Invoice[]> => fetchApi<Invoice[]>('/invoices').then(invoices => invoices.map(normalizeInvoice)),

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

    delete: (id: string): Promise<void> =>
        fetchApi(`/invoices/${id}`, { method: 'DELETE' }),
};

// Payments API
export const paymentsApi = {
    list: (): Promise<Payment[]> => fetchApi<Payment[]>('/payments').then(payments => payments.map(normalizePayment)),

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

    delete: (id: string): Promise<void> =>
        fetchApi(`/payments/${id}`, { method: 'DELETE' }),
};

// Expenses API
export const expensesApi = {
    list: (): Promise<Expense[]> => fetchApi<Expense[]>('/expenses').then(expenses => expenses.map(normalizeExpense)),

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

    delete: (id: string): Promise<void> =>
        fetchApi(`/expenses/${id}`, { method: 'DELETE' }),
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

    delete: (id: string): Promise<void> =>
        fetchApi(`/suppliers/${id}`, { method: 'DELETE' }),
};

// Supplier Quotes API
export const supplierQuotesApi = {
    list: (): Promise<SupplierQuote[]> => fetchApi<SupplierQuote[]>('/supplier-quotes').then(quotes => quotes.map(normalizeSupplierQuote)),

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

    delete: (id: string): Promise<void> =>
        fetchApi(`/supplier-quotes/${id}`, { method: 'DELETE' }),
};

export default {
    auth: authApi,
    users: usersApi,
    clients: clientsApi,
    projects: projectsApi,
    tasks: tasksApi,
    entries: entriesApi,
    products: productsApi,
    quotes: quotesApi,
    sales: salesApi,
    invoices: invoicesApi,
    payments: paymentsApi,
    expenses: expensesApi,
    suppliers: suppliersApi,
    supplierQuotes: supplierQuotesApi,
    workUnits: workUnitsApi,
    settings: settingsApi,
    ldap: ldapApi,
    generalSettings: generalSettingsApi,
    setAuthToken,
    getAuthToken,
};
