import type React from 'react';
import DashboardBrowser from './DashboardBrowser';
import DashboardDetail from './DashboardDetail';

export interface DashboardViewProps {
  permissions: string[];
  activeDashboardId: string | null;
  onDashboardIdChange: (id: string | null) => void;
}

const DashboardView: React.FC<DashboardViewProps> = ({
  permissions,
  activeDashboardId,
  onDashboardIdChange,
}) => {
  if (activeDashboardId) {
    return (
      <DashboardDetail
        permissions={permissions}
        dashboardId={activeDashboardId}
        onBack={() => onDashboardIdChange(null)}
      />
    );
  }

  return (
    <DashboardBrowser permissions={permissions} onOpenDashboard={(id) => onDashboardIdChange(id)} />
  );
};

export default DashboardView;
