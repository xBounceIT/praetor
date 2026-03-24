import type React from 'react';
import { useState } from 'react';
import DashboardBrowser from './DashboardBrowser';
import DashboardDetail from './DashboardDetail';

export interface DashboardViewProps {
  permissions: string[];
}

type ViewMode =
  | { kind: 'browser'; folderId: string | null }
  | { kind: 'detail'; dashboardId: string; returnFolderId: string | null };

const DashboardView: React.FC<DashboardViewProps> = ({ permissions }) => {
  const [viewMode, setViewMode] = useState<ViewMode>({ kind: 'browser', folderId: null });

  const handleOpenDashboard = (dashboardId: string) => {
    const returnFolderId = viewMode.kind === 'browser' ? viewMode.folderId : null;
    setViewMode({ kind: 'detail', dashboardId, returnFolderId });
  };

  const handleBack = () => {
    const returnFolderId = viewMode.kind === 'detail' ? viewMode.returnFolderId : null;
    setViewMode({ kind: 'browser', folderId: returnFolderId });
  };

  const handleNavigateToFolder = (folderId: string | null) => {
    setViewMode({ kind: 'browser', folderId });
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

  return (
    <DashboardBrowser
      permissions={permissions}
      currentFolderId={viewMode.folderId}
      onOpenDashboard={handleOpenDashboard}
      onNavigateToFolder={handleNavigateToFolder}
    />
  );
};

export default DashboardView;
