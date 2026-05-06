export type UserRole = string;
export type Permission = string;
export type EmployeeType = 'app_user' | 'internal' | 'external';
export type DiscountType = 'percentage' | 'currency';
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
  hasTopManagerRole?: boolean;
  isAdminOnly?: boolean;
  permissions?: Permission[];
  availableRoles?: RoleSummary[];
  avatarInitials: string;
  username: string;
  email?: string;
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
  createdAt?: number;
  isDisabled?: boolean;
  type?: 'individual' | 'company';
  contacts?: ClientContact[];
  contactName?: string;
  clientCode?: string;
  email?: string;
  phone?: string;
  address?: string;
  addressCountry?: string;
  addressState?: string;
  addressCap?: string;
  addressProvince?: string;
  addressCivicNumber?: string;
  addressLine?: string;
  description?: string;
  atecoCode?: string;
  website?: string;
  sector?: string | null;
  numberOfEmployees?: string | null;
  revenue?: string | null;
  fiscalCode?: string;
  officeCountRange?: string | null;
  totalSentQuotes?: number;
  totalAcceptedOrders?: number;
  // Legacy compatibility fields (mapped from fiscalCode by API)
  vatNumber?: string;
  taxCode?: string;
}

export interface ClientContact {
  fullName: string;
  role?: string;
  email?: string;
  phone?: string;
}

export type ClientProfileOptionCategory =
  | 'sector'
  | 'numberOfEmployees'
  | 'revenue'
  | 'officeCountRange';

export interface ClientProfileOption {
  id: string;
  category: ClientProfileOptionCategory;
  value: string;
  sortOrder: number;
  usageCount: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface ClientProfileOptionsByCategory {
  sector: ClientProfileOption[];
  numberOfEmployees: ClientProfileOption[];
  revenue: ClientProfileOption[];
  officeCountRange: ClientProfileOption[];
}

export interface Project {
  id: string;
  name: string;
  clientId: string;
  color: string;
  description?: string;
  isDisabled?: boolean;
  createdAt?: number;
  orderId?: string;
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
  expectedEffort?: number;
  revenue?: number;
  notes?: string;
  isDisabled?: boolean;
  createdAt?: number;
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
  taskId?: string | null;
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
  tlsCaCertificate: string;
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
  type: string; // User-managed product types
  supplierId?: string;
  supplierName?: string;
  isDisabled?: boolean;
  createdAt?: number;
}

export interface QuoteItem {
  id: string;
  quoteId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  productCost?: number;
  productMolPercentage?: number | null;
  // Supplier quote source tracking
  supplierQuoteId?: string | null;
  supplierQuoteItemId?: string | null;
  supplierQuoteSupplierName?: string | null;
  supplierQuoteUnitPrice?: number | null;
  discount?: number; // item-level discount percentage
  note?: string;
  unitType?: SupplierUnitType;
}

export interface Quote {
  id: string;
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
  discount: number;
  discountType: DiscountType;
  status: 'draft' | 'sent' | 'accepted' | 'denied';
  expirationDate: string; // YYYY-MM-DD date-only string
  isExpired?: boolean;
  linkedOfferId?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type QuoteVersionReason = 'update' | 'restore';

export interface QuoteVersionSnapshot {
  schemaVersion: 1;
  quote: Omit<Quote, 'items' | 'isExpired' | 'linkedOfferId'>;
  items: QuoteItem[];
}

export interface QuoteVersionRow {
  id: string;
  quoteId: string;
  reason: QuoteVersionReason;
  createdByUserId: string | null;
  createdAt: number;
}

export interface QuoteVersion extends QuoteVersionRow {
  snapshot: QuoteVersionSnapshot;
}

export interface ClientOfferItem {
  id: string;
  offerId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  productCost?: number;
  productMolPercentage?: number | null;
  // Supplier quote source tracking
  supplierQuoteId?: string | null;
  supplierQuoteItemId?: string | null;
  supplierQuoteSupplierName?: string | null;
  supplierQuoteUnitPrice?: number | null;
  discount?: number;
  note?: string;
  unitType?: SupplierUnitType;
}

export interface ClientOffer {
  id: string;
  linkedQuoteId: string;
  clientId: string;
  clientName: string;
  items: ClientOfferItem[];
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
  discountType: DiscountType;
  status: 'draft' | 'sent' | 'accepted' | 'denied';
  expirationDate: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type OfferVersionReason = 'update' | 'restore';

export interface OfferVersionSnapshot {
  schemaVersion: 1;
  offer: Omit<ClientOffer, 'items'>;
  items: ClientOfferItem[];
}

export interface OfferVersionRow {
  id: string;
  offerId: string;
  reason: OfferVersionReason;
  createdByUserId: string | null;
  createdAt: number;
}

export interface OfferVersion extends OfferVersionRow {
  snapshot: OfferVersionSnapshot;
}

export interface ClientsOrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  productCost?: number;
  productMolPercentage?: number | null;
  // Supplier quote source tracking
  supplierQuoteId?: string | null;
  supplierQuoteItemId?: string | null;
  supplierQuoteSupplierName?: string | null;
  supplierQuoteUnitPrice?: number | null;
  supplierSaleId?: string | null;
  supplierSaleItemId?: string | null;
  supplierSaleSupplierName?: string | null;
  discount?: number;
  note?: string;
  unitType?: SupplierUnitType;
}

export interface ClientsOrder {
  id: string;
  linkedQuoteId?: string; // Reference to source quote
  linkedOfferId?: string;
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
  discountType: DiscountType;
  status: 'draft' | 'confirmed' | 'denied';
  notes?: string;
  createdAt: number;
  updatedAt: number;
  warnings?: string[];
}

export type View =
  // Timesheets module
  | 'timesheets/tracker'
  | 'timesheets/recurring'
  // Administration module
  | 'administration/authentication'
  | 'administration/general'
  | 'administration/user-management'
  | 'administration/email'
  | 'administration/roles'
  | 'administration/logs'
  // CRM module
  | 'crm/clients'
  | 'crm/suppliers'
  // Sales module
  | 'sales/client-quotes'
  | 'sales/client-offers'
  | 'sales/supplier-quotes'
  // Catalog module
  | 'catalog/internal-listing'
  // Accounting module
  | 'accounting/clients-orders'
  | 'accounting/clients-invoices'
  | 'accounting/supplier-orders'
  | 'accounting/supplier-invoices'
  // Projects module
  | 'projects/manage'
  | 'projects/tasks'
  // HR module
  | 'hr/internal'
  | 'hr/external'
  | 'hr/work-units'
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

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  username: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string;
  createdAt: number;
  details: AuditLogDetails | null;
}

export interface AuditLogDetails {
  targetLabel?: string;
  secondaryLabel?: string;
  changedFields?: string[];
  counts?: Record<string, number>;
  fromValue?: string;
  toValue?: string;
}

export interface ReportChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  thoughtContent?: string;
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
  unitOfMeasure: 'unit' | 'hours';
  quantity: number;
  unitPrice: number;
  discount?: number;
}

export interface Invoice {
  id: string;
  linkedOrderId?: string;
  linkedSaleId?: string;
  clientId: string;
  clientName: string;
  issueDate: string;
  dueDate: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  subtotal: number;
  total: number;
  amountPaid: number;
  notes?: string;
  items: InvoiceItem[];
  createdAt: number;
  updatedAt: number;
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
  createdAt?: number;
}

export type SupplierUnitType = 'hours' | 'days' | 'unit';

export interface SupplierQuoteItem {
  id: string;
  quoteId: string;
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  note?: string;
  unitType?: SupplierUnitType;
}

export interface SupplierQuote {
  id: string;
  supplierId: string;
  supplierName: string;
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
  status: 'draft' | 'sent' | 'accepted' | 'denied';
  expirationDate: string;
  linkedOrderId?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type SupplierQuoteVersionReason = 'update' | 'restore';

export interface SupplierQuoteVersionSnapshot {
  schemaVersion: 1;
  quote: Omit<SupplierQuote, 'items' | 'linkedOrderId'>;
  items: SupplierQuoteItem[];
}

export interface SupplierQuoteVersionRow {
  id: string;
  quoteId: string;
  reason: SupplierQuoteVersionReason;
  createdByUserId: string | null;
  createdAt: number;
}

export interface SupplierQuoteVersion extends SupplierQuoteVersionRow {
  snapshot: SupplierQuoteVersionSnapshot;
}

export interface SupplierSaleOrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  note?: string;
}

export interface SupplierSaleOrder {
  id: string;
  linkedQuoteId?: string;
  supplierId: string;
  supplierName: string;
  items: SupplierSaleOrderItem[];
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
  discountType: DiscountType;
  status: 'draft' | 'sent';
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type SupplierOrderVersionReason = 'update' | 'restore';

export interface SupplierOrderVersionSnapshot {
  schemaVersion: 1;
  order: Omit<SupplierSaleOrder, 'items'>;
  items: SupplierSaleOrderItem[];
}

export interface SupplierOrderVersionRow {
  id: string;
  orderId: string;
  reason: SupplierOrderVersionReason;
  createdByUserId: string | null;
  createdAt: number;
}

export interface SupplierOrderVersion extends SupplierOrderVersionRow {
  snapshot: SupplierOrderVersionSnapshot;
}

export interface SupplierInvoiceItem {
  id: string;
  invoiceId: string;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
}

export interface SupplierInvoice {
  id: string;
  linkedOrderId?: string;
  linkedSaleId?: string;
  supplierId: string;
  supplierName: string;
  issueDate: string;
  dueDate: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  subtotal: number;
  total: number;
  amountPaid: number;
  notes?: string;
  items: SupplierInvoiceItem[];
  createdAt: number;
  updatedAt: number;
}
