import type React from 'react';
import DashboardBrowser from './DashboardBrowser';
import DashboardDetail from './DashboardDetail';
import WidgetEditor from './WidgetEditor';

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
  if (activeDashboardId && activeWidgetRoute) {
    return (
      <WidgetEditor
        permissions={permissions}
        dashboardId={activeDashboardId}
        mode={activeWidgetRoute.mode}
        widgetId={activeWidgetRoute.mode === 'edit' ? activeWidgetRoute.widgetId : undefined}
        onBack={() => onWidgetRouteChange(null)}
      />
    );
  }

  if (activeDashboardId) {
    return (
      <DashboardDetail
        permissions={permissions}
        dashboardId={activeDashboardId}
        onBack={() => onDashboardIdChange(null)}
        onNavigateToWidgetEditor={onWidgetRouteChange}
      />
    );
  }

  return (
    <DashboardBrowser permissions={permissions} onOpenDashboard={(id) => onDashboardIdChange(id)} />
  );
};

export default DashboardView;
