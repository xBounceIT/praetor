import type {
  ClientsOrder,
  ClientsOrderItem,
  Expense,
  GeneralSettings,
  Invoice,
  InvoiceItem,
  Payment,
  Product,
  ProjectTask,
  Quote,
  QuoteItem,
  SpecialBid,
  SupplierQuote,
  SupplierQuoteItem,
  TimeEntry,
  User,
} from '../../types';

export const normalizeUser = (u: User): User => ({
  ...u,
  permissions: u.permissions || [],
  costPerHour: u.costPerHour ? Number(u.costPerHour) : 0,
  employeeType: u.employeeType || 'app_user',
});

export const normalizeProduct = (p: Product): Product => ({
  ...p,
  costo: Number(p.costo || 0),
  taxRate: Number(p.taxRate || 0),
});

export const normalizeQuoteItem = (item: QuoteItem): QuoteItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  productCost:
    item.productCost === undefined || item.productCost === null ? 0 : Number(item.productCost),
  productTaxRate:
    item.productTaxRate === undefined || item.productTaxRate === null
      ? 0
      : Number(item.productTaxRate),
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
  discount: Number(item.discount || 0),
  note: item.note || '',
});

export const normalizeQuote = (q: Quote): Quote => ({
  ...q,
  discount: Number(q.discount || 0),
  items: (q.items || []).map(normalizeQuoteItem),
});

export const normalizeClientsOrderItem = (item: ClientsOrderItem): ClientsOrderItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  productCost:
    item.productCost === undefined || item.productCost === null ? 0 : Number(item.productCost),
  productTaxRate:
    item.productTaxRate === undefined || item.productTaxRate === null
      ? 0
      : Number(item.productTaxRate),
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
});

export const normalizeGeneralSettings = (s: GeneralSettings): GeneralSettings => ({
  ...s,
  dailyLimit: Number(s.dailyLimit || 0),
});

export const normalizeInvoiceItem = (item: InvoiceItem): InvoiceItem => ({
  ...item,
  quantity: Number(item.quantity || 0),
  unitPrice: Number(item.unitPrice || 0),
  taxRate: Number(item.taxRate || 0),
  discount: Number(item.discount || 0),
});

export const normalizeInvoice = (i: Invoice): Invoice => ({
  ...i,
  subtotal: Number(i.subtotal ?? 0),
  taxAmount: Number(i.taxAmount ?? 0),
  total: Number(i.total ?? 0),
  amountPaid: Number(i.amountPaid ?? 0),
  items: (i.items || []).map(normalizeInvoiceItem),
});

export const normalizePayment = (p: Payment): Payment => ({
  ...p,
  amount: Number(p.amount || 0),
});

export const normalizeExpense = (e: Expense): Expense => ({
  ...e,
  amount: Number(e.amount || 0),
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

export const normalizeSpecialBid = (b: SpecialBid): SpecialBid => ({
  ...b,
  unitPrice: Number(b.unitPrice || 0),
  molPercentage:
    b.molPercentage === undefined || b.molPercentage === null ? undefined : Number(b.molPercentage),
});
