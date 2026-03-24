import type React from 'react';
import { useState } from 'react';
import DashboardBrowser from './DashboardBrowser';
import DashboardDetail from './DashboardDetail';

export interface DashboardViewProps {
  permissions: string[];
}

type ViewMode = { kind: 'browser' } | { kind: 'detail'; dashboardId: string };

const DashboardView: React.FC<DashboardViewProps> = ({ permissions }) => {
  const [viewMode, setViewMode] = useState<ViewMode>({ kind: 'browser' });

  const handleOpenDashboard = (dashboardId: string) => {
    setViewMode({ kind: 'detail', dashboardId });
  };

  const handleBack = () => {
    setViewMode({ kind: 'browser' });
  };

  if (viewMode.kind === 'detail') {
    return (
      <DashboardDetail
        permissions={permissions}
        dashboardId={viewMode.dashboardId}
        onBack={handleBack}
      />
    );
  }

  return <DashboardBrowser permissions={permissions} onOpenDashboard={handleOpenDashboard} />;
};

export default DashboardView;
