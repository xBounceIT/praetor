import type React from 'react';
import DashboardBrowser from './DashboardBrowser';
import DashboardDetail from './DashboardDetail';

type WidgetRoute = { mode: 'new' } | { mode: 'edit'; widgetId: string };

export interface DashboardViewProps {
  permissions: string[];
  activeDashboardId: string | null;
  activeWidgetRoute: WidgetRoute | null;
  onDashboardIdChange: (id: string | null) => void;
  onWidgetRouteChange: (route: WidgetRoute | null) => void;
}

const DashboardView: React.FC<DashboardViewProps> = ({
  permissions,
  activeDashboardId,
  activeWidgetRoute,
  onDashboardIdChange,
  onWidgetRouteChange,
}) => {
  if (activeDashboardId) {
    return (
      <DashboardDetail
        permissions={permissions}
        dashboardId={activeDashboardId}
        activeWidgetRoute={activeWidgetRoute}
        onBack={() => onDashboardIdChange(null)}
        onWidgetRouteChange={onWidgetRouteChange}
      />
    );
  }

  return (
    <DashboardBrowser permissions={permissions} onOpenDashboard={(id) => onDashboardIdChange(id)} />
  );
};

export default DashboardView;
