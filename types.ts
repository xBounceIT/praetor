
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
  geminiApiKey?: string;
}

export interface Client {
  id: string;
  name: string;
  isDisabled?: boolean;
  type?: 'individual' | 'company';
  contactName?: string;
  clientCode?: string;
  email?: string;
  phone?: string;
  address?: string;
  vatNumber?: string;
  taxCode?: string;
  billingCode?: string;
  paymentTerms?: string;
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
  recurrencePattern?: 'daily' | 'weekly' | 'monthly' | string;
  recurrenceStart?: string;
  recurrenceEnd?: string;
  recurrenceDuration?: number;
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

export interface Product {
  id: string;
  name: string;
  salePrice: number;
  saleUnit: 'unit' | 'hours';
  cost: number;
  costUnit: 'unit' | 'hours';
  category?: string;
  taxRate: number;
  type: 'item' | 'service';
  isDisabled?: boolean;
}

export interface QuoteItem {
  id: string;
  quoteId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount?: number; // item-level discount percentage
}

export interface Quote {
  id: string;
  clientId: string;
  clientName: string;
  items: QuoteItem[];
  paymentTerms: 'immediate' | '15gg' | '21gg' | '30gg' | '45gg';
  discount: number; // global discount percentage
  status: 'quoted' | 'confirmed';
  expirationDate: string; // ISO date string
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type View =
  // Tempo module
  | 'tempo/tracker'
  | 'tempo/reports'
  | 'tempo/recurring'
  | 'tempo/tasks'
  | 'tempo/projects'
  // Configuration module (admin)
  | 'configuration/authentication'
  | 'configuration/general'
  // CRM module
  | 'crm/clients'
  | 'crm/products'
  | 'crm/quotes'
  // HR module
  | 'hr/workforce'
  | 'hr/work-units'
  // Projects module
  | 'projects/manage'
  | 'projects/tasks'
  // Standalone
  | 'settings';

export interface WorkUnit {
  id: string;
  name: string;
  managerId: string;
  managerName?: string;
  description?: string;
  isDisabled?: boolean;
  userCount?: number;
}
