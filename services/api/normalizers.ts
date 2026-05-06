import type {
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
} from '../../types';

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

export const normalizeUser = (u: User): User => {
  const normalizedCostPerHour = Number(u.costPerHour ?? 0);

  return {
    ...u,
    id: normalizeTrimmedString(u.id),
    name: normalizeTrimmedString(u.name),
    role: normalizeTrimmedString(u.role),
    avatarInitials: normalizeTrimmedString(u.avatarInitials),
    username: normalizeTrimmedString(u.username),
    hasTopManagerRole: !!u.hasTopManagerRole,
    isAdminOnly: !!u.isAdminOnly,
    email: normalizeTrimmedString(u.email) || undefined,
    permissions: normalizeStringArray(u.permissions),
    availableRoles: normalizeAvailableRoles(u.availableRoles),
    costPerHour: Number.isFinite(normalizedCostPerHour) ? normalizedCostPerHour : 0,
    employeeType: normalizeEmployeeType(u.employeeType),
  };
};

export const normalizeProduct = (p: Product): Product => ({
  ...p,
  costo: Number(p.costo || 0),
  molPercentage: Number(p.molPercentage || 0),
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
  offerCode: offer.offerCode || offer.id,
  versionGroupId: offer.versionGroupId || offer.id,
  versionParentId: offer.versionParentId ?? null,
  versionNumber: Number(offer.versionNumber || 1),
  isLatest: offer.isLatest ?? true,
  discount: Number(offer.discount || 0),
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

export const normalizeTimeEntry = (e: TimeEntry): TimeEntry => ({
  ...e,
  duration: Number(e.duration || 0),
  hourlyCost: Number(e.hourlyCost || 0),
});

export const normalizeTask = (t: ProjectTask): ProjectTask => ({
  ...t,
  recurrenceDuration: t.recurrenceDuration ? Number(t.recurrenceDuration) : 0,
  expectedEffort: t.expectedEffort !== undefined ? Number(t.expectedEffort) : undefined,
  revenue: t.revenue !== undefined ? Number(t.revenue) : undefined,
});

export const normalizeGeneralSettings = (s: GeneralSettings): GeneralSettings => ({
  ...s,
  dailyLimit: Number(s.dailyLimit || 0),
});

export const normalizeInvoiceItem = (item: InvoiceItem): InvoiceItem => ({
  ...item,
  unitOfMeasure: item.unitOfMeasure === 'hours' ? 'hours' : 'unit',
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  discount: Number(item.discount || 0),
});

export const normalizeInvoice = (i: Invoice): Invoice => ({
  ...i,
  subtotal: Number(i.subtotal ?? 0),
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
