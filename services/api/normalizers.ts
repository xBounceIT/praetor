import type {
  BillingFrequency,
  Client,
  ClientOffer,
  ClientOfferItem,
  ClientsOrder,
  ClientsOrderItem,
  EmployeeType,
  GeneralSettings,
  Invoice,
  InvoiceItem,
  Product,
  Project,
  ProjectTask,
  Quote,
  QuoteItem,
  RoleSummary,
  SupplierInvoice,
  SupplierInvoiceItem,
  SupplierQuote,
  SupplierQuoteItem,
  SupplierSaleOrder,
  SupplierSaleOrderItem,
  TimeEntry,
  User,
  UserAuthMethod,
  UserContractType,
  UserEmploymentStatus,
  UserWorkLocation,
} from '../../types';
import { normalizeDateOnlyString } from '../../utils/date';
import {
  DEFAULT_RIL_EXIT_TIME,
  DEFAULT_RIL_START_TIME,
  normalizeRilNoteOptions,
  normalizeRilTransferOptions,
} from '../../utils/ril';

const nullableNumber = (value: unknown, fallback: number | null = null): number | null =>
  value === undefined || value === null ? fallback : Number(value);

type PricingItemBase = {
  quantity?: number;
  unitPrice?: number;
  productCost?: number;
  productMolPercentage?: number | null;
  supplierQuoteId?: string | null;
  supplierQuoteItemId?: string | null;
  supplierQuoteSupplierName?: string | null;
  supplierQuoteUnitPrice?: number | null;
  supplierSaleId?: string | null;
  supplierSaleItemId?: string | null;
  supplierSaleSupplierName?: string | null;
  discount?: number;
  note?: string;
};

const normalizePricingItemFields = <T extends PricingItemBase>(item: T): T => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  productCost: nullableNumber(item.productCost, 0) as number,
  productMolPercentage: nullableNumber(item.productMolPercentage),
  supplierQuoteId: item.supplierQuoteId ?? null,
  supplierQuoteItemId: item.supplierQuoteItemId ?? null,
  supplierQuoteSupplierName: item.supplierQuoteSupplierName ?? null,
  supplierQuoteUnitPrice: nullableNumber(item.supplierQuoteUnitPrice),
  supplierSaleId: item.supplierSaleId ?? null,
  supplierSaleItemId: item.supplierSaleItemId ?? null,
  supplierSaleSupplierName: item.supplierSaleSupplierName ?? null,
  discount: Number(item.discount || 0),
});

export const normalizeClient = (c: Client): Client => ({
  ...c,
  contacts: Array.isArray(c.contacts)
    ? c.contacts
        .map((contact) => ({
          fullName: typeof contact.fullName === 'string' ? contact.fullName.trim() : '',
          role: typeof contact.role === 'string' ? contact.role.trim() || undefined : undefined,
          email: typeof contact.email === 'string' ? contact.email.trim() || undefined : undefined,
          phone: typeof contact.phone === 'string' ? contact.phone.trim() || undefined : undefined,
        }))
        .filter((contact) => contact.fullName.length > 0)
    : undefined,
  contactName: c.contactName ?? undefined,
  clientCode: c.clientCode ?? undefined,
  email: c.email ?? undefined,
  phone: c.phone ?? undefined,
  address: c.address ?? undefined,
  addressCountry: c.addressCountry ?? undefined,
  addressState: c.addressState ?? undefined,
  addressCap: c.addressCap ?? undefined,
  addressProvince: c.addressProvince ?? undefined,
  addressCivicNumber: c.addressCivicNumber ?? undefined,
  addressLine: c.addressLine ?? undefined,
  description: c.description ?? undefined,
  atecoCode: c.atecoCode ?? undefined,
  website: c.website ?? undefined,
  sector: c.sector ?? undefined,
  numberOfEmployees: c.numberOfEmployees ?? undefined,
  revenue: c.revenue ?? undefined,
  fiscalCode: c.fiscalCode ?? undefined,
  officeCountRange: c.officeCountRange ?? undefined,
  vatNumber: c.vatNumber ?? undefined,
  taxCode: c.taxCode ?? undefined,
});

const normalizeTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeTrimmedString(entry))
    .filter((entry): entry is string => entry.length > 0);
};

const normalizeEmployeeType = (value: unknown): EmployeeType => {
  if (value === 'internal' || value === 'external' || value === 'app_user') {
    return value;
  }
  return 'app_user';
};

const normalizeUserAuthMethod = (value: unknown): UserAuthMethod => {
  if (value === 'ldap' || value === 'oidc' || value === 'saml' || value === 'local') {
    return value;
  }
  return 'local';
};

const normalizeUserContractType = (value: unknown): UserContractType | null => {
  if (
    value === 'permanent' ||
    value === 'fixed_term' ||
    value === 'contractor' ||
    value === 'internship' ||
    value === 'consultant' ||
    value === 'other'
  ) {
    return value;
  }
  return null;
};

const normalizeUserEmploymentStatus = (value: unknown): UserEmploymentStatus | null => {
  if (
    value === 'active' ||
    value === 'onboarding' ||
    value === 'on_leave' ||
    value === 'terminated'
  ) {
    return value;
  }
  return null;
};

const normalizeUserWorkLocation = (value: unknown): UserWorkLocation | null => {
  if (
    value === 'office' ||
    value === 'remote' ||
    value === 'hybrid' ||
    value === 'customer_site' ||
    value === 'other'
  ) {
    return value;
  }
  return null;
};

const normalizeAvailableRoles = (value: unknown): RoleSummary[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];

  const normalizedRoles: RoleSummary[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;

    const role = entry as Partial<RoleSummary>;
    const id = normalizeTrimmedString(role.id);
    const name = normalizeTrimmedString(role.name);
    if (!id || !name) continue;

    normalizedRoles.push({
      id,
      name,
      isSystem: !!role.isSystem,
      isAdmin: !!role.isAdmin,
    });
  }

  return normalizedRoles;
};

const assignIfPresent = <V>(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
  derive: (raw: unknown) => V,
): void => {
  if (Object.hasOwn(source, key)) {
    target[key] = derive(source[key]);
  }
};

const normalizeCostPerHour = (raw: unknown): number => {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const normalizeOptionalString = (raw: unknown): string | undefined =>
  normalizeTrimmedString(raw) || undefined;

const normalizeNullableTrimmedString = (raw: unknown): string | null =>
  normalizeTrimmedString(raw) || null;

const normalizeNullableDateOnlyString = (raw: unknown): string | null => {
  const normalized = normalizeTrimmedString(raw);
  if (!normalized) return null;
  const dateOnly = normalizeDateOnlyString(normalized);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null;
};

export const normalizeUser = (u: User): User => {
  // /auth/login and /auth/me only return id, name, username, role,
  // avatarInitials, permissions, availableRoles. Fabricating defaults for the
  // other optional fields (costPerHour, employeeType, etc.) hides API contract
  // drift, so we only touch fields the payload actually carries.
  const raw = u as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = { ...u };

  result.id = normalizeTrimmedString(u.id);
  result.name = normalizeTrimmedString(u.name);
  result.role = normalizeTrimmedString(u.role);
  result.avatarInitials = normalizeTrimmedString(u.avatarInitials);
  result.username = normalizeTrimmedString(u.username);
  result.permissions = normalizeStringArray(u.permissions);
  result.availableRoles = normalizeAvailableRoles(u.availableRoles);

  assignIfPresent(raw, result, 'hasTopManagerRole', (v) => !!v);
  assignIfPresent(raw, result, 'isAdminOnly', (v) => !!v);
  assignIfPresent(raw, result, 'email', normalizeOptionalString);
  assignIfPresent(raw, result, 'costPerHour', normalizeCostPerHour);
  assignIfPresent(raw, result, 'employeeType', normalizeEmployeeType);
  assignIfPresent(raw, result, 'phone', normalizeOptionalString);
  assignIfPresent(raw, result, 'jobTitle', normalizeOptionalString);
  assignIfPresent(raw, result, 'department', normalizeOptionalString);
  assignIfPresent(raw, result, 'employeeCode', normalizeOptionalString);
  assignIfPresent(raw, result, 'hireDate', normalizeNullableDateOnlyString);
  assignIfPresent(raw, result, 'terminationDate', normalizeNullableDateOnlyString);
  assignIfPresent(raw, result, 'contractType', normalizeUserContractType);
  assignIfPresent(raw, result, 'employmentStatus', normalizeUserEmploymentStatus);
  assignIfPresent(raw, result, 'workLocation', normalizeUserWorkLocation);
  assignIfPresent(raw, result, 'emergencyContactName', normalizeOptionalString);
  assignIfPresent(raw, result, 'emergencyContactPhone', normalizeOptionalString);
  assignIfPresent(raw, result, 'notes', normalizeOptionalString);
  assignIfPresent(raw, result, 'authMethod', normalizeUserAuthMethod);
  assignIfPresent(raw, result, 'authProviderId', normalizeNullableTrimmedString);
  assignIfPresent(raw, result, 'authProviderName', normalizeNullableTrimmedString);

  return result as unknown as User;
};

export const normalizeProduct = (p: Product): Product => ({
  ...p,
  costo: Number(p.costo || 0),
  molPercentage: Number(p.molPercentage || 0),
});

export const normalizeProject = (p: Project): Project => ({
  ...p,
  revenue: p.revenue === undefined || p.revenue === null ? null : Number(p.revenue),
  ...normalizeProjectBilling(p.billingType, p.billingFrequency),
});

export const normalizeQuoteItem = (item: QuoteItem): QuoteItem => ({
  ...normalizePricingItemFields(item),
  note: item.note || '',
});

export const normalizeQuote = (q: Quote): Quote => ({
  ...q,
  discount: Number(q.discount || 0),
  items: (q.items || []).map(normalizeQuoteItem),
});

export const normalizeClientOfferItem = (item: ClientOfferItem): ClientOfferItem => ({
  ...normalizePricingItemFields(item),
  note: item.note || '',
});

export const normalizeClientOffer = (offer: ClientOffer): ClientOffer => ({
  ...offer,
  discount: Number(offer.discount || 0),
  deliveryDate: offer.deliveryDate ? normalizeDateOnlyString(offer.deliveryDate) : null,
  items: (offer.items || []).map(normalizeClientOfferItem),
});

export const normalizeClientsOrderItem = (item: ClientsOrderItem): ClientsOrderItem => ({
  ...normalizePricingItemFields(item),
});

export const normalizeClientsOrder = (o: ClientsOrder): ClientsOrder => ({
  ...o,
  discount: Number(o.discount || 0),
  items: (o.items || []).map(normalizeClientsOrderItem),
});

export const normalizeTimeEntry = (e: TimeEntry): TimeEntry => {
  // `hourlyCost` / `cost` are gated behind `reports.cost.view` server-side and may be
  // entirely absent from the payload. Preserve the absence (rather than coercing to 0)
  // so the UI can branch on permission visibility instead of getting a misleading zero.
  const normalized: TimeEntry = {
    ...e,
    duration: Number(e.duration || 0),
    version: Number(e.version || 1),
  };
  if (e.hourlyCost !== undefined && e.hourlyCost !== null) {
    normalized.hourlyCost = Number(e.hourlyCost);
  } else {
    delete normalized.hourlyCost;
  }
  if (e.cost !== undefined && e.cost !== null) {
    normalized.cost = Number(e.cost);
  } else {
    delete normalized.cost;
  }
  return normalized;
};

export const normalizeTask = (t: ProjectTask): ProjectTask => ({
  ...t,
  recurrenceDuration: t.recurrenceDuration ? Number(t.recurrenceDuration) : 0,
  expectedEffort: t.expectedEffort !== undefined ? Number(t.expectedEffort) : undefined,
  monthlyEffort: t.monthlyEffort !== undefined ? Number(t.monthlyEffort) : undefined,
  revenue: t.revenue !== undefined ? Number(t.revenue) : undefined,
  ...normalizeTaskBilling(t.billingType, t.billingFrequency),
});

const normalizeProjectBilling = (
  billingType: Project['billingType'] | undefined,
  billingFrequency: BillingFrequency | undefined,
): Required<Pick<Project, 'billingType' | 'billingFrequency'>> => {
  const resolvedBillingType = billingType ?? 'time_and_materials';
  return {
    billingType: resolvedBillingType,
    billingFrequency:
      resolvedBillingType === 'time_and_materials' ? 'monthly' : (billingFrequency ?? 'monthly'),
  };
};

const normalizeTaskBilling = (
  billingType: ProjectTask['billingType'] | undefined,
  billingFrequency: BillingFrequency | undefined,
): Required<Pick<ProjectTask, 'billingType' | 'billingFrequency'>> => {
  const resolvedBillingType = billingType === 'retainer' ? 'retainer' : 'time_and_materials';
  return {
    billingType: resolvedBillingType,
    billingFrequency:
      resolvedBillingType === 'time_and_materials' ? 'monthly' : (billingFrequency ?? 'monthly'),
  };
};

export const normalizeGeneralSettings = (s: GeneralSettings): GeneralSettings => ({
  ...s,
  dailyLimit: Number(s.dailyLimit || 0),
  rilCompanyName: s.rilCompanyName ?? '',
  rilDefaultStartTime: s.rilDefaultStartTime || DEFAULT_RIL_START_TIME,
  rilDefaultExitTime: s.rilDefaultExitTime || DEFAULT_RIL_EXIT_TIME,
  rilLunchBreakMinutes: Number(s.rilLunchBreakMinutes ?? 60),
  rilNoteOptions: normalizeRilNoteOptions(s.rilNoteOptions),
  rilTransferOptions: normalizeRilTransferOptions(s.rilTransferOptions),
  enforceTotpForAdmins: s.enforceTotpForAdmins ?? false,
});

// Allowlist mirroring the server's UNIT_OF_MEASURE_VALUES (server/routes/invoices.ts).
// The previous `=== 'hours' ? 'hours' : 'unit'` pattern silently coerced every non-'hours'
// value to 'unit', so any future addition (e.g. 'days', 'kg') would be corrupted.
const isValidInvoiceUnit = (value: unknown): value is InvoiceItem['unitOfMeasure'] =>
  value === 'unit' || value === 'hours';

const normalizeInvoiceUnitOfMeasure = (value: unknown): InvoiceItem['unitOfMeasure'] =>
  isValidInvoiceUnit(value) ? value : 'unit';

export const normalizeInvoiceItem = (item: InvoiceItem): InvoiceItem => ({
  ...item,
  unitOfMeasure: normalizeInvoiceUnitOfMeasure(item.unitOfMeasure),
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  discount: Number(item.discount || 0),
  // Default 0 keeps legacy items (pre-tax feature) rendering with no VAT.
  taxRate: Number(item.taxRate || 0),
});

export const normalizeInvoice = (i: Invoice): Invoice => ({
  ...i,
  subtotal: Number(i.subtotal ?? 0),
  taxTotal: Number(i.taxTotal ?? 0),
  total: Number(i.total ?? 0),
  amountPaid: Number(i.amountPaid ?? 0),
  items: (i.items || []).map(normalizeInvoiceItem),
});

export const normalizeSupplierQuoteItem = (item: SupplierQuoteItem): SupplierQuoteItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  note: item.note || '',
});

export const normalizeSupplierQuote = (q: SupplierQuote): SupplierQuote => ({
  ...q,
  items: (q.items || []).map(normalizeSupplierQuoteItem),
});

export const normalizeSupplierSaleOrderItem = (
  item: SupplierSaleOrderItem,
): SupplierSaleOrderItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  discount: Number(item.discount || 0),
  note: item.note || '',
});

export const normalizeSupplierSaleOrder = (order: SupplierSaleOrder): SupplierSaleOrder => ({
  ...order,
  discount: Number(order.discount || 0),
  items: (order.items || []).map(normalizeSupplierSaleOrderItem),
});

export const normalizeSupplierInvoiceItem = (item: SupplierInvoiceItem): SupplierInvoiceItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  discount: Number(item.discount || 0),
});

export const normalizeSupplierInvoice = (invoice: SupplierInvoice): SupplierInvoice => ({
  ...invoice,
  subtotal: Number(invoice.subtotal ?? 0),
  total: Number(invoice.total ?? 0),
  amountPaid: Number(invoice.amountPaid ?? 0),
  items: (invoice.items || []).map(normalizeSupplierInvoiceItem),
});
