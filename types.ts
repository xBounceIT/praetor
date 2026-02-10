export type UserRole = string;
export type Permission = string;
export type EmployeeType = 'app_user' | 'internal' | 'external';
export type TimeEntryLocation = 'office' | 'customer_premise' | 'remote' | 'transfer';

export interface RoleSummary {
  id: string;
  name: string;
  isSystem?: boolean;
  isAdmin?: boolean;
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  permissions?: Permission[];
  availableRoles?: RoleSummary[];
  avatarInitials: string;
  username: string;
  password?: string;
  costPerHour?: number;
  isDisabled?: boolean;
  employeeType?: EmployeeType;
}

export interface Role {
  id: string;
  name: string;
  isSystem: boolean;
  isAdmin: boolean;
  permissions: Permission[];
}

export interface UserSettings {
  fullName: string;
  email: string;
  language?: 'en' | 'it' | 'auto';
}

export interface Notification {
  id: string;
  userId: string;
  type: 'new_projects' | string;
  title: string;
  message?: string;
  data?: {
    projectNames?: string[];
    orderId?: string;
    clientName?: string;
    [key: string]: unknown;
  };
  isRead: boolean;
  createdAt: number;
}

export interface GeneralSettings {
  currency: string;
  dailyLimit: number;
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
  enableAiInsights: boolean;
  enableAiSmartEntry: boolean;
  enableAiReporting: boolean;
  geminiApiKey?: string;
  aiProvider?: 'gemini' | 'openrouter';
  openrouterApiKey?: string;
  geminiModelId?: string;
  openrouterModelId?: string;
  allowWeekendSelection: boolean;
  defaultLocation?: TimeEntryLocation;
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
  location?: TimeEntryLocation;
}

export interface LdapRoleMapping {
  ldapGroup: string;
  role: string;
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

export type SmtpEncryption = 'insecure' | 'ssl' | 'tls';

export interface EmailConfig {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpEncryption: SmtpEncryption;
  smtpRejectUnauthorized: boolean;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
}

export type TrackerViewMode = 'daily' | 'weekly';

export interface Product {
  id: string;
  name: string;
  productCode: string;
  description?: string;
  costo: number;
  molPercentage: number;
  costUnit: 'unit' | 'hours';
  category?: string;
  subcategory?: string;
  taxRate: number;
  type: 'item' | 'service' | 'supply' | 'consulting'; // 'item' kept for backward compatibility if needed, but we migrated it.
  // Actually we migrated item->supply, so strict type should be:
  // type: 'supply' | 'service' | 'consulting';
  // However, frontend might still send 'item' temporarily if I don't update it fully at once.
  // But I will update frontend. So let's force the new types.
  // Wait, I should probably keep 'item' loosely in type definition or mapped?
  // No, let's go with the new types.
  supplierId?: string;
  supplierName?: string;
  isDisabled?: boolean;
}

export interface SpecialBid {
  id: string;
  clientId: string;
  clientName: string;
  productId: string;
  productName: string;
  unitPrice: number;
  molPercentage?: number;
  startDate: string;
  endDate: string;
  createdAt: number;
  updatedAt: number;
}

export interface QuoteItem {
  id: string;
  quoteId: string;
  productId: string;
  productName: string;
  specialBidId?: string;
  quantity: number;
  unitPrice: number;
  productCost?: number;
  productTaxRate?: number;
  productMolPercentage?: number | null;
  specialBidUnitPrice?: number | null;
  specialBidMolPercentage?: number | null;
  discount?: number; // item-level discount percentage
  note?: string;
}

export interface Quote {
  id: string;
  quoteCode: string;
  clientId: string;
  clientName: string;
  items: QuoteItem[];
  paymentTerms:
    | 'immediate'
    | '15gg'
    | '21gg'
    | '30gg'
    | '45gg'
    | '60gg'
    | '90gg'
    | '120gg'
    | '180gg'
    | '240gg'
    | '365gg';
  discount: number; // global discount percentage
  status: 'draft' | 'sent' | 'accepted' | 'denied';
  expirationDate: string; // ISO date string
  isExpired?: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClientsOrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  specialBidId?: string;
  quantity: number;
  unitPrice: number;
  productCost?: number;
  productTaxRate?: number;
  productMolPercentage?: number | null;
  specialBidUnitPrice?: number | null;
  specialBidMolPercentage?: number | null;
  discount?: number;
  note?: string;
}

export interface ClientsOrder {
  id: string;
  linkedQuoteId?: string; // Reference to source quote
  clientId: string;
  clientName: string;
  items: ClientsOrderItem[];
  paymentTerms:
    | 'immediate'
    | '15gg'
    | '21gg'
    | '30gg'
    | '45gg'
    | '60gg'
    | '90gg'
    | '120gg'
    | '180gg'
    | '240gg'
    | '365gg';
  discount: number;
  status: 'draft' | 'sent' | 'confirmed' | 'denied';
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type View =
  // Timesheets module
  | 'timesheets/tracker'
  | 'timesheets/recurring'
  // Administration module (admin/manager)
  | 'administration/authentication'
  | 'administration/general'
  | 'administration/user-management'
  | 'administration/work-units'
  | 'administration/email'
  | 'administration/roles'
  // CRM module
  | 'crm/clients'
  | 'crm/suppliers'
  // Sales module
  | 'sales/client-quotes'
  // Catalog module
  | 'catalog/internal-listing'
  | 'catalog/external-listing'
  | 'catalog/special-bids'
  // Accounting module
  | 'accounting/clients-orders'
  | 'accounting/clients-invoices'
  // Finances module
  | 'finances/payments'
  | 'finances/expenses'
  // HR module (Deprecated/Moved)
  // | 'hr/workforce'
  // | 'hr/work-units'
  // Projects module
  | 'projects/manage'
  | 'projects/tasks'
  // Suppliers module
  | 'suppliers/manage'
  | 'suppliers/quotes'
  // HR module
  | 'hr/internal'
  | 'hr/external'
  // Reports module
  | 'reports/ai-reporting'
  // Standalone
  | 'settings'
  | 'docs/api'
  | 'docs/frontend';

export interface ReportChatSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReportChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface WorkUnit {
  id: string;
  name: string;
  managers: { id: string; name: string }[];
  description?: string;
  isDisabled?: boolean;
  userCount?: number;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discount?: number;
}

export interface Invoice {
  id: string;
  linkedOrderId?: string;
  clientId: string;
  clientName: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  subtotal: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  notes?: string;
  items: InvoiceItem[];
  createdAt: number;
  updatedAt: number;
}

export interface Payment {
  id: string;
  invoiceId?: string;
  clientId: string;
  clientName?: string;
  amount: number;
  paymentDate: string;
  paymentMethod: 'cash' | 'bank_transfer' | 'credit_card' | 'check' | 'other';
  reference?: string;
  notes?: string;
  createdAt: number;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  expenseDate: string;
  category: 'travel' | 'office_supplies' | 'software' | 'marketing' | 'utilities' | 'other';
  vendor?: string;
  receiptReference?: string;
  notes?: string;
  createdAt: number;
}

export interface Supplier {
  id: string;
  name: string;
  isDisabled?: boolean;
  supplierCode?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  vatNumber?: string;
  taxCode?: string;
  paymentTerms?: string;
  notes?: string;
}

export interface SupplierQuoteItem {
  id: string;
  quoteId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  note?: string;
}

export interface SupplierQuote {
  id: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderNumber: string;
  items: SupplierQuoteItem[];
  paymentTerms:
    | 'immediate'
    | '15gg'
    | '21gg'
    | '30gg'
    | '45gg'
    | '60gg'
    | '90gg'
    | '120gg'
    | '180gg'
    | '240gg'
    | '365gg';
  discount: number;
  status: 'received' | 'approved' | 'rejected';
  expirationDate: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}
