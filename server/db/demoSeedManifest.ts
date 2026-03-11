const rangeIds = (prefix: string, count: number, pad = 2) =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(pad, '0')}`);

const currentYear = new Date().getFullYear();

export const DEMO_PASSWORD_HASH = '$2a$12$z5H7VrzTpLImYWSH3xufKufCiGB0n9CSlNMOrRBRIxq.6mvuVS7uy';

export const DEMO_CACHE_NAMESPACES = ['clients', 'products', 'projects', 'tasks', 'users'] as const;

export const DEMO_USERS = [
  {
    id: 'u2',
    name: 'Manager User',
    username: 'manager',
    role: 'manager',
    avatarInitials: 'MG',
    fullName: 'Manager User',
    email: 'manager@example.com',
    costPerHour: 65.0,
  },
  {
    id: 'u3',
    name: 'Standard User',
    username: 'user',
    role: 'user',
    avatarInitials: 'US',
    fullName: 'Standard User',
    email: 'user@example.com',
    costPerHour: 45.0,
  },
  {
    id: 'u4',
    name: 'Sales Manager',
    username: 'salesmanager',
    role: 'manager',
    avatarInitials: 'SM',
    fullName: 'Sales Manager',
    email: 'salesmanager@example.com',
    costPerHour: 60.0,
  },
  {
    id: 'u5',
    name: 'Elena Rossi',
    username: 'erossi',
    role: 'user',
    avatarInitials: 'ER',
    fullName: 'Elena Rossi',
    email: 'erossi@example.com',
    costPerHour: 50.0,
  },
  {
    id: 'u6',
    name: 'Marco Bianchi',
    username: 'mbianchi',
    role: 'user',
    avatarInitials: 'MB',
    fullName: 'Marco Bianchi',
    email: 'mbianchi@example.com',
    costPerHour: 40.0,
  },
  {
    id: 'u7',
    name: 'Sofia Conti',
    username: 'sconti',
    role: 'user',
    avatarInitials: 'SC',
    fullName: 'Sofia Conti',
    email: 'sconti@example.com',
    costPerHour: 55.0,
  },
  {
    id: 'u8',
    name: 'Luca Moretti',
    username: 'lmoretti',
    role: 'user',
    avatarInitials: 'LM',
    fullName: 'Luca Moretti',
    email: 'lmoretti@example.com',
    costPerHour: 35.0,
  },
] as const;

export const DEMO_USER_IDS = DEMO_USERS.map((user) => user.id);
export const DEMO_USERNAMES = DEMO_USERS.map((user) => user.username);
export const DEMO_SETTINGS_CACHE_NAMESPACES = DEMO_USERS.map((user) => `settings:user:${user.id}`);
export const DEMO_ENTRIES_CACHE_NAMESPACES = DEMO_USERS.map((user) => `entries:user:${user.id}`);

export const COMPATIBILITY_DEFAULTS = {
  clients: ['c1', 'c2'],
  projects: ['p1', 'p2', 'p3'],
  tasks: ['t1', 't2', 't3', 't4'],
} as const;

export const DEMO_CLIENTS = [
  { id: 'dm_cli_01', clientCode: 'DM-CLI-001', fiscalCode: 'IT10000000001' },
  { id: 'dm_cli_02', clientCode: 'DM-CLI-002', fiscalCode: 'IT10000000002' },
  { id: 'dm_cli_03', clientCode: 'DM-CLI-003', fiscalCode: 'IT10000000003' },
  { id: 'dm_cli_04', clientCode: 'DM-CLI-004', fiscalCode: 'FRRGLI90A41A944K' },
  { id: 'dm_cli_05', clientCode: 'DM-CLI-005', fiscalCode: 'IT10000000005' },
] as const;

export const DEMO_SUPPLIERS = [
  { id: 'dm_sup_01', supplierCode: 'DM-SUP-001' },
  { id: 'dm_sup_02', supplierCode: 'DM-SUP-002' },
  { id: 'dm_sup_03', supplierCode: 'DM-SUP-003' },
  { id: 'dm_sup_04', supplierCode: 'DM-SUP-004' },
  { id: 'dm_sup_05', supplierCode: 'DM-SUP-005' },
] as const;

export const DEMO_PRODUCTS = [
  { id: 'dm_prd_01', productCode: 'DM-SVC-AUDIT', name: 'Strategy Assessment' },
  { id: 'dm_prd_02', productCode: 'DM-SVC-DEPLOY', name: 'Deployment Sprint' },
  { id: 'dm_prd_03', productCode: 'DM-SVC-SUPPORT', name: 'Managed Support Retainer' },
  { id: 'dm_prd_04', productCode: 'DM-CNS-TRAIN', name: 'Workshop Training Day' },
  { id: 'dm_prd_05', productCode: 'DM-SUP-LAPTOP', name: 'Business Laptop Bundle' },
  { id: 'dm_prd_06', productCode: 'DM-SUP-M365', name: 'Microsoft 365 Annual Seat' },
  { id: 'dm_prd_07', productCode: 'DM-SUP-FW', name: 'Managed Firewall Appliance' },
  { id: 'dm_prd_08', productCode: 'DM-SUP-PRINT', name: 'Branded Print Kit' },
  { id: 'dm_prd_09', productCode: 'DM-DISABLED-001', name: 'Legacy Token Pack' },
] as const;

export const DEMO_SPECIAL_BIDS = [
  { id: 'dm_bid_01', clientId: 'dm_cli_01', productId: 'dm_prd_06' },
  { id: 'dm_bid_02', clientId: 'dm_cli_02', productId: 'dm_prd_05' },
  { id: 'dm_bid_03', clientId: 'dm_cli_03', productId: 'dm_prd_08' },
] as const;

export const DEMO_QUOTES = [
  { id: 'dm_cq_01', quoteCode: 'DM-Q-2601' },
  { id: 'dm_cq_02', quoteCode: 'DM-Q-2602' },
  { id: 'dm_cq_03', quoteCode: 'DM-Q-2603' },
  { id: 'dm_cq_04', quoteCode: 'DM-Q-2604' },
  { id: 'dm_cq_05', quoteCode: 'DM-Q-2605' },
  { id: 'dm_cq_06', quoteCode: 'DM-Q-2606' },
  { id: 'dm_cq_07', quoteCode: 'DM-Q-2607' },
  { id: 'dm_cq_08', quoteCode: 'DM-Q-2608' },
  { id: 'dm_cq_09', quoteCode: 'DM-Q-2609' },
  { id: 'dm_cq_10', quoteCode: 'DM-Q-2610' },
] as const;

export const DEMO_CUSTOMER_OFFERS = [
  { id: 'dm_co_01', offerCode: 'DM-OFF-2601', linkedQuoteId: 'dm_cq_04' },
  { id: 'dm_co_02', offerCode: 'DM-OFF-2602', linkedQuoteId: 'dm_cq_05' },
  { id: 'dm_co_03', offerCode: 'DM-OFF-2603', linkedQuoteId: 'dm_cq_06' },
  { id: 'dm_co_04', offerCode: 'DM-OFF-2604', linkedQuoteId: 'dm_cq_07' },
  { id: 'dm_co_05', offerCode: 'DM-OFF-2605', linkedQuoteId: 'dm_cq_08' },
] as const;

export const DEMO_SALES = [
  { id: 'dm_so_01', orderNumber: 'ORD-2026-0001', linkedOfferId: null },
  { id: 'dm_so_02', orderNumber: 'ORD-2026-0002', linkedOfferId: 'dm_co_04' },
  { id: 'dm_so_03', orderNumber: 'ORD-2026-0003', linkedOfferId: null },
  { id: 'dm_so_04', orderNumber: 'ORD-2026-0004', linkedOfferId: null },
  { id: 'dm_so_05', orderNumber: 'ORD-2026-0005', linkedOfferId: null },
] as const;

export const DEMO_INVOICES = [
  { id: 'dm_inv_01', invoiceNumber: 'DM-INV-2601', linkedSaleId: null },
  { id: 'dm_inv_02', invoiceNumber: 'DM-INV-2602', linkedSaleId: null },
  { id: 'dm_inv_03', invoiceNumber: 'DM-INV-2603', linkedSaleId: 'dm_so_04' },
  { id: 'dm_inv_04', invoiceNumber: 'DM-INV-2604', linkedSaleId: null },
  { id: 'dm_inv_05', invoiceNumber: 'DM-INV-2605', linkedSaleId: null },
] as const;

export const DEMO_SUPPLIER_QUOTES = [
  { id: 'dm_sq_01', quoteCode: 'DM-SQ-2601', purchaseOrderNumber: 'DM-SQ-2601' },
  { id: 'dm_sq_02', quoteCode: 'DM-SQ-2602', purchaseOrderNumber: 'DM-SQ-2602' },
  { id: 'dm_sq_03', quoteCode: 'DM-SQ-2603', purchaseOrderNumber: 'DM-SQ-2603' },
  { id: 'dm_sq_04', quoteCode: 'DM-SQ-2604', purchaseOrderNumber: 'DM-SQ-2604' },
  { id: 'dm_sq_05', quoteCode: 'DM-SQ-2605', purchaseOrderNumber: 'DM-SQ-2605' },
  { id: 'dm_sq_06', quoteCode: 'DM-SQ-2606', purchaseOrderNumber: 'DM-SQ-2606' },
  { id: 'dm_sq_07', quoteCode: 'DM-SQ-2607', purchaseOrderNumber: 'DM-SQ-2607' },
  { id: 'dm_sq_08', quoteCode: 'DM-SQ-2608', purchaseOrderNumber: 'DM-SQ-2608' },
  { id: 'dm_sq_09', quoteCode: 'DM-SQ-2609', purchaseOrderNumber: 'DM-SQ-2609' },
  { id: 'dm_sq_10', quoteCode: 'DM-SQ-2610', purchaseOrderNumber: 'DM-SQ-2610' },
  { id: 'dm_sq_11', quoteCode: 'DM-SQ-2611', purchaseOrderNumber: 'DM-SQ-2611' },
  { id: 'dm_sq_12', quoteCode: 'DM-SQ-2612', purchaseOrderNumber: 'DM-SQ-2612' },
  { id: 'dm_sq_13', quoteCode: 'DM-SQ-2613', purchaseOrderNumber: 'DM-SQ-2613' },
  { id: 'dm_sq_14', quoteCode: 'DM-SQ-2614', purchaseOrderNumber: 'DM-SQ-2614' },
] as const;

export const DEMO_SUPPLIER_OFFERS = [
  { id: 'dm_sfo_01', offerCode: 'DM-SOF-2601', linkedQuoteId: 'dm_sq_04' },
  { id: 'dm_sfo_02', offerCode: 'DM-SOF-2602', linkedQuoteId: 'dm_sq_05' },
  { id: 'dm_sfo_03', offerCode: 'DM-SOF-2603', linkedQuoteId: 'dm_sq_06' },
  { id: 'dm_sfo_04', offerCode: 'DM-SOF-2604', linkedQuoteId: 'dm_sq_07' },
  { id: 'dm_sfo_05', offerCode: 'DM-SOF-2605', linkedQuoteId: 'dm_sq_08' },
  { id: 'dm_sfo_06', offerCode: 'DM-SOF-2606', linkedQuoteId: 'dm_sq_11' },
  { id: 'dm_sfo_07', offerCode: 'DM-SOF-2607', linkedQuoteId: 'dm_sq_12' },
  { id: 'dm_sfo_08', offerCode: 'DM-SOF-2608', linkedQuoteId: 'dm_sq_13' },
  { id: 'dm_sfo_09', offerCode: 'DM-SOF-2609', linkedQuoteId: 'dm_sq_14' },
] as const;

export const DEMO_SUPPLIER_SALES = [
  { id: 'dm_ss_01', orderNumber: 'SORD-2026-0001', linkedOfferId: 'dm_sfo_06' },
  { id: 'dm_ss_02', orderNumber: 'SORD-2026-0002', linkedOfferId: 'dm_sfo_04' },
  { id: 'dm_ss_03', orderNumber: 'SORD-2026-0003', linkedOfferId: 'dm_sfo_07' },
  { id: 'dm_ss_04', orderNumber: 'SORD-2026-0004', linkedOfferId: 'dm_sfo_08' },
  { id: 'dm_ss_05', orderNumber: 'SORD-2026-0005', linkedOfferId: 'dm_sfo_09' },
] as const;

export const DEMO_SUPPLIER_INVOICES = [
  { id: 'dm_sinv_01', invoiceNumber: 'DM-SINV-2601', linkedSaleId: null },
  { id: 'dm_sinv_02', invoiceNumber: 'DM-SINV-2602', linkedSaleId: null },
  { id: 'dm_sinv_03', invoiceNumber: 'DM-SINV-2603', linkedSaleId: 'dm_ss_04' },
  { id: 'dm_sinv_04', invoiceNumber: 'DM-SINV-2604', linkedSaleId: null },
  { id: 'dm_sinv_05', invoiceNumber: 'DM-SINV-2605', linkedSaleId: null },
] as const;

export const DEMO_PROJECTS = [
  { id: 'dm_proj_01', name: `DM-CLI-001_DM-SVC-AUDIT_${currentYear}` },
  { id: 'dm_proj_02', name: `DM-CLI-001_DM-SVC-DEPLOY_${currentYear}` },
] as const;

export const DEMO_NOTIFICATIONS = ['dm_notif_01', 'dm_notif_02'] as const;

export const DEMO_WORK_UNITS = [
  { id: 'dm_wu_01', name: 'Development Team', description: 'Frontend and backend engineering.' },
  {
    id: 'dm_wu_02',
    name: 'Sales & Marketing',
    description: 'Customer acquisition and brand management.',
  },
  {
    id: 'dm_wu_03',
    name: 'IT Operations',
    description: 'Infrastructure, support, and cross-team ops.',
  },
] as const;

export const DEMO_WORK_UNIT_MANAGERS = [
  { workUnitId: 'dm_wu_01', userId: 'u2' },
  { workUnitId: 'dm_wu_02', userId: 'u4' },
  { workUnitId: 'dm_wu_03', userId: 'u2' },
  { workUnitId: 'dm_wu_03', userId: 'u4' },
] as const;

export const DEMO_USER_WORK_UNITS = [
  { userId: 'u2', workUnitId: 'dm_wu_01' },
  { userId: 'u3', workUnitId: 'dm_wu_01' },
  { userId: 'u5', workUnitId: 'dm_wu_01' },
  { userId: 'u6', workUnitId: 'dm_wu_01' },
  { userId: 'u4', workUnitId: 'dm_wu_02' },
  { userId: 'u7', workUnitId: 'dm_wu_02' },
  { userId: 'u8', workUnitId: 'dm_wu_02' },
  { userId: 'u2', workUnitId: 'dm_wu_03' },
  { userId: 'u4', workUnitId: 'dm_wu_03' },
  { userId: 'u5', workUnitId: 'dm_wu_03' },
  { userId: 'u7', workUnitId: 'dm_wu_03' },
] as const;

export const DEMO_TIME_ENTRY_IDS = rangeIds('dm_te_', 25);

export const DEMO_ITEM_IDS = {
  quoteItems: rangeIds('dm_cqi_', 14),
  customerOfferItems: rangeIds('dm_coi_', 7),
  saleItems: rangeIds('dm_soi_', 8),
  invoiceItems: rangeIds('dm_inv_item_', 6),
  supplierQuoteItems: rangeIds('dm_sqi_', 15),
  supplierOfferItems: rangeIds('dm_sfoi_', 10),
  supplierSaleItems: rangeIds('dm_ssi_', 6),
  supplierInvoiceItems: rangeIds('dm_sinv_item_', 6),
} as const;

export const DEMO_IDS = {
  clients: DEMO_CLIENTS.map((item) => item.id),
  suppliers: DEMO_SUPPLIERS.map((item) => item.id),
  products: DEMO_PRODUCTS.map((item) => item.id),
  specialBids: DEMO_SPECIAL_BIDS.map((item) => item.id),
  quotes: DEMO_QUOTES.map((item) => item.id),
  customerOffers: DEMO_CUSTOMER_OFFERS.map((item) => item.id),
  sales: DEMO_SALES.map((item) => item.id),
  invoices: DEMO_INVOICES.map((item) => item.id),
  supplierQuotes: DEMO_SUPPLIER_QUOTES.map((item) => item.id),
  supplierOffers: DEMO_SUPPLIER_OFFERS.map((item) => item.id),
  supplierSales: DEMO_SUPPLIER_SALES.map((item) => item.id),
  supplierInvoices: DEMO_SUPPLIER_INVOICES.map((item) => item.id),
  projects: DEMO_PROJECTS.map((item) => item.id),
  notifications: [...DEMO_NOTIFICATIONS],
  workUnits: DEMO_WORK_UNITS.map((item) => item.id),
  timeEntries: [...DEMO_TIME_ENTRY_IDS],
  users: [...DEMO_USER_IDS],
  settingsUserIds: [...DEMO_USER_IDS],
} as const;

export const DEMO_EXPECTED_COUNTS = {
  users: DEMO_USERS.length,
  settings: DEMO_USERS.length,
  clients: DEMO_CLIENTS.length,
  suppliers: DEMO_SUPPLIERS.length,
  products: DEMO_PRODUCTS.length,
  special_bids: DEMO_SPECIAL_BIDS.length,
  quotes: DEMO_QUOTES.length,
  quote_items: DEMO_ITEM_IDS.quoteItems.length,
  customer_offers: DEMO_CUSTOMER_OFFERS.length,
  customer_offer_items: DEMO_ITEM_IDS.customerOfferItems.length,
  sales: DEMO_SALES.length,
  sale_items: DEMO_ITEM_IDS.saleItems.length,
  invoices: DEMO_INVOICES.length,
  invoice_items: DEMO_ITEM_IDS.invoiceItems.length,
  supplier_quotes: DEMO_SUPPLIER_QUOTES.length,
  supplier_quote_items: DEMO_ITEM_IDS.supplierQuoteItems.length,
  supplier_offers: DEMO_SUPPLIER_OFFERS.length,
  supplier_offer_items: DEMO_ITEM_IDS.supplierOfferItems.length,
  supplier_sales: DEMO_SUPPLIER_SALES.length,
  supplier_sale_items: DEMO_ITEM_IDS.supplierSaleItems.length,
  supplier_invoices: DEMO_SUPPLIER_INVOICES.length,
  supplier_invoice_items: DEMO_ITEM_IDS.supplierInvoiceItems.length,
  projects: DEMO_PROJECTS.length,
  notifications: DEMO_NOTIFICATIONS.length,
  work_units: DEMO_WORK_UNITS.length,
  work_unit_managers: DEMO_WORK_UNIT_MANAGERS.length,
  user_work_units: DEMO_USER_WORK_UNITS.length,
  time_entries: DEMO_TIME_ENTRY_IDS.length,
} as const;
