/**
 * API Service Layer
 * Replaces localStorage with REST API calls to the backend server
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Token management
let authToken: string | null = localStorage.getItem('tempo_auth_token');

export const setAuthToken = (token: string | null) => {
    authToken = token;
    if (token) {
        localStorage.setItem('tempo_auth_token', token);
    } else {
        localStorage.removeItem('tempo_auth_token');
    }
};

export const getAuthToken = () => authToken;

// Base fetch wrapper with auth
const fetchApi = async <T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> => {
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
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
import type { User, Client, Project, ProjectTask, TimeEntry, LdapConfig, GeneralSettings, Product, Quote, QuoteItem } from '../types';

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
    discount: Number(item.discount || 0)
});

const normalizeQuote = (q: Quote): Quote => ({
    ...q,
    discount: Number(q.discount || 0),
    items: (q.items || []).map(normalizeQuoteItem)
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

export default {
    auth: authApi,
    users: usersApi,
    clients: clientsApi,
    projects: projectsApi,
    tasks: tasksApi,
    entries: entriesApi,
    products: productsApi,
    quotes: quotesApi,
    settings: settingsApi,
    ldap: ldapApi,
    generalSettings: generalSettingsApi,
    setAuthToken,
    getAuthToken,
};
