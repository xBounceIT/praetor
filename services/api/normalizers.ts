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
  SpecialBid,
  SupplierInvoice,
  SupplierInvoiceItem,
  SupplierQuote,
  SupplierQuoteItem,
  SupplierSaleOrder,
  SupplierSaleOrderItem,
  TimeEntry,
  User,
} from '../../types';
import { roundToTwoDecimals } from '../../utils/numbers';

export const normalizeClient = (c: Client): Client => ({
  ...c,
  contactName: c.contactName ?? undefined,
  clientCode: c.clientCode ?? undefined,
  email: c.email ?? undefined,
  phone: c.phone ?? undefined,
  address: c.address ?? undefined,
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
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  productCost:
    item.productCost === undefined || item.productCost === null ? 0 : Number(item.productCost),
  productMolPercentage:
    item.productMolPercentage === undefined || item.productMolPercentage === null
      ? null
      : Number(item.productMolPercentage),
  specialBidUnitPrice:
    item.specialBidUnitPrice === undefined || item.specialBidUnitPrice === null
      ? null
      : Number(item.specialBidUnitPrice),
  specialBidMolPercentage:
    item.specialBidMolPercentage === undefined || item.specialBidMolPercentage === null
      ? null
      : Number(item.specialBidMolPercentage),
  // Supplier quote fields
  supplierQuoteId: item.supplierQuoteId ?? null,
  supplierQuoteItemId: item.supplierQuoteItemId ?? null,
  supplierQuoteSupplierName: item.supplierQuoteSupplierName ?? null,
  supplierQuoteUnitPrice:
    item.supplierQuoteUnitPrice === undefined || item.supplierQuoteUnitPrice === null
      ? null
      : Number(item.supplierQuoteUnitPrice),
  supplierQuoteItemDiscount:
    item.supplierQuoteItemDiscount === undefined || item.supplierQuoteItemDiscount === null
      ? null
      : Number(item.supplierQuoteItemDiscount),
  supplierQuoteDiscount:
    item.supplierQuoteDiscount === undefined || item.supplierQuoteDiscount === null
      ? null
      : Number(item.supplierQuoteDiscount),
  discount: Number(item.discount || 0),
  note: item.note || '',
});

export const normalizeQuote = (q: Quote): Quote => ({
  ...q,
  discount: Number(q.discount || 0),
  items: (q.items || []).map(normalizeQuoteItem),
});

export const normalizeClientOfferItem = (item: ClientOfferItem): ClientOfferItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  productCost:
    item.productCost === undefined || item.productCost === null ? 0 : Number(item.productCost),
  productMolPercentage:
    item.productMolPercentage === undefined || item.productMolPercentage === null
      ? null
      : Number(item.productMolPercentage),
  specialBidUnitPrice:
    item.specialBidUnitPrice === undefined || item.specialBidUnitPrice === null
      ? null
      : Number(item.specialBidUnitPrice),
  specialBidMolPercentage:
    item.specialBidMolPercentage === undefined || item.specialBidMolPercentage === null
      ? null
      : Number(item.specialBidMolPercentage),
  // Supplier quote fields
  supplierQuoteId: item.supplierQuoteId ?? null,
  supplierQuoteItemId: item.supplierQuoteItemId ?? null,
  supplierQuoteSupplierName: item.supplierQuoteSupplierName ?? null,
  supplierQuoteUnitPrice:
    item.supplierQuoteUnitPrice === undefined || item.supplierQuoteUnitPrice === null
      ? null
      : Number(item.supplierQuoteUnitPrice),
  supplierQuoteItemDiscount:
    item.supplierQuoteItemDiscount === undefined || item.supplierQuoteItemDiscount === null
      ? null
      : Number(item.supplierQuoteItemDiscount),
  supplierQuoteDiscount:
    item.supplierQuoteDiscount === undefined || item.supplierQuoteDiscount === null
      ? null
      : Number(item.supplierQuoteDiscount),
  discount: Number(item.discount || 0),
  note: item.note || '',
});

export const normalizeClientOffer = (offer: ClientOffer): ClientOffer => ({
  ...offer,
  discount: Number(offer.discount || 0),
  items: (offer.items || []).map(normalizeClientOfferItem),
});

export const normalizeClientsOrderItem = (item: ClientsOrderItem): ClientsOrderItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  productCost:
    item.productCost === undefined || item.productCost === null ? 0 : Number(item.productCost),
  productMolPercentage:
    item.productMolPercentage === undefined || item.productMolPercentage === null
      ? null
      : Number(item.productMolPercentage),
  specialBidUnitPrice:
    item.specialBidUnitPrice === undefined || item.specialBidUnitPrice === null
      ? null
      : Number(item.specialBidUnitPrice),
  specialBidMolPercentage:
    item.specialBidMolPercentage === undefined || item.specialBidMolPercentage === null
      ? null
      : Number(item.specialBidMolPercentage),
  // Supplier quote fields
  supplierQuoteId: item.supplierQuoteId ?? null,
  supplierQuoteItemId: item.supplierQuoteItemId ?? null,
  supplierQuoteSupplierName: item.supplierQuoteSupplierName ?? null,
  supplierQuoteUnitPrice:
    item.supplierQuoteUnitPrice === undefined || item.supplierQuoteUnitPrice === null
      ? null
      : Number(item.supplierQuoteUnitPrice),
  supplierQuoteItemDiscount:
    item.supplierQuoteItemDiscount === undefined || item.supplierQuoteItemDiscount === null
      ? null
      : Number(item.supplierQuoteItemDiscount),
  supplierQuoteDiscount:
    item.supplierQuoteDiscount === undefined || item.supplierQuoteDiscount === null
      ? null
      : Number(item.supplierQuoteDiscount),
  discount: Number(item.discount || 0),
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
  specialBidId: item.specialBidId ?? undefined,
  unitOfMeasure: item.unitOfMeasure === 'hours' ? 'hours' : 'unit',
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  discount: Number(item.discount || 0),
});

export const normalizeInvoice = (i: Invoice): Invoice => ({
  ...i,
  subtotal: roundToTwoDecimals(Number(i.subtotal ?? 0)),
  total: roundToTwoDecimals(Number(i.total ?? 0)),
  amountPaid: roundToTwoDecimals(Number(i.amountPaid ?? 0)),
  items: (i.items || []).map(normalizeInvoiceItem),
});

export const normalizeSupplierQuoteItem = (item: SupplierQuoteItem): SupplierQuoteItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  discount: Number(item.discount || 0),
  note: item.note || '',
});

export const normalizeSupplierQuote = (q: SupplierQuote): SupplierQuote => ({
  ...q,
  discount: Number(q.discount || 0),
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
  subtotal: roundToTwoDecimals(Number(invoice.subtotal ?? 0)),
  total: roundToTwoDecimals(Number(invoice.total ?? 0)),
  amountPaid: roundToTwoDecimals(Number(invoice.amountPaid ?? 0)),
  items: (invoice.items || []).map(normalizeSupplierInvoiceItem),
});

export const normalizeSpecialBid = (b: SpecialBid): SpecialBid => ({
  ...b,
  unitPrice: Number(b.unitPrice || 0),
  molPercentage:
    b.molPercentage === undefined || b.molPercentage === null ? undefined : Number(b.molPercentage),
});
