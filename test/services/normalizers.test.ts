import { describe, expect, test } from 'bun:test';
import {
  normalizeClient,
  normalizeClientOffer,
  normalizeClientOfferItem,
  normalizeClientsOrder,
  normalizeClientsOrderItem,
  normalizeGeneralSettings,
  normalizeInvoice,
  normalizeInvoiceItem,
  normalizeProduct,
  normalizeProject,
  normalizeQuote,
  normalizeQuoteItem,
  normalizeResale,
  normalizeResaleCategory,
  normalizeResaleOrderOption,
  normalizeSupplierInvoice,
  normalizeSupplierInvoiceItem,
  normalizeSupplierQuote,
  normalizeSupplierQuoteItem,
  normalizeSupplierSaleOrder,
  normalizeSupplierSaleOrderItem,
  normalizeTask,
  normalizeTimeEntry,
  normalizeUser,
} from '../../services/api/normalizers';
import type {
  Client,
  ClientOffer,
  ClientOfferItem,
  ClientsOrder,
  ClientsOrderItem,
  GeneralSettings,
  Invoice,
  InvoiceItem,
  Product,
  Project,
  ProjectTask,
  Quote,
  QuoteItem,
  Resale,
  ResaleCategory,
  ResaleOrderOption,
  SupplierInvoice,
  SupplierInvoiceItem,
  SupplierQuote,
  SupplierQuoteItem,
  SupplierSaleOrder,
  SupplierSaleOrderItem,
  TimeEntry,
  User,
} from '../../types';

// Tests intentionally pass values that violate the static types - the normalizers
// exist precisely to harden the boundary against backends that send strings, nulls,
// or missing keys. `Loose<T>` lets each test express "I don't care what the type
// system thinks here, the runtime behavior is what's under test".
type Loose<T> = { [K in keyof T]?: unknown } & Record<string, unknown>;

const make = <T>(base: T, overrides: Loose<T> = {}): T => ({ ...base, ...overrides }) as T;

const baseQuote: Quote = {
  id: 'q-1',
  clientId: 'c-1',
  clientName: 'Acme',
  items: [],
  paymentTerms: '30gg',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  expirationDate: '2026-12-31',
  communicationChannelId: 'qcc_email',
  communicationChannelName: 'Email',
  createdAt: 0,
  updatedAt: 0,
};

const baseQuoteItem: QuoteItem = {
  id: 'qi-1',
  quoteId: 'q-1',
  productId: 'p-1',
  productName: 'Widget',
  quantity: 1,
  unitPrice: 10,
};

const baseClientOffer: ClientOffer = {
  id: 'o-1',
  linkedQuoteId: 'q-1',
  clientId: 'c-1',
  clientName: 'Acme',
  items: [],
  paymentTerms: '30gg',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  deliveryDate: null,
  expirationDate: '2026-12-31',
  createdAt: 0,
  updatedAt: 0,
};

const baseOfferItem: ClientOfferItem = {
  id: 'oi-1',
  offerId: 'o-1',
  productId: 'p-1',
  productName: 'Widget',
  quantity: 1,
  unitPrice: 10,
};

const baseClientsOrder: ClientsOrder = {
  id: 'co-1',
  clientId: 'c-1',
  clientName: 'Acme',
  items: [],
  paymentTerms: '30gg',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  createdAt: 0,
  updatedAt: 0,
};

const baseClientsOrderItem: ClientsOrderItem = {
  id: 'coi-1',
  orderId: 'co-1',
  productId: 'p-1',
  productName: 'Widget',
  quantity: 1,
  unitPrice: 10,
};

const baseInvoice: Invoice = {
  id: 'inv-1',
  clientId: 'c-1',
  clientName: 'Acme',
  issueDate: '2026-01-01',
  dueDate: '2026-02-01',
  status: 'draft',
  subtotal: 0,
  taxTotal: 0,
  total: 0,
  amountPaid: 0,
  items: [],
  createdAt: 0,
  updatedAt: 0,
};

const baseInvoiceItem: InvoiceItem = {
  id: 'ii-1',
  invoiceId: 'inv-1',
  description: 'Service',
  unitOfMeasure: 'unit',
  quantity: 1,
  unitPrice: 10,
};

const baseSupplierQuote: SupplierQuote = {
  id: 'sq-1',
  supplierId: 's-1',
  supplierName: 'SupplierCo',
  items: [],
  paymentTerms: '30gg',
  status: 'draft',
  expirationDate: '2026-12-31',
  communicationChannelId: 'qcc_email',
  communicationChannelName: 'Email',
  createdAt: 0,
  updatedAt: 0,
};

const baseSupplierQuoteItem: SupplierQuoteItem = {
  id: 'sqi-1',
  quoteId: 'sq-1',
  productName: 'Widget',
  quantity: 1,
  listPrice: 5,
  discountPercent: 0,
  unitPrice: 5,
};

const baseSupplierSaleOrder: SupplierSaleOrder = {
  id: 'sso-1',
  supplierId: 's-1',
  supplierName: 'SupplierCo',
  items: [],
  paymentTerms: '30gg',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  createdAt: 0,
  updatedAt: 0,
};

const baseSupplierSaleOrderItem: SupplierSaleOrderItem = {
  id: 'ssoi-1',
  orderId: 'sso-1',
  productId: 'p-1',
  productName: 'Widget',
  quantity: 1,
  unitPrice: 5,
};

const baseSupplierInvoice: SupplierInvoice = {
  id: 'sinv-1',
  supplierId: 's-1',
  supplierName: 'SupplierCo',
  issueDate: '2026-01-01',
  dueDate: '2026-02-01',
  status: 'draft',
  subtotal: 0,
  total: 0,
  amountPaid: 0,
  items: [],
  createdAt: 0,
  updatedAt: 0,
};

const baseSupplierInvoiceItem: SupplierInvoiceItem = {
  id: 'sii-1',
  invoiceId: 'sinv-1',
  description: 'Material',
  quantity: 1,
  unitPrice: 5,
};

const baseUser: User = {
  id: 'u-1',
  name: 'Alice',
  role: 'admin',
  avatarInitials: 'AL',
  username: 'alice',
};

const baseTimeEntry: TimeEntry = {
  id: 'te-1',
  userId: 'u-1',
  date: '2026-01-01',
  clientId: 'c-1',
  clientName: 'Acme',
  projectId: 'pr-1',
  projectName: 'Project',
  task: 'Task',
  duration: 0,
  hourlyCost: 0,
  createdAt: 0,
  version: 1,
};

const baseProduct: Product = {
  id: 'p-1',
  name: 'Widget',
  productCode: 'W001',
  costo: 0,
  molPercentage: 0,
  costUnit: 'unit',
  type: 'standard',
};

const baseGeneralSettings: GeneralSettings = {
  currency: 'EUR',
  dailyLimit: 0,
  startOfWeek: 'Monday',
  treatSaturdayAsHoliday: false,
  enableAiReporting: false,
  enableTotp: true,
  enforceTotp: false,
  totpEnforcedRoleIds: [],
  totpExemptRoleIds: [],
  allowWeekendSelection: false,
  rilCompanyName: '',
  rilDefaultStartTime: '09:00',
  rilDefaultExitTime: '18:00',
  rilLunchBreakMinutes: 60,
  rilNoteOptions: [
    { value: 'P', label: 'Ferie' },
    { value: 'P2', label: 'Permesso' },
    { value: 'M', label: 'Malattia' },
    { value: 'F', label: 'Festivita' },
  ],
  rilTransferOptions: ['In sede', 'Telelavoro'],
};

describe('normalizeClient', () => {
  test('preserves all fields when fully populated', () => {
    const input: Client = {
      id: 'c-1',
      name: 'Acme',
      contactName: 'John',
      clientCode: 'C001',
      email: 'foo@bar.com',
      phone: '555',
      address: '123 St',
      vatNumber: 'IT001',
      taxCode: 'TX001',
    };
    const result = normalizeClient(input);
    expect(result.contactName).toBe('John');
    expect(result.email).toBe('foo@bar.com');
    expect(result.vatNumber).toBe('IT001');
    expect(result.taxCode).toBe('TX001');
    expect(result.contacts).toBeUndefined();
  });

  test('normalizes contacts: trims fields and drops entries without fullName', () => {
    const input = make<Client>(
      { id: 'c-1', name: 'Acme' },
      {
        contacts: [
          {
            fullName: '  Jane Doe  ',
            role: '  Manager  ',
            email: '  jane@x.com  ',
            phone: '  555  ',
          },
          { fullName: '   ', role: 'X' },
          { fullName: 'No Optional' },
        ],
      },
    );
    const result = normalizeClient(input);
    expect(result.contacts).toHaveLength(2);
    expect(result.contacts?.[0]).toEqual({
      fullName: 'Jane Doe',
      role: 'Manager',
      email: 'jane@x.com',
      phone: '555',
    });
    expect(result.contacts?.[1]).toEqual({
      fullName: 'No Optional',
      role: undefined,
      email: undefined,
      phone: undefined,
    });
  });

  test('drops empty optional string fields on contacts', () => {
    const input: Client = {
      id: 'c-1',
      name: 'Acme',
      contacts: [{ fullName: 'Jane', role: '', email: '', phone: '' }],
    };
    const result = normalizeClient(input);
    expect(result.contacts?.[0]).toEqual({
      fullName: 'Jane',
      role: undefined,
      email: undefined,
      phone: undefined,
    });
  });

  test('returns undefined contacts when input contacts is not an array', () => {
    const input = make<Client>({ id: 'c-1', name: 'Acme' }, { contacts: 'not-an-array' });
    const result = normalizeClient(input);
    expect(result.contacts).toBeUndefined();
  });

  test('coerces null optional fields to undefined', () => {
    const input = make<Client>(
      { id: 'c-1', name: 'Acme' },
      {
        contactName: null,
        clientCode: null,
        email: null,
        phone: null,
        address: null,
        addressCountry: null,
        addressState: null,
        addressCap: null,
        addressProvince: null,
        addressCivicNumber: null,
        addressLine: null,
        description: null,
        atecoCode: null,
        website: null,
        sector: null,
        numberOfEmployees: null,
        revenue: null,
        fiscalCode: null,
        officeCountRange: null,
        vatNumber: null,
        taxCode: null,
      },
    );
    const result = normalizeClient(input);
    expect(result.contactName).toBeUndefined();
    expect(result.clientCode).toBeUndefined();
    expect(result.email).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.address).toBeUndefined();
    expect(result.sector).toBeUndefined();
    expect(result.fiscalCode).toBeUndefined();
    expect(result.vatNumber).toBeUndefined();
    expect(result.taxCode).toBeUndefined();
  });
});

describe('normalizeUser', () => {
  test('happy path: trims strings and parses costPerHour', () => {
    const input = make<User>(baseUser, {
      id: '  u-1  ',
      name: '  Alice  ',
      role: '  admin  ',
      avatarInitials: '  AL  ',
      username: '  alice  ',
      email: '  alice@x.com  ',
      costPerHour: '25.5',
      hasTopManagerRole: true,
      isAdminOnly: false,
      employeeType: 'internal',
      firstName: '  Mario  ',
      lastName: '  Bianchi  ',
      phone: '  +39 02 1234  ',
      jobTitle: '  Consultant  ',
      department: '  Delivery  ',
      responsibleUserId: '  u-manager  ',
      responsibleUserName: '  Boss User  ',
      employeeCode: '  EMP-001  ',
      hireDate: '2024-01-15T10:30:00Z',
      terminationDate: '',
      contractType: 'permanent',
      employmentStatus: 'onboarding',
      workLocation: 'hybrid',
      emergencyContactName: '  Maria  ',
      emergencyContactPhone: '  +39 02 5678  ',
      notes: '  Starts next week  ',
      permissions: ['read', '  write  ', ''],
    });
    const result = normalizeUser(input);
    expect(result.id).toBe('u-1');
    expect(result.name).toBe('Alice');
    expect(result.role).toBe('admin');
    expect(result.avatarInitials).toBe('AL');
    expect(result.username).toBe('alice');
    expect(result.email).toBe('alice@x.com');
    expect(result.costPerHour).toBe(25.5);
    expect(result.hasTopManagerRole).toBe(true);
    expect(result.isAdminOnly).toBe(false);
    expect(result.employeeType).toBe('internal');
    expect(result.firstName).toBe('Mario');
    expect(result.lastName).toBe('Bianchi');
    expect(result.phone).toBe('+39 02 1234');
    expect(result.jobTitle).toBe('Consultant');
    expect(result.department).toBe('Delivery');
    expect(result.responsibleUserId).toBe('u-manager');
    expect(result.responsibleUserName).toBe('Boss User');
    expect(result.employeeCode).toBe('EMP-001');
    expect(result.hireDate).toBe('2024-01-15');
    expect(result.terminationDate).toBeNull();
    expect(result.contractType).toBe('permanent');
    expect(result.employmentStatus).toBe('onboarding');
    expect(result.workLocation).toBe('hybrid');
    expect(result.emergencyContactName).toBe('Maria');
    expect(result.emergencyContactPhone).toBe('+39 02 5678');
    expect(result.notes).toBe('Starts next week');
    expect(result.permissions).toEqual(['read', 'write']);
  });

  test('defaults employeeType to "app_user" for unknown values', () => {
    const input = make<User>(baseUser, { employeeType: 'unknown_type' });
    expect(normalizeUser(input).employeeType).toBe('app_user');
  });

  test('leaves optional fields absent when the payload omits them', () => {
    // normalizeUser must not fabricate defaults (costPerHour=0, employeeType='app_user',
    // etc.) for fields the API never sent — that would hide contract drift behind ghost
    // values. Only permissions/availableRoles are always normalized (to [] / undefined).
    const result = normalizeUser(baseUser);
    expect(result.email).toBeUndefined();
    expect(result.permissions).toEqual([]);
    expect(result.availableRoles).toBeUndefined();
    expect(result.costPerHour).toBeUndefined();
    expect(result.hasTopManagerRole).toBeUndefined();
    expect(result.isAdminOnly).toBeUndefined();
    expect(result.employeeType).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.firstName).toBeUndefined();
    expect(result.lastName).toBeUndefined();
    expect(result.employeeCode).toBeUndefined();
    expect(result.employmentStatus).toBeUndefined();
  });

  test('normalizes invalid optional HR enums and dates to null', () => {
    const input = make<User>(baseUser, {
      hireDate: 'not-a-date',
      terminationDate: null,
      contractType: 'bad-contract',
      employmentStatus: 'bad-status',
      workLocation: 'bad-location',
    });

    const result = normalizeUser(input);

    expect(result.hireDate).toBeNull();
    expect(result.terminationDate).toBeNull();
    expect(result.contractType).toBeNull();
    expect(result.employmentStatus).toBeNull();
    expect(result.workLocation).toBeNull();
  });

  test('returns 0 for non-finite costPerHour input', () => {
    const input = make<User>(baseUser, { costPerHour: 'not-a-number' });
    expect(normalizeUser(input).costPerHour).toBe(0);
  });

  test('normalizes availableRoles: drops invalid entries and coerces booleans', () => {
    const input = make<User>(baseUser, {
      availableRoles: [
        { id: 'r1', name: 'Admin', isSystem: 1, isAdmin: true },
        { id: '', name: 'NoId' },
        { id: 'r3', name: '' },
        null,
        'string-entry',
        { id: '  r4  ', name: '  User  ' },
      ],
    });
    expect(normalizeUser(input).availableRoles).toEqual([
      { id: 'r1', name: 'Admin', isSystem: true, isAdmin: true },
      { id: 'r4', name: 'User', isSystem: false, isAdmin: false },
    ]);
  });

  test('returns empty array for non-array availableRoles', () => {
    const input = make<User>(baseUser, { availableRoles: 'not-an-array' });
    expect(normalizeUser(input).availableRoles).toEqual([]);
  });

  test('returns empty array for non-array permissions', () => {
    const input = make<User>(baseUser, { permissions: 'read' });
    expect(normalizeUser(input).permissions).toEqual([]);
  });

  test('accepts "external" employeeType', () => {
    const input = make<User>(baseUser, { employeeType: 'external' });
    expect(normalizeUser(input).employeeType).toBe('external');
  });
});

describe('normalizeProduct', () => {
  test('parses costo and molPercentage as numbers', () => {
    const input = make<Product>(baseProduct, { costo: '12.5', molPercentage: '20' });
    const result = normalizeProduct(input);
    expect(result.costo).toBe(12.5);
    expect(result.molPercentage).toBe(20);
  });

  test('falls back to 0 when costo/molPercentage are nullish', () => {
    const input = make<Product>(baseProduct, { costo: undefined, molPercentage: null });
    const result = normalizeProduct(input);
    expect(result.costo).toBe(0);
    expect(result.molPercentage).toBe(0);
  });
});

describe('normalizeQuoteItem', () => {
  test('coerces numeric fields and preserves note', () => {
    const item = make<QuoteItem>(baseQuoteItem, {
      quantity: '3',
      unitPrice: '15.5',
      productCost: 8,
      productMolPercentage: 25,
      discount: 5,
      note: 'Test note',
    });
    const result = normalizeQuoteItem(item);
    expect(result.quantity).toBe(3);
    expect(result.unitPrice).toBe(15.5);
    expect(result.productCost).toBe(8);
    expect(result.productMolPercentage).toBe(25);
    expect(result.discount).toBe(5);
    expect(result.note).toBe('Test note');
  });

  test('coerces durationMonths and defaults a missing/invalid value to 1', () => {
    expect(
      normalizeQuoteItem(make<QuoteItem>(baseQuoteItem, { durationMonths: '12' })).durationMonths,
    ).toBe(12);
    expect(
      normalizeQuoteItem(make<QuoteItem>(baseQuoteItem, { durationMonths: undefined }))
        .durationMonths,
    ).toBe(1);
    expect(
      normalizeQuoteItem(make<QuoteItem>(baseQuoteItem, { durationMonths: 0 })).durationMonths,
    ).toBe(1);
  });

  test("durationUnit defaults to 'months', preserves 'years', and normalizes invalid values (issue #757)", () => {
    expect(
      normalizeQuoteItem(make<QuoteItem>(baseQuoteItem, { durationUnit: undefined })).durationUnit,
    ).toBe('months');
    expect(
      normalizeQuoteItem(make<QuoteItem>(baseQuoteItem, { durationUnit: 'years' })).durationUnit,
    ).toBe('years');
    expect(
      normalizeQuoteItem(make<QuoteItem>(baseQuoteItem, { durationUnit: 'decades' })).durationUnit,
    ).toBe('months');
  });

  test('defaults missing/null fields to 0 / null / empty string', () => {
    const item = make<QuoteItem>(baseQuoteItem, {
      quantity: undefined,
      unitPrice: undefined,
      productCost: undefined,
      productMolPercentage: null,
      discount: undefined,
      note: undefined,
    });
    const result = normalizeQuoteItem(item);
    expect(result.quantity).toBe(0);
    expect(result.unitPrice).toBe(0);
    expect(result.productCost).toBe(0);
    expect(result.productMolPercentage).toBeNull();
    expect(result.discount).toBe(0);
    expect(result.note).toBe('');
    expect(result.supplierQuoteId).toBeNull();
    expect(result.supplierQuoteItemId).toBeNull();
    expect(result.supplierQuoteSupplierName).toBeNull();
    expect(result.supplierQuoteUnitPrice).toBeNull();
  });

  test('preserves supplier-quote linkage fields', () => {
    const item = make<QuoteItem>(baseQuoteItem, {
      supplierQuoteId: 'sq-1',
      supplierQuoteItemId: 'sqi-1',
      supplierQuoteSupplierName: 'SupplierCo',
      supplierQuoteUnitPrice: 7.25,
    });
    const result = normalizeQuoteItem(item);
    expect(result.supplierQuoteId).toBe('sq-1');
    expect(result.supplierQuoteItemId).toBe('sqi-1');
    expect(result.supplierQuoteSupplierName).toBe('SupplierCo');
    expect(result.supplierQuoteUnitPrice).toBe(7.25);
  });
});

describe('normalizeQuote', () => {
  test('parses discount and normalizes nested items', () => {
    const quote = make<Quote>(baseQuote, {
      discount: '10',
      items: [make<QuoteItem>(baseQuoteItem, { quantity: '2', unitPrice: 50 })],
    });
    const result = normalizeQuote(quote);
    expect(result.discount).toBe(10);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(2);
  });

  test('treats missing items as empty array', () => {
    const quote = make<Quote>(baseQuote, { items: undefined });
    const result = normalizeQuote(quote);
    expect(result.items).toEqual([]);
    expect(result.discount).toBe(0);
  });

  test('preserves communication channel fields', () => {
    const result = normalizeQuote(
      make<Quote>(baseQuote, {
        communicationChannelId: 'qcc_whatsapp',
        communicationChannelName: 'WhatsApp',
      }),
    );
    expect(result.communicationChannelId).toBe('qcc_whatsapp');
    expect(result.communicationChannelName).toBe('WhatsApp');
  });
});

describe('normalizeClientOfferItem', () => {
  test('maps numeric fields and forces note default', () => {
    const item = make<ClientOfferItem>(baseOfferItem, {
      quantity: '4',
      unitPrice: 12.5,
      productCost: 6,
      discount: 5,
    });
    const result = normalizeClientOfferItem(item);
    expect(result.quantity).toBe(4);
    expect(result.unitPrice).toBe(12.5);
    expect(result.productCost).toBe(6);
    expect(result.discount).toBe(5);
    expect(result.note).toBe('');
  });

  test('handles minimal input safely', () => {
    const item = make<ClientOfferItem>(baseOfferItem, {
      quantity: undefined,
      unitPrice: undefined,
    });
    const result = normalizeClientOfferItem(item);
    expect(result.quantity).toBe(0);
    expect(result.unitPrice).toBe(0);
    expect(result.productCost).toBe(0);
    expect(result.productMolPercentage).toBeNull();
  });

  test('coerces durationMonths and defaults missing/invalid values to 1 (issue #757)', () => {
    expect(
      normalizeClientOfferItem(make<ClientOfferItem>(baseOfferItem, { durationMonths: '12' }))
        .durationMonths,
    ).toBe(12);
    expect(
      normalizeClientOfferItem(make<ClientOfferItem>(baseOfferItem, { durationMonths: undefined }))
        .durationMonths,
    ).toBe(1);
    expect(
      normalizeClientOfferItem(make<ClientOfferItem>(baseOfferItem, { durationMonths: 0 }))
        .durationMonths,
    ).toBe(1);
  });

  test("durationUnit defaults to 'months', preserves 'years', and normalizes invalid values (issue #757)", () => {
    expect(
      normalizeClientOfferItem(make<ClientOfferItem>(baseOfferItem, { durationUnit: undefined }))
        .durationUnit,
    ).toBe('months');
    expect(
      normalizeClientOfferItem(make<ClientOfferItem>(baseOfferItem, { durationUnit: 'years' }))
        .durationUnit,
    ).toBe('years');
    expect(
      normalizeClientOfferItem(make<ClientOfferItem>(baseOfferItem, { durationUnit: 'decades' }))
        .durationUnit,
    ).toBe('months');
  });
});

describe('normalizeClientOffer', () => {
  test('happy path with items', () => {
    const offer = make<ClientOffer>(baseClientOffer, {
      discount: 15,
      deliveryDate: '2026-05-14T00:00:00.000Z',
      items: [make<ClientOfferItem>(baseOfferItem, { quantity: 3, unitPrice: 20 })],
    });
    const result = normalizeClientOffer(offer);
    expect(result.discount).toBe(15);
    expect(result.deliveryDate).toBe('2026-05-14');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(3);
  });

  test('null/undefined items become empty array', () => {
    const offer = make<ClientOffer>(baseClientOffer, { items: null });
    const result = normalizeClientOffer(offer);
    expect(result.items).toEqual([]);
    expect(result.discount).toBe(0);
  });
});

describe('normalizeClientsOrderItem', () => {
  test('parses numeric fields, no note default', () => {
    const item = make<ClientsOrderItem>(baseClientsOrderItem, {
      quantity: '5',
      unitPrice: 30,
      discount: 8,
    });
    const result = normalizeClientsOrderItem(item);
    expect(result.quantity).toBe(5);
    expect(result.unitPrice).toBe(30);
    expect(result.discount).toBe(8);
    // Unlike quote/offer items, normalizeClientsOrderItem does not force a note default.
  });

  test('handles missing supplier sale fields by defaulting to null', () => {
    const result = normalizeClientsOrderItem(baseClientsOrderItem);
    expect(result.supplierSaleId).toBeNull();
    expect(result.supplierSaleItemId).toBeNull();
    expect(result.supplierSaleSupplierName).toBeNull();
  });

  test('coerces durationMonths and defaults missing/invalid values to 1 (issue #757)', () => {
    expect(
      normalizeClientsOrderItem(
        make<ClientsOrderItem>(baseClientsOrderItem, { durationMonths: '12' }),
      ).durationMonths,
    ).toBe(12);
    expect(
      normalizeClientsOrderItem(
        make<ClientsOrderItem>(baseClientsOrderItem, { durationMonths: undefined }),
      ).durationMonths,
    ).toBe(1);
    expect(
      normalizeClientsOrderItem(make<ClientsOrderItem>(baseClientsOrderItem, { durationMonths: 0 }))
        .durationMonths,
    ).toBe(1);
  });

  test("durationUnit defaults to 'months', preserves 'years', and normalizes invalid values (issue #757)", () => {
    expect(
      normalizeClientsOrderItem(
        make<ClientsOrderItem>(baseClientsOrderItem, { durationUnit: undefined }),
      ).durationUnit,
    ).toBe('months');
    expect(
      normalizeClientsOrderItem(
        make<ClientsOrderItem>(baseClientsOrderItem, { durationUnit: 'years' }),
      ).durationUnit,
    ).toBe('years');
    expect(
      normalizeClientsOrderItem(
        make<ClientsOrderItem>(baseClientsOrderItem, { durationUnit: 'decades' }),
      ).durationUnit,
    ).toBe('months');
  });

  test('preserves provided supplier sale fields', () => {
    const item = make<ClientsOrderItem>(baseClientsOrderItem, {
      supplierSaleId: 'ss-1',
      supplierSaleItemId: 'ssi-1',
      supplierSaleSupplierName: 'Vendor',
    });
    const result = normalizeClientsOrderItem(item);
    expect(result.supplierSaleId).toBe('ss-1');
    expect(result.supplierSaleItemId).toBe('ssi-1');
    expect(result.supplierSaleSupplierName).toBe('Vendor');
  });
});

describe('normalizeClientsOrder', () => {
  test('parses discount and normalizes items', () => {
    const order = make<ClientsOrder>(baseClientsOrder, {
      discount: '10',
      items: [make<ClientsOrderItem>(baseClientsOrderItem, { quantity: 2 })],
    });
    const result = normalizeClientsOrder(order);
    expect(result.discount).toBe(10);
    expect(result.items[0].quantity).toBe(2);
  });

  test('defaults nullish items to empty array', () => {
    const order = make<ClientsOrder>(baseClientsOrder, { items: undefined });
    expect(normalizeClientsOrder(order).items).toEqual([]);
  });
});

describe('normalizeTimeEntry', () => {
  test('parses duration, version, hourlyCost, and cost as numbers', () => {
    const entry = make<TimeEntry>(baseTimeEntry, {
      duration: '2.5',
      version: '3',
      hourlyCost: '50',
      cost: '125',
    });
    const result = normalizeTimeEntry(entry);
    expect(result.duration).toBe(2.5);
    expect(result.version).toBe(3);
    expect(result.hourlyCost).toBe(50);
    expect(result.cost).toBe(125);
  });

  test('defaults missing duration to 0; keeps hourlyCost/cost absent when stripped server-side', () => {
    // The server omits hourlyCost / cost entirely when the caller lacks
    // `reports.cost.view`. The normalizer must preserve that absence so callers can
    // branch on permission visibility instead of misreading a 0 as "no cost".
    const entry = make<TimeEntry>(baseTimeEntry, {
      duration: undefined,
      hourlyCost: undefined,
      cost: undefined,
    });
    const result = normalizeTimeEntry(entry);
    expect(result.duration).toBe(0);
    expect(result.hourlyCost).toBeUndefined();
    expect(result.cost).toBeUndefined();
  });
});

describe('normalizeTask', () => {
  const baseTask: ProjectTask = { id: 't-1', name: 'Test task', projectId: 'pr-1' };

  test('parses recurrenceDuration, effort, duration, revenue, and totalRevenue', () => {
    const task = make<ProjectTask>(baseTask, {
      recurrenceDuration: '7',
      expectedEffort: '8',
      monthlyEffort: '3',
      duration: '4',
      revenue: '100',
      totalRevenue: '400',
    });
    const result = normalizeTask(task);
    expect(result.recurrenceDuration).toBe(7);
    expect(result.expectedEffort).toBe(8);
    expect(result.monthlyEffort).toBe(3);
    expect(result.duration).toBe(4);
    expect(result.revenue).toBe(100);
    expect(result.totalRevenue).toBe(400);
  });

  test('defaults recurrenceDuration to 0 and derives missing totals from duration defaults', () => {
    const result = normalizeTask(baseTask);
    expect(result.recurrenceDuration).toBe(0);
    expect(result.expectedEffort).toBe(0);
    expect(result.monthlyEffort).toBeUndefined();
    expect(result.duration).toBe(1);
    expect(result.revenue).toBeUndefined();
    expect(result.totalRevenue).toBe(0);
    expect(result.billingType).toBe('time_and_materials');
    expect(result.billingFrequency).toBe('monthly');
  });

  test('coerces 0 effort, duration, and revenue fields (defined → Number)', () => {
    const task = make<ProjectTask>(baseTask, {
      expectedEffort: 0,
      monthlyEffort: 0,
      duration: 0,
      revenue: 0,
      totalRevenue: 0,
    });
    const result = normalizeTask(task);
    expect(result.expectedEffort).toBe(0);
    expect(result.monthlyEffort).toBe(0);
    expect(result.duration).toBe(0);
    expect(result.revenue).toBe(0);
    expect(result.totalRevenue).toBe(0);
  });

  test('derives missing expectedEffort and totalRevenue from monthly effort, revenue, and duration', () => {
    const task = make<ProjectTask>(baseTask, {
      monthlyEffort: '2.5',
      duration: '3',
      revenue: '100',
    });
    const result = normalizeTask(task);
    expect(result.expectedEffort).toBe(7.5);
    expect(result.totalRevenue).toBe(300);
  });

  test('preserves one_time frequency for time and materials tasks', () => {
    const task = make<ProjectTask>(baseTask, {
      billingType: 'time_and_materials',
      billingFrequency: 'one_time',
    });
    expect(normalizeTask(task).billingFrequency).toBe('one_time');
  });

  test('keeps the provided frequency on legacy partial billing payloads', () => {
    const task = make<ProjectTask>(baseTask, { billingFrequency: 'one_time' });
    expect(normalizeTask(task)).toMatchObject({
      billingType: 'time_and_materials',
      billingFrequency: 'one_time',
    });
  });

  test('does not preserve mixed billing type on tasks but keeps the frequency', () => {
    const task = make<ProjectTask>(baseTask, {
      billingType: 'mixed',
      billingFrequency: 'one_time',
    });
    expect(normalizeTask(task)).toMatchObject({
      billingType: 'time_and_materials',
      billingFrequency: 'one_time',
    });
  });
});

describe('normalizeProject', () => {
  const baseProject: Project = {
    id: 'p-1',
    name: 'Project',
    clientId: 'c-1',
  };

  test('keeps the provided frequency on legacy partial billing payloads', () => {
    const project = make<Project>(baseProject, { billingFrequency: 'one_time' });
    expect(normalizeProject(project)).toMatchObject({
      billingType: 'time_and_materials',
      billingFrequency: 'one_time',
    });
  });

  test('preserves derived mixed billing type and the provided frequency on projects', () => {
    const project = make<Project>(baseProject, {
      billingType: 'mixed',
      billingFrequency: 'one_time',
    });
    expect(normalizeProject(project)).toMatchObject({
      billingType: 'mixed',
      billingFrequency: 'one_time',
    });
  });
});

describe('normalizeResale', () => {
  const baseResale: Resale = {
    id: 'rv-1',
    clientOrderId: 'ord-1',
    supplierOrderId: 'so-1',
    clientName: 'Acme',
    supplierName: 'Supplier',
    supplierOrderCost: 0,
    activityCostTotal: 0,
    resaleRevenue: 0,
    costVariance: 0,
    startDate: null,
    dueDate: null,
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    activities: [],
  };

  test('normalizes totals, activity billing frequency, dates, and nullable notes', () => {
    const result = normalizeResale(
      make<Resale>(baseResale, {
        supplierOrderCost: '120.50',
        activityCostTotal: '100',
        resaleRevenue: '180',
        costVariance: '20.5',
        startDate: '2026-04-01T12:00:00.000Z',
        dueDate: '2026-04-15T12:00:00.000Z',
        notes: undefined,
        activities: [
          {
            id: 'rva-1',
            resaleId: 'rv-1',
            name: 'Licenza',
            billingFrequency: 'legacy-value',
            categoryId: 'rvc-licenza',
            categoryName: 'Licenza',
            cost: '100',
            revenue: '180',
            released: 'yes',
            dueDate: '2026-05-01T12:00:00.000Z',
            notes: undefined,
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      supplierOrderCost: 120.5,
      activityCostTotal: 100,
      resaleRevenue: 180,
      costVariance: 20.5,
      startDate: '2026-04-01',
      dueDate: '2026-04-15',
      notes: null,
    });
    expect(result.activities[0]).toMatchObject({
      billingFrequency: 'one_time',
      cost: 100,
      revenue: 180,
      released: false,
      dueDate: '2026-05-01',
      notes: null,
    });
  });
});

describe('normalizeResaleCategory', () => {
  test('normalizes activity counters and linked state', () => {
    const category = make<ResaleCategory>(
      { id: 'rvc-1', name: 'Hardware' },
      { activityCount: '2', hasLinkedActivities: 'true' },
    );

    expect(normalizeResaleCategory(category)).toMatchObject({
      activityCount: 2,
      hasLinkedActivities: false,
    });
  });
});

describe('normalizeResaleOrderOption', () => {
  test('normalizes supplier order totals and missing supplier order arrays', () => {
    const option = make<ResaleOrderOption>(
      { clientOrderId: 'ord-1', clientName: 'Acme', supplierOrders: [] },
      { supplierOrders: [{ id: 'so-1', supplierName: 'Supplier', total: '42.5' }] },
    );

    expect(normalizeResaleOrderOption(option).supplierOrders).toEqual([
      { id: 'so-1', supplierName: 'Supplier', total: 42.5 },
    ]);
    expect(
      normalizeResaleOrderOption(
        make<ResaleOrderOption>(
          { clientOrderId: 'ord-2', clientName: 'Beta', supplierOrders: [] },
          {
            supplierOrders: undefined,
          },
        ),
      ).supplierOrders,
    ).toEqual([]);
  });
});

describe('normalizeGeneralSettings', () => {
  test('parses dailyLimit as a number', () => {
    const settings = make<GeneralSettings>(baseGeneralSettings, { dailyLimit: '8' });
    expect(normalizeGeneralSettings(settings).dailyLimit).toBe(8);
  });

  test('falls back to 0 for missing dailyLimit', () => {
    const settings = make<GeneralSettings>(baseGeneralSettings, { dailyLimit: undefined });
    expect(normalizeGeneralSettings(settings).dailyLimit).toBe(0);
  });

  test('normalizes RIL settings defaults', () => {
    const settings = make<GeneralSettings>(baseGeneralSettings, {
      rilCompanyName: undefined,
      rilDefaultStartTime: '',
      rilDefaultExitTime: '',
      rilLunchBreakMinutes: undefined,
      rilNoteOptions: undefined,
      rilTransferOptions: undefined,
    });
    expect(normalizeGeneralSettings(settings)).toMatchObject({
      rilCompanyName: '',
      rilDefaultStartTime: '09:00',
      rilDefaultExitTime: '18:00',
      rilLunchBreakMinutes: 60,
      rilNoteOptions: [
        { value: 'P', label: 'Ferie' },
        { value: 'P2', label: 'Permesso' },
        { value: 'M', label: 'Malattia' },
        { value: 'F', label: 'Festivita' },
      ],
      rilTransferOptions: ['In sede', 'Telelavoro'],
    });
  });

  test('normalizes custom RIL option settings', () => {
    const settings = make<GeneralSettings>(baseGeneralSettings, {
      rilNoteOptions: [
        { value: ' P ', label: ' Paid leave ' },
        { value: 'P', label: 'Duplicate' },
      ],
      rilTransferOptions: [' Office ', 'Office', ' Remote '],
    });
    expect(normalizeGeneralSettings(settings)).toMatchObject({
      rilNoteOptions: [{ value: 'P', label: 'Paid leave' }],
      rilTransferOptions: ['Office', 'Remote'],
    });
  });

  test('preserves provided 2FA policy fields', () => {
    const settings = make<GeneralSettings>(baseGeneralSettings, {
      enableTotp: false,
      enforceTotp: true,
      totpEnforcedRoleIds: ['admin'],
      totpExemptRoleIds: ['service-account'],
    });
    expect(normalizeGeneralSettings(settings)).toMatchObject({
      enableTotp: false,
      enforceTotp: true,
      totpEnforcedRoleIds: ['admin'],
      totpExemptRoleIds: ['service-account'],
    });
  });

  test('defaults missing 2FA policy fields (enableTotp true, enforceTotp false, role lists [])', () => {
    const settings = make<GeneralSettings>(baseGeneralSettings, {
      enableTotp: undefined,
      enforceTotp: undefined,
      totpEnforcedRoleIds: undefined,
      totpExemptRoleIds: undefined,
    });
    expect(normalizeGeneralSettings(settings)).toMatchObject({
      enableTotp: true,
      enforceTotp: false,
      totpEnforcedRoleIds: [],
      totpExemptRoleIds: [],
    });
  });
});

describe('normalizeInvoiceItem', () => {
  test('keeps "unit" unitOfMeasure when set', () => {
    const item = make<InvoiceItem>(baseInvoiceItem, { unitOfMeasure: 'unit' });
    expect(normalizeInvoiceItem(item).unitOfMeasure).toBe('unit');
  });

  test('keeps "hours" unitOfMeasure when set', () => {
    const item = make<InvoiceItem>(baseInvoiceItem, {
      unitOfMeasure: 'hours',
      quantity: 3,
      unitPrice: 50,
    });
    const result = normalizeInvoiceItem(item);
    expect(result.unitOfMeasure).toBe('hours');
    expect(result.quantity).toBe(3);
    expect(result.unitPrice).toBe(50);
  });

  test('falls back to "unit" for unknown unitOfMeasure (kg)', () => {
    const item = make<InvoiceItem>(baseInvoiceItem, { unitOfMeasure: 'kg' });
    expect(normalizeInvoiceItem(item).unitOfMeasure).toBe('unit');
  });

  test('coerces durationMonths and defaults missing/invalid values to 1 (issue #757)', () => {
    expect(
      normalizeInvoiceItem(make<InvoiceItem>(baseInvoiceItem, { durationMonths: '12' }))
        .durationMonths,
    ).toBe(12);
    expect(
      normalizeInvoiceItem(make<InvoiceItem>(baseInvoiceItem, { durationMonths: undefined }))
        .durationMonths,
    ).toBe(1);
    expect(
      normalizeInvoiceItem(make<InvoiceItem>(baseInvoiceItem, { durationMonths: 0 }))
        .durationMonths,
    ).toBe(1);
  });

  test("durationUnit defaults to 'months', preserves 'years', and normalizes invalid values (issue #757)", () => {
    expect(
      normalizeInvoiceItem(make<InvoiceItem>(baseInvoiceItem, { durationUnit: undefined }))
        .durationUnit,
    ).toBe('months');
    expect(
      normalizeInvoiceItem(make<InvoiceItem>(baseInvoiceItem, { durationUnit: 'years' }))
        .durationUnit,
    ).toBe('years');
    expect(
      normalizeInvoiceItem(make<InvoiceItem>(baseInvoiceItem, { durationUnit: 'decades' }))
        .durationUnit,
    ).toBe('months');
  });

  test('falls back to "unit" for unknown unitOfMeasure (days)', () => {
    // Regression: the old `=== 'hours' ? 'hours' : 'unit'` pattern would have done the
    // same thing here. The new allowlist still rejects 'days' because it's not in the
    // server enum — but the allowlist makes that decision explicit instead of
    // silently flattening every non-'hours' value, so adding new units later is a
    // single-line change.
    const item = make<InvoiceItem>(baseInvoiceItem, { unitOfMeasure: 'days' });
    expect(normalizeInvoiceItem(item).unitOfMeasure).toBe('unit');
  });

  test('falls back to "unit" for missing/null/undefined unitOfMeasure', () => {
    expect(
      normalizeInvoiceItem(make<InvoiceItem>(baseInvoiceItem, { unitOfMeasure: undefined }))
        .unitOfMeasure,
    ).toBe('unit');
    expect(
      normalizeInvoiceItem(make<InvoiceItem>(baseInvoiceItem, { unitOfMeasure: null }))
        .unitOfMeasure,
    ).toBe('unit');
    expect(
      normalizeInvoiceItem(make<InvoiceItem>(baseInvoiceItem, { unitOfMeasure: '' })).unitOfMeasure,
    ).toBe('unit');
  });

  test('defaults missing numeric fields to 0', () => {
    const item = make<InvoiceItem>(baseInvoiceItem, {
      quantity: undefined,
      unitPrice: undefined,
      discount: undefined,
      taxRate: undefined,
    });
    const result = normalizeInvoiceItem(item);
    expect(result.quantity).toBe(0);
    expect(result.unitPrice).toBe(0);
    expect(result.discount).toBe(0);
    expect(result.taxRate).toBe(0);
  });

  test('coerces string taxRate to number', () => {
    const item = make<InvoiceItem>(baseInvoiceItem, { taxRate: '22' });
    expect(normalizeInvoiceItem(item).taxRate).toBe(22);
  });
});

describe('normalizeInvoice', () => {
  test('parses subtotal/taxTotal/total/amountPaid and normalizes items', () => {
    const invoice = make<Invoice>(baseInvoice, {
      subtotal: '100',
      taxTotal: '22',
      total: '122',
      amountPaid: '50',
      items: [make<InvoiceItem>(baseInvoiceItem, { quantity: 2, unitPrice: 60, taxRate: '22' })],
    });
    const result = normalizeInvoice(invoice);
    expect(result.subtotal).toBe(100);
    expect(result.taxTotal).toBe(22);
    expect(result.total).toBe(122);
    expect(result.amountPaid).toBe(50);
    expect(result.items[0].quantity).toBe(2);
    expect(result.items[0].taxRate).toBe(22);
  });

  test('defaults all monetary fields to 0 and items to []', () => {
    const invoice = make<Invoice>(baseInvoice, {
      subtotal: undefined,
      taxTotal: undefined,
      total: undefined,
      amountPaid: undefined,
      items: undefined,
    });
    const result = normalizeInvoice(invoice);
    expect(result.subtotal).toBe(0);
    expect(result.taxTotal).toBe(0);
    expect(result.total).toBe(0);
    expect(result.amountPaid).toBe(0);
    expect(result.items).toEqual([]);
  });
});

describe('normalizeSupplierQuoteItem', () => {
  test('parses numbers and preserves note', () => {
    const item = make<SupplierQuoteItem>(baseSupplierQuoteItem, {
      quantity: '4',
      listPrice: '20',
      discountPercent: '10',
      unitPrice: '7.5',
      note: 'Important',
    });
    const result = normalizeSupplierQuoteItem(item);
    expect(result.quantity).toBe(4);
    expect(result.listPrice).toBe(20);
    expect(result.discountPercent).toBe(10);
    expect(result.unitPrice).toBe(7.5);
    expect(result.note).toBe('Important');
  });

  test('defaults missing fields safely', () => {
    const item = make<SupplierQuoteItem>(baseSupplierQuoteItem, {
      quantity: undefined,
      listPrice: undefined,
      discountPercent: undefined,
      unitPrice: undefined,
      note: undefined,
    });
    const result = normalizeSupplierQuoteItem(item);
    expect(result.quantity).toBe(0);
    expect(result.listPrice).toBe(0);
    expect(result.discountPercent).toBe(0);
    expect(result.unitPrice).toBe(0);
    expect(result.note).toBe('');
  });

  test('falls back to net unit price as list price for legacy items', () => {
    const item = make<SupplierQuoteItem>(baseSupplierQuoteItem, {
      listPrice: undefined,
      discountPercent: undefined,
      unitPrice: '9',
    });
    const result = normalizeSupplierQuoteItem(item);
    expect(result.listPrice).toBe(9);
    expect(result.discountPercent).toBe(0);
    expect(result.unitPrice).toBe(9);
  });

  test('coerces durationMonths and defaults a missing/invalid value to 1 (issue #776)', () => {
    expect(
      normalizeSupplierQuoteItem(
        make<SupplierQuoteItem>(baseSupplierQuoteItem, { durationMonths: '12' }),
      ).durationMonths,
    ).toBe(12);
    expect(
      normalizeSupplierQuoteItem(
        make<SupplierQuoteItem>(baseSupplierQuoteItem, { durationMonths: undefined }),
      ).durationMonths,
    ).toBe(1);
    expect(
      normalizeSupplierQuoteItem(
        make<SupplierQuoteItem>(baseSupplierQuoteItem, { durationMonths: 0 }),
      ).durationMonths,
    ).toBe(1);
  });

  test("durationUnit defaults to 'months', preserves 'years', and normalizes invalid values (issue #776)", () => {
    expect(
      normalizeSupplierQuoteItem(
        make<SupplierQuoteItem>(baseSupplierQuoteItem, { durationUnit: undefined }),
      ).durationUnit,
    ).toBe('months');
    expect(
      normalizeSupplierQuoteItem(
        make<SupplierQuoteItem>(baseSupplierQuoteItem, { durationUnit: 'years' }),
      ).durationUnit,
    ).toBe('years');
    expect(
      normalizeSupplierQuoteItem(
        make<SupplierQuoteItem>(baseSupplierQuoteItem, { durationUnit: 'decades' }),
      ).durationUnit,
    ).toBe('months');
  });
});

describe('normalizeSupplierQuote', () => {
  test('normalizes nested items', () => {
    const quote = make<SupplierQuote>(baseSupplierQuote, {
      items: [make<SupplierQuoteItem>(baseSupplierQuoteItem, { quantity: 2, unitPrice: 5 })],
    });
    const result = normalizeSupplierQuote(quote);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(2);
  });

  test('defaults missing items to empty array', () => {
    const quote = make<SupplierQuote>(baseSupplierQuote, { items: undefined });
    expect(normalizeSupplierQuote(quote).items).toEqual([]);
  });

  test('preserves communication channel fields', () => {
    const result = normalizeSupplierQuote(
      make<SupplierQuote>(baseSupplierQuote, {
        communicationChannelId: 'qcc_telefono',
        communicationChannelName: 'Telefono',
      }),
    );
    expect(result.communicationChannelId).toBe('qcc_telefono');
    expect(result.communicationChannelName).toBe('Telefono');
  });
});

describe('normalizeSupplierSaleOrderItem', () => {
  test('parses numbers, discount and note', () => {
    const item = make<SupplierSaleOrderItem>(baseSupplierSaleOrderItem, {
      quantity: '3',
      unitPrice: 12,
      discount: 4,
      note: 'note',
    });
    const result = normalizeSupplierSaleOrderItem(item);
    expect(result.quantity).toBe(3);
    expect(result.unitPrice).toBe(12);
    expect(result.discount).toBe(4);
    expect(result.note).toBe('note');
  });

  test('defaults missing fields to 0 / empty', () => {
    const item = make<SupplierSaleOrderItem>(baseSupplierSaleOrderItem, {
      quantity: undefined,
      unitPrice: undefined,
      discount: undefined,
      note: undefined,
    });
    const result = normalizeSupplierSaleOrderItem(item);
    expect(result.quantity).toBe(0);
    expect(result.unitPrice).toBe(0);
    expect(result.discount).toBe(0);
    expect(result.note).toBe('');
  });

  test('coerces durationMonths and defaults a missing/invalid value to 1 (issue #776)', () => {
    expect(
      normalizeSupplierSaleOrderItem(
        make<SupplierSaleOrderItem>(baseSupplierSaleOrderItem, { durationMonths: '12' }),
      ).durationMonths,
    ).toBe(12);
    expect(
      normalizeSupplierSaleOrderItem(
        make<SupplierSaleOrderItem>(baseSupplierSaleOrderItem, { durationMonths: undefined }),
      ).durationMonths,
    ).toBe(1);
    expect(
      normalizeSupplierSaleOrderItem(
        make<SupplierSaleOrderItem>(baseSupplierSaleOrderItem, { durationMonths: 0 }),
      ).durationMonths,
    ).toBe(1);
  });

  test("durationUnit defaults to 'months', preserves 'years', and normalizes invalid values (issue #776)", () => {
    expect(
      normalizeSupplierSaleOrderItem(
        make<SupplierSaleOrderItem>(baseSupplierSaleOrderItem, { durationUnit: undefined }),
      ).durationUnit,
    ).toBe('months');
    expect(
      normalizeSupplierSaleOrderItem(
        make<SupplierSaleOrderItem>(baseSupplierSaleOrderItem, { durationUnit: 'years' }),
      ).durationUnit,
    ).toBe('years');
    expect(
      normalizeSupplierSaleOrderItem(
        make<SupplierSaleOrderItem>(baseSupplierSaleOrderItem, { durationUnit: 'decades' }),
      ).durationUnit,
    ).toBe('months');
  });
});

describe('normalizeSupplierSaleOrder', () => {
  test('parses discount and normalizes items', () => {
    const order = make<SupplierSaleOrder>(baseSupplierSaleOrder, {
      discount: '5',
      items: [make<SupplierSaleOrderItem>(baseSupplierSaleOrderItem, { quantity: 2 })],
    });
    const result = normalizeSupplierSaleOrder(order);
    expect(result.discount).toBe(5);
    expect(result.items[0].quantity).toBe(2);
  });

  test('handles missing items', () => {
    const order = make<SupplierSaleOrder>(baseSupplierSaleOrder, { items: undefined });
    const result = normalizeSupplierSaleOrder(order);
    expect(result.items).toEqual([]);
    expect(result.discount).toBe(0);
  });
});

describe('normalizeSupplierInvoiceItem', () => {
  test('parses quantity, unitPrice and discount', () => {
    const item = make<SupplierInvoiceItem>(baseSupplierInvoiceItem, {
      quantity: '2',
      unitPrice: 30,
      discount: 5,
    });
    const result = normalizeSupplierInvoiceItem(item);
    expect(result.quantity).toBe(2);
    expect(result.unitPrice).toBe(30);
    expect(result.discount).toBe(5);
  });

  test('defaults missing numeric fields to 0', () => {
    const item = make<SupplierInvoiceItem>(baseSupplierInvoiceItem, {
      quantity: undefined,
      unitPrice: undefined,
      discount: undefined,
    });
    const result = normalizeSupplierInvoiceItem(item);
    expect(result.quantity).toBe(0);
    expect(result.unitPrice).toBe(0);
    expect(result.discount).toBe(0);
  });
});

describe('normalizeSupplierInvoice', () => {
  test('parses monetary fields and normalizes items', () => {
    const invoice = make<SupplierInvoice>(baseSupplierInvoice, {
      subtotal: '90',
      total: '110',
      amountPaid: '40',
      items: [make<SupplierInvoiceItem>(baseSupplierInvoiceItem, { quantity: 2 })],
    });
    const result = normalizeSupplierInvoice(invoice);
    expect(result.subtotal).toBe(90);
    expect(result.total).toBe(110);
    expect(result.amountPaid).toBe(40);
    expect(result.items[0].quantity).toBe(2);
  });

  test('defaults nullish monetary fields and items', () => {
    const invoice = make<SupplierInvoice>(baseSupplierInvoice, {
      subtotal: undefined,
      total: undefined,
      amountPaid: undefined,
      items: undefined,
    });
    const result = normalizeSupplierInvoice(invoice);
    expect(result.subtotal).toBe(0);
    expect(result.total).toBe(0);
    expect(result.amountPaid).toBe(0);
    expect(result.items).toEqual([]);
  });
});
