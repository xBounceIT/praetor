import type { DashboardWidget } from '../../services/api/reports';

export const CHART_COLORS = [
  '#1d4ed8',
  '#0d9488',
  '#d97706',
  '#be123c',
  '#7c3aed',
  '#0f766e',
  '#334155',
];

export const DATASET_OPTIONS: DashboardWidget['dataset'][] = [
  'timesheets',
  'quotes',
  'orders',
  'invoices',
  'supplierQuotes',
  'catalog',
];

export const GROUP_BY_OPTIONS: Record<DashboardWidget['dataset'], string[]> = {
  timesheets: ['user', 'client', 'project', 'task', 'location', 'month'],
  quotes: ['status', 'client', 'month'],
  orders: ['status', 'client', 'month'],
  invoices: ['status', 'client', 'month'],
  supplierQuotes: ['status', 'supplier', 'month'],
  catalog: ['type', 'category', 'subcategory', 'supplier'],
};

export const METRIC_OPTIONS: Record<DashboardWidget['dataset'], string[]> = {
  timesheets: ['hours', 'entries', 'cost'],
  quotes: ['count', 'net'],
  orders: ['count', 'net'],
  invoices: ['count', 'total', 'outstanding'],
  supplierQuotes: ['count', 'net'],
  catalog: ['count', 'cost'],
};
