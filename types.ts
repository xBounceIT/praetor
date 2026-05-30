// Built-in system role identifiers. Custom roles may exist in the DB (the `roles` table
// stores arbitrary varchar(50) ids), so `UserRole` is a union of known literals plus a
// `string & {}` escape hatch. This preserves autocomplete and catches typos like `'amdin'`
// for the built-in roles while still accepting custom role ids at runtime boundaries.
export type KnownUserRole = 'admin' | 'manager' | 'user' | 'top_manager';
export type UserRole = KnownUserRole | (string & {});

// Built-in permission identifiers follow the `<resource>.<action>` convention defined in
// `utils/permissions.ts`. Custom permissions can technically be stored in the DB, so this
// type mirrors the `UserRole` pattern: a literal union of the canonical set plus a
// `string & {}` escape hatch.
export type KnownPermissionResource =
  | 'timesheets.tracker'
  | 'timesheets.recurring'
  | 'timesheets.tracker_all'
  | 'crm.clients'
  | 'crm.clients_all'
  | 'crm.suppliers'
  | 'crm.suppliers_all'
  | 'sales.client_quotes'
  | 'sales.client_offers'
  | 'sales.supplier_quotes'
  | 'catalog.internal_listing'
  | 'accounting.clients_orders'
  | 'accounting.clients_invoices'
  | 'accounting.supplier_orders'
  | 'accounting.supplier_invoices'
  | 'projects.manage'
  | 'projects.manage_all'
  | 'projects.tasks'
  | 'projects.tasks_all'
  | 'projects.assignments'
  | 'hr.internal'
  | 'hr.external'
  | 'hr.costs'
  | 'hr.costs_all'
  | 'hr.employee_assignments'
  | 'hr.work_units'
  | 'hr.work_units_all'
  | 'reports.ai_reporting'
  | 'administration.authentication'
  | 'administration.general'
  | 'administration.user_management'
  | 'administration.user_management_all'
  | 'administration.email'
  | 'administration.roles'
  | 'administration.logs'
  | 'settings'
  | 'docs.api'
  | 'docs.frontend'
  | 'notifications';
export type KnownPermissionAction = 'view' | 'create' | 'update' | 'delete';
export type KnownPermission = `${KnownPermissionResource}.${KnownPermissionAction}`;
export type Permission = KnownPermission | (string & {});
export type EmployeeType = 'app_user' | 'internal' | 'external';
export type UserAuthMethod = 'local' | 'ldap' | 'oidc' | 'saml';
export type DiscountType = 'percentage' | 'currency';
export type TimeEntryLocation = 'office' | 'customer_premise' | 'remote' | 'transfer';
export type StoredBillingType = 'retainer' | 'time_and_materials';
export type BillingType = StoredBillingType | 'mixed';
export type BillingFrequency = 'monthly' | 'one_time';

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
  authMethod?: UserAuthMethod;
  authProviderId?: string | null;
  authProviderName?: string | null;
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
  rilCompanyName?: string;
  rilDefaultStartTime?: string;
  rilLunchBreakMinutes?: number;
}

export interface Client {
  id: string;
  name: string;
  createdAt?: number;
  isDisabled?: boolean;
  type?: 'individual' | 'company';
  contacts?: ClientContact[];
  contactName?: string | null;
  clientCode?: string;
  email?: string | null;
  phone?: string | null;
  address?: string;
  addressCountry?: string;
  addressState?: string;
  addressCap?: string;
  addressProvince?: string;
  addressCivicNumber?: string;
  addressLine?: string;
  description?: string | null;
  atecoCode?: string | null;
  website?: string | null;
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
  offerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  revenue?: number | null;
  billingType?: BillingType;
  billingFrequency?: BillingFrequency;
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
  monthlyEffort?: number;
  revenue?: number;
  notes?: string;
  isDisabled?: boolean;
  createdAt?: number;
  billingType?: StoredBillingType;
  billingFrequency?: BillingFrequency;
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
  // `hourlyCost` and `cost` are stripped server-side when the caller lacks
  // `reports.cost.view` - components must treat them as optional and fall back when
  // missing rather than assuming both are always present.
  hourlyCost?: number;
  cost?: number;
  createdAt: number;
  version: number;
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
  autoProvisionAll: boolean;
  provisionOnLogin: boolean;
}

// Discriminates which branch of the LDAP-login role-assignment logic would fire for the
// tester input, so the UI can stop misreporting DEFAULT_ROLE_ID for existing users whose
// admin-assigned role would actually be preserved on real login (#638). `rejected` covers
// disabled / non-`app_user` rows that real login would reject at the eligibility guard
// before any role assignment runs.
export type LdapRoleResolution = 'matched' | 'preserved' | 'default' | 'rejected' | 'none';

export interface LdapTestResponse {
  success: boolean;
  authenticated: boolean;
  username: string;
  message: string;
  userDn?: string;
  groups: string[];
  roleIds: string[];
  roleResolution: LdapRoleResolution;
}

export type SsoProtocol = 'oidc' | 'saml';

export interface SsoRoleMapping {
  externalGroup: string;
  role: string;
}

export interface SsoProvider {
  id: string;
  protocol: SsoProtocol;
  slug: string;
  name: string;
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  metadataUrl: string;
  metadataXml: string;
  entryPoint: string;
  idpIssuer: string;
  idpCert: string;
  spIssuer: string;
  privateKey: string;
  publicCert: string;
  usernameAttribute: string;
  nameAttribute: string;
  emailAttribute: string;
  groupsAttribute: string;
  roleMappings: SsoRoleMapping[];
  endSessionEnabled: boolean;
}

export type PublicSsoProvider = Pick<SsoProvider, 'protocol' | 'slug' | 'name'>;

// Stable codes carried by `?sso_error=<code>` after a failed SSO callback. The frontend uses this
// list to allow-list the URL param and look up a translation key.
// Must stay aligned with `SSO_LOGIN_ERROR_CODES` in `server/services/sso.ts` — the server
// tsconfig's rootDir prevents importing across the boundary, so the two definitions live
// side-by-side. An unknown code from the server falls back to the `generic` translation.
export const SSO_LOGIN_ERROR_CODES = [
  'invalid_state',
  'invalid_response',
  'provider_disabled',
  'provider_misconfigured',
  'account_disabled',
  'identity_conflict',
  'generic',
] as const;

export type SsoLoginErrorCode = (typeof SSO_LOGIN_ERROR_CODES)[number];

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
  deliveryDate: string | null;
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

export type OrderVersionReason = 'update' | 'restore';

export interface OrderVersionSnapshot {
  schemaVersion: 1;
  order: Omit<ClientsOrder, 'items' | 'linkedQuoteId' | 'linkedOfferId' | 'warnings'>;
  items: ClientsOrderItem[];
}

export interface OrderVersionRow {
  id: string;
  orderId: string;
  reason: OrderVersionReason;
  createdByUserId: string | null;
  createdAt: number;
}

export interface OrderVersion extends OrderVersionRow {
  snapshot: OrderVersionSnapshot;
}

export type View =
  // Timesheets module
  | 'timesheets/tracker'
  | 'timesheets/ril'
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
  | 'docs'
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
  reason?: string;
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
  // Per-item Italian VAT (IVA) rate in percent. 0 for exempt or pre-tax-feature data.
  taxRate?: number;
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
  taxTotal: number;
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

export interface SupplierQuoteAttachment {
  id: string;
  quoteId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedByUserId: string | null;
  createdAt: number;
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

// Canonical list of `entityType` values written by `logAudit`/`replyError`. Mirrored from
// `server/utils/audit.ts`'s `AUDIT_ENTITY_TYPES`; the two MUST stay in sync. A drift check
// runs in `test/types/auditEntityTypes.test.ts`.
export const AUDIT_ENTITY_TYPES = [
  'auth',
  'route',
  'client',
  'client_offer',
  'client_order',
  'client_profile_option',
  'client_quote',
  'email_config',
  'invoice',
  'ldap',
  'ldap_config',
  'mcp_token',
  'notification',
  'product',
  'product_category',
  'product_subcategory',
  'product_type',
  'project',
  'reports_ai',
  'reports_ai_message',
  'reports_ai_session',
  'role',
  'settings',
  'sso_provider',
  'supplier',
  'supplier_invoice',
  'supplier_order',
  'supplier_quote',
  'supplier_quote_attachment',
  'task',
  'user',
  'work_unit',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
