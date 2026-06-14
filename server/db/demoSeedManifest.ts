import type { UserContractType, UserEmploymentStatus, UserWorkLocation } from './schema/users.ts';

const rangeIds = (prefix: string, count: number, pad = 2) =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(pad, '0')}`);

const currentYear = new Date().getFullYear();

export const DEMO_PASSWORD_HASH = '$2a$12$z5H7VrzTpLImYWSH3xufKufCiGB0n9CSlNMOrRBRIxq.6mvuVS7uy';

type DemoEmployeeType = 'app_user' | 'internal' | 'external';

type DemoUser = {
  id: string;
  name: string;
  username: string;
  role: 'manager' | 'top_manager' | 'user';
  avatarInitials: string;
  fullName: string;
  email: string;
  costPerHour: number;
  employeeType: DemoEmployeeType;
  phone: string;
  jobTitle: string;
  department: string;
  employeeCode: string;
  hireDate: string;
  terminationDate: string | null;
  contractType: UserContractType;
  employmentStatus: UserEmploymentStatus;
  workLocation: UserWorkLocation;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes: string;
};

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
    employeeType: 'app_user',
    phone: '+39 02 555 0101',
    jobTitle: 'Delivery Manager',
    department: 'Operations',
    employeeCode: 'EMP-100',
    hireDate: '2021-02-15',
    terminationDate: null,
    contractType: 'permanent',
    employmentStatus: 'active',
    workLocation: 'hybrid',
    emergencyContactName: 'Laura Manager',
    emergencyContactPhone: '+39 02 555 0901',
    notes: 'Coordinates delivery teams and customer escalations.',
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
    employeeType: 'app_user',
    phone: '+39 02 555 0102',
    jobTitle: 'Software Engineer',
    department: 'Engineering',
    employeeCode: 'EMP-101',
    hireDate: '2023-05-08',
    terminationDate: null,
    contractType: 'permanent',
    employmentStatus: 'active',
    workLocation: 'remote',
    emergencyContactName: 'Pat User',
    emergencyContactPhone: '+39 02 555 0902',
    notes: 'Focuses on product delivery and support automation.',
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
    employeeType: 'app_user',
    phone: '+39 02 555 0103',
    jobTitle: 'Sales Manager',
    department: 'Sales',
    employeeCode: 'EMP-102',
    hireDate: '2020-09-01',
    terminationDate: null,
    contractType: 'permanent',
    employmentStatus: 'active',
    workLocation: 'office',
    emergencyContactName: 'Morgan Sales',
    emergencyContactPhone: '+39 02 555 0903',
    notes: 'Owns commercial pipeline and key account coordination.',
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
    employeeType: 'app_user',
    phone: '+39 02 555 0104',
    jobTitle: 'ERP Consultant',
    department: 'Delivery',
    employeeCode: 'EMP-103',
    hireDate: '2022-03-14',
    terminationDate: null,
    contractType: 'permanent',
    employmentStatus: 'active',
    workLocation: 'customer_site',
    emergencyContactName: 'Andrea Rossi',
    emergencyContactPhone: '+39 02 555 0904',
    notes: 'Assigned to implementation workshops and customer training.',
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
    employeeType: 'app_user',
    phone: '+39 02 555 0105',
    jobTitle: 'Backend Engineer',
    department: 'Engineering',
    employeeCode: 'EMP-104',
    hireDate: `${currentYear}-01-15`,
    terminationDate: null,
    contractType: 'fixed_term',
    employmentStatus: 'onboarding',
    workLocation: 'hybrid',
    emergencyContactName: 'Sara Bianchi',
    emergencyContactPhone: '+39 02 555 0905',
    notes: 'Onboarding plan includes API ownership and release workflow training.',
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
    employeeType: 'app_user',
    phone: '+39 02 555 0106',
    jobTitle: 'Account Executive',
    department: 'Sales',
    employeeCode: 'EMP-105',
    hireDate: '2021-11-22',
    terminationDate: null,
    contractType: 'permanent',
    employmentStatus: 'on_leave',
    workLocation: 'remote',
    emergencyContactName: 'Luca Conti',
    emergencyContactPhone: '+39 02 555 0906',
    notes: 'Temporary leave; opportunities are delegated to the sales manager.',
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
    employeeType: 'app_user',
    phone: '+39 02 555 0107',
    jobTitle: 'Support Specialist',
    department: 'Operations',
    employeeCode: 'EMP-106',
    hireDate: '2024-06-03',
    terminationDate: null,
    contractType: 'permanent',
    employmentStatus: 'active',
    workLocation: 'office',
    emergencyContactName: 'Marta Moretti',
    emergencyContactPhone: '+39 02 555 0907',
    notes: 'Covers service desk triage and managed support retainers.',
  },
  {
    id: 'u9',
    name: 'Top Manager',
    username: 'topmanager',
    role: 'top_manager',
    avatarInitials: 'TM',
    fullName: 'Top Manager',
    email: 'topmanager@example.com',
    costPerHour: 75.0,
    employeeType: 'app_user',
    phone: '+39 02 555 0108',
    jobTitle: 'Managing Director',
    department: 'Executive',
    employeeCode: 'EMP-107',
    hireDate: '2019-01-07',
    terminationDate: null,
    contractType: 'permanent',
    employmentStatus: 'active',
    workLocation: 'office',
    emergencyContactName: 'Alex Director',
    emergencyContactPhone: '+39 02 555 0908',
    notes: 'Approves portfolio priorities and cross-unit staffing decisions.',
  },
  {
    id: 'u10',
    name: 'Giulia Verdi',
    username: 'gverdi.internal',
    role: 'user',
    avatarInitials: 'GV',
    fullName: 'Giulia Verdi',
    email: 'gverdi@example.com',
    costPerHour: 48.0,
    employeeType: 'internal',
    phone: '+39 02 555 0109',
    jobTitle: 'HR Generalist',
    department: 'People Operations',
    employeeCode: 'EMP-108',
    hireDate: '2022-11-01',
    terminationDate: null,
    contractType: 'permanent',
    employmentStatus: 'active',
    workLocation: 'office',
    emergencyContactName: 'Paolo Verdi',
    emergencyContactPhone: '+39 02 555 0909',
    notes: 'Maintains employee records and onboarding checklists.',
  },
  {
    id: 'u11',
    name: 'Paolo Ferri',
    username: 'pferri.external',
    role: 'user',
    avatarInitials: 'PF',
    fullName: 'Paolo Ferri',
    email: 'pferri@example.com',
    costPerHour: 70.0,
    employeeType: 'external',
    phone: '+39 02 555 0110',
    jobTitle: 'Security Consultant',
    department: 'External Delivery',
    employeeCode: 'EXT-201',
    hireDate: `${currentYear}-02-01`,
    terminationDate: `${currentYear}-12-31`,
    contractType: 'consultant',
    employmentStatus: 'active',
    workLocation: 'customer_site',
    emergencyContactName: 'Irene Ferri',
    emergencyContactPhone: '+39 02 555 0910',
    notes: 'Fixed-term consulting engagement for customer security reviews.',
  },
  {
    id: 'u12',
    name: 'Nadia Costa',
    username: 'ncosta.external',
    role: 'user',
    avatarInitials: 'NC',
    fullName: 'Nadia Costa',
    email: 'ncosta@example.com',
    costPerHour: 62.0,
    employeeType: 'external',
    phone: '+39 02 555 0111',
    jobTitle: 'Implementation Partner',
    department: 'Partner Network',
    employeeCode: 'EXT-202',
    hireDate: `${currentYear}-05-15`,
    terminationDate: null,
    contractType: 'contractor',
    employmentStatus: 'onboarding',
    workLocation: 'remote',
    emergencyContactName: 'Roberto Costa',
    emergencyContactPhone: '+39 02 555 0911',
    notes: 'Partner onboarding for remote implementation capacity.',
  },
] as const satisfies readonly DemoUser[];

export const DEMO_USER_IDS = DEMO_USERS.map((user) => user.id);
export const DEMO_USERNAMES = DEMO_USERS.map((user) => user.username);

export const COMPATIBILITY_DEFAULTS = {
  clients: ['c1', 'c2'],
  projects: ['p1', 'p2', 'p3'],
  tasks: ['t1', 't2', 't3', 't4', 't5'],
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

export const DEMO_QUOTES = [
  { id: 'dm_cq_01' },
  { id: 'dm_cq_02' },
  { id: 'dm_cq_03' },
  { id: 'dm_cq_04' },
  { id: 'dm_cq_05' },
  { id: 'dm_cq_06' },
  { id: 'dm_cq_07' },
  { id: 'dm_cq_08' },
  { id: 'dm_cq_09' },
  { id: 'dm_cq_10' },
  // Accepted "procurement drivers" (#779 derived supplier statuses): their 1-to-1 links keep
  // the order-backed supplier quotes dm_sq_11..14 in the Accepted state.
  { id: 'dm_cq_11' },
  { id: 'dm_cq_12' },
  { id: 'dm_cq_13' },
  { id: 'dm_cq_14' },
] as const;

export const DEMO_CUSTOMER_OFFERS = [
  { id: 'dm_co_01', linkedQuoteId: 'dm_cq_04' },
  { id: 'dm_co_02', linkedQuoteId: 'dm_cq_05' },
  { id: 'dm_co_03', linkedQuoteId: 'dm_cq_06' },
  { id: 'dm_co_04', linkedQuoteId: 'dm_cq_07' },
  { id: 'dm_co_05', linkedQuoteId: 'dm_cq_08' },
] as const;

export const DEMO_SALES = [
  { id: 'dm_so_01', linkedOfferId: null },
  { id: 'dm_so_02', linkedOfferId: 'dm_co_04' },
  { id: 'dm_so_03', linkedOfferId: null },
  { id: 'dm_so_04', linkedOfferId: 'dm_co_03' },
  { id: 'dm_so_05', linkedOfferId: null },
] as const;

export const DEMO_INVOICES = [
  { id: 'dm_inv_01', linkedSaleId: null },
  { id: 'dm_inv_02', linkedSaleId: null },
  { id: 'dm_inv_03', linkedSaleId: 'dm_so_04' },
  { id: 'dm_inv_04', linkedSaleId: null },
  { id: 'dm_inv_05', linkedSaleId: null },
] as const;

export const DEMO_SUPPLIER_QUOTES = [
  { id: 'dm_sq_01' },
  { id: 'dm_sq_02' },
  { id: 'dm_sq_03' },
  { id: 'dm_sq_04' },
  { id: 'dm_sq_05' },
  { id: 'dm_sq_06' },
  { id: 'dm_sq_07' },
  { id: 'dm_sq_08' },
  { id: 'dm_sq_09' },
  { id: 'dm_sq_10' },
  { id: 'dm_sq_11' },
  { id: 'dm_sq_12' },
  { id: 'dm_sq_13' },
  { id: 'dm_sq_14' },
] as const;

export const DEMO_SUPPLIER_SALES = [
  { id: 'dm_ss_01', linkedQuoteId: 'dm_sq_11' },
  { id: 'dm_ss_02', linkedQuoteId: 'dm_sq_07' },
  { id: 'dm_ss_03', linkedQuoteId: 'dm_sq_12' },
  { id: 'dm_ss_04', linkedQuoteId: 'dm_sq_13' },
  { id: 'dm_ss_05', linkedQuoteId: 'dm_sq_14' },
] as const;

export const DEMO_SUPPLIER_INVOICES = [
  { id: 'dm_sinv_01', linkedSaleId: null },
  { id: 'dm_sinv_02', linkedSaleId: null },
  { id: 'dm_sinv_03', linkedSaleId: 'dm_ss_04' },
  { id: 'dm_sinv_04', linkedSaleId: null },
  { id: 'dm_sinv_05', linkedSaleId: null },
] as const;

export const DEMO_PROJECTS = [
  { id: 'dm_proj_01', name: `DM-CLI-001_DM-SVC-AUDIT_${currentYear}` },
  { id: 'dm_proj_02', name: `DM-CLI-001_DM-SVC-DEPLOY_${currentYear}` },
] as const;

export const DEMO_TASKS = rangeIds('dm_task_', 5);

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
  { workUnitId: 'dm_wu_01', userId: 'u9' },
  { workUnitId: 'dm_wu_02', userId: 'u9' },
  { workUnitId: 'dm_wu_03', userId: 'u9' },
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
  { userId: 'u9', workUnitId: 'dm_wu_01' },
  { userId: 'u9', workUnitId: 'dm_wu_02' },
  { userId: 'u9', workUnitId: 'dm_wu_03' },
] as const;

export const DEMO_USER_CLIENT_ASSIGNMENTS = [
  { userId: 'u2', targetId: 'c1' },
  { userId: 'u2', targetId: 'c2' },
  { userId: 'u2', targetId: 'dm_cli_01' },
  { userId: 'u3', targetId: 'c1' },
  { userId: 'u3', targetId: 'dm_cli_01' },
  { userId: 'u4', targetId: 'c1' },
  { userId: 'u4', targetId: 'c2' },
  { userId: 'u4', targetId: 'dm_cli_01' },
  { userId: 'u5', targetId: 'c1' },
  { userId: 'u5', targetId: 'dm_cli_01' },
  { userId: 'u6', targetId: 'c1' },
  { userId: 'u6', targetId: 'dm_cli_01' },
  { userId: 'u7', targetId: 'c2' },
  { userId: 'u8', targetId: 'c2' },
] as const;

export const DEMO_USER_PROJECT_ASSIGNMENTS = [
  { userId: 'u2', targetId: 'p1' },
  { userId: 'u2', targetId: 'p2' },
  { userId: 'u2', targetId: 'p3' },
  { userId: 'u2', targetId: 'dm_proj_01' },
  { userId: 'u2', targetId: 'dm_proj_02' },
  { userId: 'u3', targetId: 'p1' },
  { userId: 'u3', targetId: 'p2' },
  { userId: 'u3', targetId: 'dm_proj_02' },
  { userId: 'u4', targetId: 'p1' },
  { userId: 'u4', targetId: 'p2' },
  { userId: 'u4', targetId: 'p3' },
  { userId: 'u4', targetId: 'dm_proj_01' },
  { userId: 'u4', targetId: 'dm_proj_02' },
  { userId: 'u5', targetId: 'p1' },
  { userId: 'u5', targetId: 'p2' },
  { userId: 'u5', targetId: 'dm_proj_02' },
  { userId: 'u6', targetId: 'p1' },
  { userId: 'u6', targetId: 'p2' },
  { userId: 'u6', targetId: 'dm_proj_01' },
  { userId: 'u7', targetId: 'p3' },
  { userId: 'u8', targetId: 'p3' },
] as const;

export const DEMO_USER_TASK_ASSIGNMENTS = [
  { userId: 'u2', targetId: 't1' },
  { userId: 'u2', targetId: 't2' },
  { userId: 'u2', targetId: 't3' },
  { userId: 'u2', targetId: 't4' },
  { userId: 'u3', targetId: 't1' },
  { userId: 'u3', targetId: 't2' },
  { userId: 'u3', targetId: 't3' },
  { userId: 'u4', targetId: 't1' },
  { userId: 'u4', targetId: 't2' },
  { userId: 'u4', targetId: 't3' },
  { userId: 'u4', targetId: 't4' },
  { userId: 'u5', targetId: 't1' },
  { userId: 'u5', targetId: 't2' },
  { userId: 'u5', targetId: 't3' },
  { userId: 'u6', targetId: 't1' },
  { userId: 'u6', targetId: 't2' },
  { userId: 'u6', targetId: 't3' },
  { userId: 'u7', targetId: 't4' },
  { userId: 'u8', targetId: 't4' },
  { userId: 'u2', targetId: 't5' },
  { userId: 'u3', targetId: 't5' },
  { userId: 'u4', targetId: 't5' },
  { userId: 'u7', targetId: 't5' },
  { userId: 'u8', targetId: 't5' },
  { userId: 'u2', targetId: 'dm_task_01' },
  { userId: 'u6', targetId: 'dm_task_02' },
  { userId: 'u2', targetId: 'dm_task_03' },
  { userId: 'u5', targetId: 'dm_task_04' },
  { userId: 'u3', targetId: 'dm_task_05' },
] as const;

export const DEMO_TIME_ENTRY_IDS = rangeIds('dm_te_', 25);

export const DEMO_ITEM_IDS = {
  quoteItems: rangeIds('dm_cqi_', 19),
  customerOfferItems: rangeIds('dm_coi_', 8),
  saleItems: rangeIds('dm_soi_', 8),
  invoiceItems: rangeIds('dm_inv_item_', 6),
  supplierQuoteItems: rangeIds('dm_sqi_', 15),
  supplierSaleItems: rangeIds('dm_ssi_', 6),
  supplierInvoiceItems: rangeIds('dm_sinv_item_', 6),
} as const;

export const DEMO_IDS = {
  clients: DEMO_CLIENTS.map((item) => item.id),
  suppliers: DEMO_SUPPLIERS.map((item) => item.id),
  products: DEMO_PRODUCTS.map((item) => item.id),
  quotes: DEMO_QUOTES.map((item) => item.id),
  customerOffers: DEMO_CUSTOMER_OFFERS.map((item) => item.id),
  sales: DEMO_SALES.map((item) => item.id),
  invoices: DEMO_INVOICES.map((item) => item.id),
  supplierQuotes: DEMO_SUPPLIER_QUOTES.map((item) => item.id),
  supplierSales: DEMO_SUPPLIER_SALES.map((item) => item.id),
  supplierInvoices: DEMO_SUPPLIER_INVOICES.map((item) => item.id),
  projects: DEMO_PROJECTS.map((item) => item.id),
  tasks: [...DEMO_TASKS],
  notifications: [...DEMO_NOTIFICATIONS],
  workUnits: DEMO_WORK_UNITS.map((item) => item.id),
  timeEntries: [...DEMO_TIME_ENTRY_IDS],
  users: [...DEMO_USER_IDS],
  settingsUserIds: [...DEMO_USER_IDS],
} as const;

export const DEMO_ASSIGNMENT_TARGET_IDS = {
  clients: [...COMPATIBILITY_DEFAULTS.clients, ...DEMO_IDS.clients],
  projects: [...COMPATIBILITY_DEFAULTS.projects, ...DEMO_IDS.projects],
  tasks: [...COMPATIBILITY_DEFAULTS.tasks, ...DEMO_IDS.tasks],
} as const;

export const DEMO_TOP_MANAGER_USER_IDS = DEMO_USERS.reduce<string[]>((ids, user) => {
  if (user.role === 'top_manager') ids.push(user.id);
  return ids;
}, []);

type DemoUserAssignment = { userId: string; targetId: string };

const countSeededAssignmentsWithTopManagers = (
  manualAssignments: readonly DemoUserAssignment[],
  targetIds: readonly string[],
) =>
  new Set([
    ...manualAssignments.map((assignment) => `${assignment.userId}\0${assignment.targetId}`),
    ...DEMO_TOP_MANAGER_USER_IDS.flatMap((userId) =>
      targetIds.map((targetId) => `${userId}\0${targetId}`),
    ),
  ]).size;

export const DEMO_EXPECTED_COUNTS = {
  users: DEMO_USERS.length,
  settings: DEMO_USERS.length,
  clients: COMPATIBILITY_DEFAULTS.clients.length + DEMO_CLIENTS.length,
  suppliers: DEMO_SUPPLIERS.length,
  products: DEMO_PRODUCTS.length,
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
  supplier_sales: DEMO_SUPPLIER_SALES.length,
  supplier_sale_items: DEMO_ITEM_IDS.supplierSaleItems.length,
  supplier_invoices: DEMO_SUPPLIER_INVOICES.length,
  supplier_invoice_items: DEMO_ITEM_IDS.supplierInvoiceItems.length,
  projects: COMPATIBILITY_DEFAULTS.projects.length + DEMO_PROJECTS.length,
  tasks: COMPATIBILITY_DEFAULTS.tasks.length + DEMO_TASKS.length,
  notifications: DEMO_NOTIFICATIONS.length,
  work_units: DEMO_WORK_UNITS.length,
  work_unit_managers: DEMO_WORK_UNIT_MANAGERS.length,
  user_work_units: DEMO_USER_WORK_UNITS.length,
  user_clients: countSeededAssignmentsWithTopManagers(
    DEMO_USER_CLIENT_ASSIGNMENTS,
    DEMO_ASSIGNMENT_TARGET_IDS.clients,
  ),
  user_projects: countSeededAssignmentsWithTopManagers(
    DEMO_USER_PROJECT_ASSIGNMENTS,
    DEMO_ASSIGNMENT_TARGET_IDS.projects,
  ),
  user_tasks: countSeededAssignmentsWithTopManagers(
    DEMO_USER_TASK_ASSIGNMENTS,
    DEMO_ASSIGNMENT_TARGET_IDS.tasks,
  ),
  time_entries: DEMO_TIME_ENTRY_IDS.length,
} as const;
