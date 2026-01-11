/**
 * API Service Layer
 * Replaces localStorage with REST API calls to the backend server
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

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

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
};

// Types for API responses
import type { User, Client, Project, ProjectTask, TimeEntry, LdapConfig } from '../types';

export interface LoginResponse {
    token: string;
    user: User;
}

export interface Settings {
    fullName: string;
    email: string;
    dailyGoal: number;
    startOfWeek: 'Monday' | 'Sunday';
    enableAiInsights: boolean;
    compactView: boolean;
    treatSaturdayAsHoliday: boolean;
}

// Auth API
export const authApi = {
    login: (username: string, password: string): Promise<LoginResponse> =>
        fetchApi('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        }),

    me: (): Promise<User> => fetchApi('/auth/me'),
};

// Users API
export const usersApi = {
    list: (): Promise<User[]> => fetchApi('/users'),

    create: (name: string, username: string, password: string, role: string): Promise<User> =>
        fetchApi('/users', {
            method: 'POST',
            body: JSON.stringify({ name, username, password, role }),
        }),

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
        fetchApi(`/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }),
};

// Clients API
export const clientsApi = {
    list: (): Promise<Client[]> => fetchApi('/clients'),

    create: (name: string): Promise<Client> =>
        fetchApi('/clients', {
            method: 'POST',
            body: JSON.stringify({ name }),
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
    list: (): Promise<ProjectTask[]> => fetchApi('/tasks'),

    create: (name: string, projectId: string, description?: string, isRecurring?: boolean, recurrencePattern?: string): Promise<ProjectTask> =>
        fetchApi('/tasks', {
            method: 'POST',
            body: JSON.stringify({ name, projectId, description, isRecurring, recurrencePattern }),
        }),

    update: (id: string, updates: Partial<ProjectTask>): Promise<ProjectTask> =>
        fetchApi(`/tasks/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }),

    delete: (id: string): Promise<void> =>
        fetchApi(`/tasks/${id}`, { method: 'DELETE' }),
};

// Time Entries API
export const entriesApi = {
    list: (userId?: string): Promise<TimeEntry[]> =>
        fetchApi(userId ? `/entries?userId=${userId}` : '/entries'),

    create: (entry: Omit<TimeEntry, 'id' | 'createdAt'>): Promise<TimeEntry> =>
        fetchApi('/entries', {
            method: 'POST',
            body: JSON.stringify(entry),
        }),

    update: (id: string, updates: Partial<TimeEntry>): Promise<TimeEntry> =>
        fetchApi(`/entries/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }),

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

export default {
    auth: authApi,
    users: usersApi,
    clients: clientsApi,
    projects: projectsApi,
    tasks: tasksApi,
    entries: entriesApi,
    settings: settingsApi,
    ldap: ldapApi,
    setAuthToken,
    getAuthToken,
};
