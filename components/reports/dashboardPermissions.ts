import type { DashboardDataset, DashboardWidget } from '../../services/api/reports';
import { buildPermission, hasAnyPermission, type Permission } from '../../utils/permissions';
import { DATASET_OPTIONS } from './dashboardConstants';

const DASHBOARD_DATASET_PERMISSION_OPTIONS: Record<DashboardDataset, Permission[]> = {
  timesheets: [buildPermission('timesheets.tracker', 'view')],
  quotes: [buildPermission('sales.client_quotes', 'view')],
  orders: [buildPermission('accounting.clients_orders', 'view')],
  invoices: [buildPermission('accounting.clients_invoices', 'view')],
  supplierQuotes: [buildPermission('sales.supplier_quotes', 'view')],
  catalog: [
    buildPermission('catalog.internal_listing', 'view'),
    buildPermission('catalog.external_listing', 'view'),
    buildPermission('catalog.special_bids', 'view'),
  ],
};

export const canAccessDashboardDataset = (
  permissions: Permission[] | undefined,
  dataset: DashboardDataset,
) => hasAnyPermission(permissions, DASHBOARD_DATASET_PERMISSION_OPTIONS[dataset]);

export const getAccessibleDashboardDatasets = (permissions: Permission[] | undefined) =>
  DATASET_OPTIONS.filter((dataset) => canAccessDashboardDataset(permissions, dataset));

export const widgetHasRestrictedDashboardDatasets = (
  widget: Pick<DashboardWidget, 'queries'>,
  permissions: Permission[] | undefined,
) => widget.queries.some((query) => !canAccessDashboardDataset(permissions, query.dataset));
