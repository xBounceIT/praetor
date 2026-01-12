
export type UserRole = 'admin' | 'manager' | 'user';

export interface User {
  id: string;
  name: string;
  role: UserRole;
  avatarInitials: string;
  username: string;
  password?: string;
  costPerHour?: number;
  isDisabled?: boolean;
}

export interface GeneralSettings {
  currency: string;
  dailyLimit: number;
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
  enableAiInsights: boolean;
}

export interface Client {
  id: string;
  name: string;
  isDisabled?: boolean;
}

export interface Project {
  id: string;
  name: string;
  clientId: string;
  color: string;
  description?: string;
  isDisabled?: boolean;
}

export interface ProjectTask {
  id: string;
  name: string;
  projectId: string;
  description?: string;
  isRecurring?: boolean;
  recurrencePattern?: 'daily' | 'weekly' | 'monthly';
  recurrenceStart?: string;
  recurrenceEnd?: string;
  isDisabled?: boolean;
}

export interface TimeEntry {
  id: string;
  userId: string;
  date: string;
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  task: string;
  notes?: string;
  duration: number;
  hourlyCost: number;
  createdAt: number;
  isPlaceholder?: boolean;
}

export interface LdapRoleMapping {
  ldapGroup: string;
  tempoRole: UserRole;
}

export interface LdapConfig {
  enabled: boolean;
  serverUrl: string;
  baseDn: string;
  bindDn: string;
  bindPassword: string;
  userFilter: string;
  groupBaseDn: string;
  groupFilter: string;
  roleMappings: LdapRoleMapping[];
}

export type TrackerViewMode = 'daily' | 'weekly';

export type View = 'tracker' | 'reports' | 'projects' | 'tasks' | 'clients' | 'settings' | 'users' | 'recurring' | 'admin-auth' | 'administration-general';
