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
  | 'timesheets.ril'
  | 'timesheets.recurring'
  | 'timesheets.tracker_all'
  | 'timesheets.expired_projects'
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
  | 'projects.resales'
  | 'projects.tasks'
  | 'projects.tasks_all'
  | 'projects.rules'
  | 'projects.assignments'
  | 'hr.internal'
  | 'hr.external'
  | 'hr.costs'
  | 'hr.costs_all'
  | 'hr.employee_assignments'
  | 'hr.work_units'
  | 'hr.work_units_all'
  | 'reports.ai_reporting'
  | 'reports.cost'
  | 'administration.authentication'
  | 'administration.general'
  | 'administration.user_management'
  | 'administration.user_management_all'
  | 'administration.email'
  | 'administration.roles'
  | 'administration.logs'
  | 'administration.webhooks'
  | 'settings'
  | 'docs.api'
  | 'docs.frontend'
  | 'notifications';
export type KnownPermissionAction = 'view' | 'create' | 'update' | 'delete';
export type KnownPermission = `${KnownPermissionResource}.${KnownPermissionAction}`;
export type Permission = KnownPermission | (string & {});
export type EmployeeType = 'app_user' | 'internal' | 'external';
export type UserAuthMethod = 'local' | 'ldap' | 'oidc' | 'saml';
export type UserContractType =
  | 'permanent'
  | 'fixed_term'
  | 'contractor'
  | 'internship'
  | 'consultant'
  | 'other';
export type UserEmploymentStatus = 'active' | 'onboarding' | 'on_leave' | 'terminated';
export type UserWorkLocation = 'office' | 'remote' | 'hybrid' | 'customer_site' | 'other';
export type DiscountType = 'percentage' | 'currency';
export type TimeEntryLocation = 'office' | 'customer_premise' | 'remote' | 'transfer';
export type StoredBillingType = 'retainer' | 'time_and_materials';
export type BillingType = StoredBillingType | 'mixed';
export type BillingFrequency = 'monthly' | 'one_time';
// Project `tipo` (issue #784): mandatory active/passive classification, kept in sync with the
// server `PROJECT_TIPOS` allow-list in server/utils/projectTipo.ts.
export const PROJECT_TIPOS = ['attivo', 'passivo'] as const;
export type ProjectTipo = (typeof PROJECT_TIPOS)[number];

export const PROJECT_STATUSES = ['da_fare', 'in_corso', 'in_pausa', 'terminato'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const DEFAULT_PROJECT_STATUS: ProjectStatus = 'da_fare';
export const LEGACY_PROJECT_STATUS: ProjectStatus = 'in_corso';

export interface RilNoteOption {
  value: string;
  label: string;
}

export interface RoleSummary {
  id: string;
  name: string;
  isSystem?: boolean;
  isAdmin?: boolean;
}

export interface User {
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
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
  phone?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  responsibleUserId?: string | null;
  responsibleUserName?: string | null;
  employeeCode?: string | null;
  hireDate?: string | null;
  terminationDate?: string | null;
  contractType?: UserContractType | null;
  employmentStatus?: UserEmploymentStatus | null;
  workLocation?: UserWorkLocation | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  address?: string | null;
  notes?: string | null;
  authMethod?: UserAuthMethod;
  authProviderId?: string | null;
  authProviderName?: string | null;
}

export type MfaExemptionUser = Pick<User, 'id' | 'name' | 'username' | 'avatarInitials'> & {
  isDisabled?: boolean;
};

export interface ResponsibleUserOption {
  id: string;
  name: string;
  username: string;
  avatarInitials: string;
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
  type: 'new_projects' | 'project_rule_triggered' | string;
  title: string;
  message?: string;
  data?: {
    projectNames?: string[];
    orderId?: string;
    clientName?: string;
    projectId?: string;
    projectName?: string;
    ruleId?: string;
    ruleName?: string;
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
  rilDefaultExitTime?: string;
  rilLunchBreakMinutes?: number;
  rilNoteOptions?: RilNoteOption[];
  rilTransferOptions?: string[];
  // 2FA org policy. `enableTotp` is the global feature switch; `enforceTotp` the master enforcement
  // switch; the role/user-id lists scope enforcement (empty enforced list = everyone; exempt wins).
  enableTotp: boolean;
  enforceTotp: boolean;
  totpEnforcedRoleIds: string[];
  totpExemptRoleIds: string[];
  totpExemptUserIds: string[];
  sessionIdleTimeoutMinutes: number;
}

export type DocumentCodeModuleId =
  | 'client_quote'
  | 'client_offer'
  | 'supplier_quote'
  | 'client_order'
  | 'supplier_order'
  | 'client_invoice'
  | 'supplier_invoice';

export interface DocumentCodeTemplate {
  moduleId: DocumentCodeModuleId;
  label: string;
  prefix: string;
  template: string;
  sequencePadding: number;
  preview: string;
}

export interface DocumentCodePreview {
  moduleId: DocumentCodeModuleId;
  preview: string;
  year: number;
  sequence: number;
}

// App-wide branding shown in the sidebar and on the login screen. `companyName` replaces
// the "PRAETOR" wordmark; `logoUrl` (when set) replaces the bundled logo. Both fall back
// to the bundled Praetor defaults when null. `logoUrl` is a ready-to-render, cache-busted
// URL derived client-side from the branding API response.
export interface AppBranding {
  companyName: string | null;
  logoUrl: string | null;
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
  description?: string;
  isDisabled?: boolean;
  createdAt?: number;
  orderId?: string | null;
  offerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  revenue?: number | null;
  billingType?: BillingType;
  billingFrequency?: BillingFrequency;
  status?: ProjectStatus;
  tipo?: ProjectTipo;
  // False until a user explicitly confirms `tipo`. Rollout-defaulted projects start false so the
  // edit form can force a deliberate first choice; projects created in-app are true (issue #784).
  tipoConfirmed?: boolean;
}

/** Minimal project data needed to derive the order codes shown in a RIL sheet. */
export type RilProjectReference = Pick<Project, 'id' | 'name'> & {
  orderId: string | null;
};

export const RESALE_BILLING_FREQUENCIES = ['monthly', 'quarterly', 'annual', 'one_time'] as const;
export type ResaleBillingFrequency = (typeof RESALE_BILLING_FREQUENCIES)[number];

export interface ResaleCategory {
  id: string;
  name: string;
  createdAt?: number | null;
  updatedAt?: number | null;
  activityCount?: number;
  hasLinkedActivities?: boolean;
}

export interface ResaleActivity {
  id: string;
  resaleId: string;
  name: string;
  billingFrequency: ResaleBillingFrequency;
  categoryId: string;
  categoryName: string;
  cost: number;
  revenue: number;
  released: boolean;
  dueDate: string | null;
  notes: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface Resale {
  id: string;
  clientOrderId: string;
  supplierOrderId: string;
  clientName: string;
  supplierName: string;
  supplierOrderCost: number;
  activityCostTotal: number;
  resaleRevenue: number;
  costVariance: number;
  startDate: string | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  activities: ResaleActivity[];
}

export interface ResaleOrderOption {
  clientOrderId: string;
  clientName: string;
  supplierOrders: Array<{
    id: string;
    supplierName: string;
    total: number;
  }>;
}

export type ProjectRuleActionType = 'notify' | 'webhook';

export type ProjectRuleNotifyRecipientType = 'user' | 'role';

export type ProjectRuleNotifyAction =
  | {
      type: 'notify';
      recipientType: 'user';
      recipientUserIds: string[];
    }
  | {
      type: 'notify';
      recipientType: 'role';
      recipientRoleIds: string[];
    };

export interface ProjectRuleWebhookAction {
  type: 'webhook';
  webhookId: string;
}

export type ProjectRuleAction = ProjectRuleNotifyAction | ProjectRuleWebhookAction;

export interface ProjectRuleActionConfig {
  recipientUserIds: string[];
  recipientRoleIds: string[];
  webhookIds: string[];
  actions: ProjectRuleAction[];
}

export type ProjectRuleConditionLogic = 'and' | 'or';
export type ProjectRuleConditionValueType = 'literal' | 'field';

export interface ProjectRuleCondition {
  field: string;
  operator: string;
  value: string;
  valueType: ProjectRuleConditionValueType;
}

export interface ProjectRule {
  id: string;
  projectId: string;
  name: string;
  field: string;
  operator: string;
  value: string;
  conditionLogic: ProjectRuleConditionLogic;
  conditions: ProjectRuleCondition[];
  actionType: ProjectRuleActionType;
  actionConfig: ProjectRuleActionConfig;
  isEnabled: boolean;
  conditionMet: boolean;
  lastTriggeredAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectRuleRecipientUser {
  id: string;
  name: string;
  username: string;
  avatarInitials: string;
}

export interface ProjectRuleRecipientOptions {
  users: ProjectRuleRecipientUser[];
  roles: RoleSummary[];
  webhooks: Array<{
    id: string;
    name: string;
  }>;
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
  duration?: number;
  revenue?: number;
  totalRevenue?: number;
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
  firstNameAttribute: string;
  lastNameAttribute: string;
  emailAttribute: string;
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
  firstName?: string;
  lastName?: string;
  email?: string;
  groups: string[];
  roleIds: string[];
  roleResolution: LdapRoleResolution;
}

export interface LdapSyncResponse {
  success: boolean;
  synced?: number;
  created?: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
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
  // Pick-time supplier values (request-only; the server never persists or returns them): the
  // genuine-edit baseline for a fresh link, stamped by refreshedSupplierLineFields at
  // pick/refresh time so a pre-save quantity/cost edit pushes onto the supplier item.
  supplierQuoteBaseQuantity?: number | null;
  supplierQuoteBaseUnitPrice?: number | null;
  discount?: number; // item-level discount percentage (0–100)
  note?: string;
  unitType?: SupplierUnitType;
  durationMonths?: number; // months the service runs; multiplies cost & revenue (issue #757)
  durationUnit?: DurationUnit; // display unit: 'months' (default), 'years', or 'na' (N/A, no duration)
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
  // Stored pipeline status. `offer` (Offerta) is a manual status between sent and accepted (#779).
  status: 'draft' | 'sent' | 'offer' | 'accepted' | 'denied';
  // Effective status from the server: the stored status with the derived `expired` overlay (#779).
  effectiveStatus?: 'draft' | 'sent' | 'offer' | 'accepted' | 'denied' | 'expired';
  expirationDate: string; // YYYY-MM-DD date-only string
  communicationChannelId?: string;
  communicationChannelName?: string;
  isExpired?: boolean;
  linkedOfferId?: string;
  // 1-to-1 link to a supplier quote, set from the client-quote form (#779). `null`/absent = unlinked.
  linkedSupplierQuoteId?: string | null;
  // True when the linked supplier quote has expired — blocks progression to sent/offer/accepted.
  linkedSupplierQuoteExpired?: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type QuoteVersionReason = 'update' | 'restore';

export interface QuoteVersionSnapshot {
  schemaVersion: 1;
  quote: Omit<
    Quote,
    | 'items'
    | 'isExpired'
    | 'linkedOfferId'
    | 'effectiveStatus'
    | 'linkedSupplierQuoteId'
    | 'linkedSupplierQuoteExpired'
    | 'communicationChannelId'
    | 'communicationChannelName'
  > & {
    communicationChannelId?: string;
    communicationChannelName?: string;
  };
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
  // Pick-time supplier values (request-only; the server never persists or returns them) — the
  // fresh-link genuine-edit baseline, mirroring QuoteItem.
  supplierQuoteBaseQuantity?: number | null;
  supplierQuoteBaseUnitPrice?: number | null;
  discount?: number; // item-level discount percentage (0–100)
  note?: string;
  unitType?: SupplierUnitType;
  durationMonths?: number; // months the service runs; multiplies cost & revenue (issue #757)
  durationUnit?: DurationUnit; // display unit: 'months' (default), 'years', or 'na' (N/A, no duration)
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
  // Derived (issue #779): `expired` overrides a non-terminal stored status once the offer's own
  // expiration date has passed; accepted/denied are frozen and never expire. Server-computed.
  effectiveStatus?: ClientOffer['status'] | 'expired';
  deliveryDate: string | null;
  expirationDate: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AutoCreatedSupplierOrder {
  id: string;
  supplierQuoteId: string;
  supplierName: string;
}

export interface ClientOfferAutoCreated {
  clientOrder: { id: string };
  supplierOrders: AutoCreatedSupplierOrder[];
}

export type ClientOfferUpdateResult = ClientOffer & {
  autoCreated?: ClientOfferAutoCreated;
  warnings?: string[];
};

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
  // Null for a product-less supplier-quote line (issue #783); the API response schema returns
  // `["string","null"]`, so callers must handle the null case.
  productId: string | null;
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
  discount?: number; // item-level discount percentage (0–100)
  note?: string;
  unitType?: SupplierUnitType;
  durationMonths?: number; // months the service runs; multiplies cost & revenue (issue #757)
  durationUnit?: DurationUnit; // display unit: 'months' (default), 'years', or 'na' (N/A, no duration)
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
  supplierOrders?: AutoCreatedSupplierOrder[];
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

export const WEBHOOK_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type WebhookHttpMethod = (typeof WEBHOOK_HTTP_METHODS)[number];
export const WEBHOOK_AUTH_TYPES = ['none', 'basic', 'bearer', 'api_key'] as const;
export type WebhookAuthType = (typeof WEBHOOK_AUTH_TYPES)[number];

export interface WebhookHeader {
  key: string;
  value: string;
}

// A configured webhook target. `authSecret` arrives masked from the server (the mask sentinel when
// a secret is stored, '' otherwise) — never the real credential.
export interface Webhook {
  id: string;
  name: string;
  description: string;
  url: string;
  httpMethod: WebhookHttpMethod;
  authType: WebhookAuthType;
  authUsername: string;
  authHeaderName: string;
  authSecret: string;
  customHeaders: WebhookHeader[];
  enabled: boolean;
}

// Create/update body. Omit `authSecret` to keep the stored secret; send a new value to replace it,
// or '' to clear it. There is no input mask sentinel: any string sent is stored as-is (a literal
// '********' is saved verbatim), so callers must OMIT the field to preserve the credential — echoing
// the masked value back from a fetched webhook would overwrite the stored secret with asterisks.
export interface WebhookPayload {
  name: string;
  description: string;
  url: string;
  httpMethod: WebhookHttpMethod;
  authType: WebhookAuthType;
  authUsername: string;
  authHeaderName: string;
  authSecret?: string;
  customHeaders: WebhookHeader[];
  enabled: boolean;
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
  | 'administration/webhooks'
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
  | 'projects/detail'
  | 'projects/resales'
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
  members?: { id: string; name: string }[];
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
  durationMonths?: number; // months the service runs; multiplies the taxable amount (issue #757)
  durationUnit?: DurationUnit; // display unit: 'months' (default), 'years', or 'na' (N/A, no duration)
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

export interface SupplierContact {
  fullName: string;
  role?: string;
  email?: string;
  phone?: string;
}

export interface Supplier {
  id: string;
  name: string;
  isDisabled?: boolean;
  supplierCode?: string;
  contacts?: SupplierContact[];
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

// Display unit for a line item's duration (issue #757). `durationMonths` stays the canonical
// pricing multiplier (always whole months); `durationUnit` only controls how that value is
// shown/entered — 'years' renders `durationMonths / 12`. 'na' (N/A) marks a line where duration
// does not apply: the value beside the selector is disabled and the line never multiplies (×1).
export type DurationUnit = 'months' | 'years' | 'na';

export interface SupplierQuoteItem {
  id: string;
  quoteId: string;
  productId?: string;
  productName: string;
  quantity: number;
  // Supplier list/catalog price per unit (Prezzo listino).
  listPrice: number;
  // Discount the supplier grants us, as a percentage (Sconto a noi %).
  discountPercent: number;
  // Net unit cost (Costo unitario) = listPrice * (1 - discountPercent / 100).
  unitPrice: number;
  note?: string;
  unitType?: SupplierUnitType;
  // Number of months the line item's service runs (issue #776, same logic as client quotes
  // #757). Multiplies the line total alongside `quantity`. Absent/invalid → 1, so legacy rows
  // keep their existing totals.
  durationMonths?: number;
  // Display unit for `durationMonths`: 'months' (default) or 'years'. Pricing always uses
  // `durationMonths`; this only controls how the value is shown/entered.
  durationUnit?: DurationUnit;
}

export interface SupplierQuote {
  id: string;
  supplierId: string;
  supplierName: string;
  // Optional customer association (issue #759). Absent/null when no customer is linked.
  clientId?: string | null;
  clientName?: string | null;
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
  // FULLY DERIVED status (issue #779): unlinked → draft; linked → follows the client quote and,
  // once one exists, the client offer — with the `expired` overlays. Never manually set.
  status: 'draft' | 'sent' | 'offer' | 'accepted' | 'denied' | 'expired';
  // When linked to a client quote, the status is driven by it (#779).
  isStatusSynced?: boolean;
  linkedClientQuoteId?: string | null;
  expirationDate: string;
  communicationChannelId?: string;
  communicationChannelName?: string;
  linkedOrderId?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type SupplierQuoteVersionReason = 'update' | 'restore';

export interface SupplierQuoteVersionSnapshot {
  schemaVersion: 1;
  quote: Omit<
    SupplierQuote,
    | 'items'
    | 'linkedOrderId'
    | 'isStatusSynced'
    | 'linkedClientQuoteId'
    | 'communicationChannelId'
    | 'communicationChannelName'
  > & {
    communicationChannelId?: string;
    communicationChannelName?: string;
  };
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
  // Unit used by quantity; carried from the supplier quote and editable while the order is draft.
  unitType?: SupplierUnitType;
  // Gross/list price. `discount` is the supplier's discount to us; their combination derives the
  // net unit cost shown in the order and preserves the pricing chain copied from supplier quotes.
  unitPrice: number;
  // Supplier discount to us, as an inclusive 0-100 percentage.
  discount?: number;
  note?: string;
  // Number of months the line runs (issue #776). Multiplies the line total alongside quantity;
  // carried over from the originating supplier quote so the order total matches the quote.
  // Absent/invalid → 1, so legacy orders keep their existing totals.
  durationMonths?: number;
  // Display unit for `durationMonths`: 'months' (default) or 'years'.
  durationUnit?: DurationUnit;
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
  durationMonths?: number; // months the service runs; multiplies the line total (issue #776/#775)
  durationUnit?: DurationUnit; // display unit: 'months' (default), 'years', or 'na' (N/A, no duration)
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
  'app_branding',
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
  'project_rule',
  'resale',
  'resale_activity',
  'resale_category',
  'reports_ai',
  'reports_ai_message',
  'reports_ai_session',
  'role',
  'saved_view',
  'settings',
  'sso_provider',
  'supplier',
  'supplier_invoice',
  'supplier_order',
  'supplier_quote',
  'supplier_quote_attachment',
  'task',
  'user',
  'webhook',
  'work_unit',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
