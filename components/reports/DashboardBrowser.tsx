import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import type { ReportDashboard, ReportDashboardFolder } from '../../services/api/reports';
import { buildPermission, hasPermission } from '../../utils/permissions';
import DashboardCreateModal from './DashboardCreateModal';

export interface DashboardBrowserProps {
  permissions: string[];
  currentFolderId: string | null;
  onOpenDashboard: (dashboardId: string) => void;
  onNavigateToFolder: (folderId: string | null) => void;
}

const DashboardBrowser: React.FC<DashboardBrowserProps> = ({
  permissions,
  currentFolderId,
  onOpenDashboard,
  onNavigateToFolder,
}) => {
  const { t } = useTranslation('reports');
  const [folders, setFolders] = useState<ReportDashboardFolder[]>([]);
  const [dashboards, setDashboards] = useState<ReportDashboard[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalType, setCreateModalType] = useState<'dashboard' | 'folder'>('dashboard');

  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const canCreate = hasPermission(permissions, buildPermission('reports.dashboard', 'create'));
  const canUpdate = hasPermission(permissions, buildPermission('reports.dashboard', 'update'));
  const canDelete = hasPermission(permissions, buildPermission('reports.dashboard', 'delete'));

  const currentFolder = useMemo(
    () => folders.find((f) => f.id === currentFolderId) || null,
    [folders, currentFolderId],
  );

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const [folderData, dashboardData] = await Promise.all([
          api.reports.listDashboardFolders(),
          api.reports.listDashboards(),
        ]);
        setFolders(folderData);
        setDashboards(dashboardData);
      } catch (err) {
        setError((err as Error).message || t('dashboard.error'));
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [t]);

  const visibleFolders = useMemo(() => {
    if (searchQuery.trim()) return [];
    if (currentFolderId !== null) return [];
    return folders;
  }, [folders, searchQuery, currentFolderId]);

  const visibleDashboards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      return dashboards.filter((d) => d.name.toLowerCase().includes(q));
    }
    return dashboards.filter((d) => d.folderId === currentFolderId);
  }, [dashboards, searchQuery, currentFolderId]);

  const openCreateModal = (type: 'dashboard' | 'folder') => {
    setCreateModalType(type);
    setCreateModalOpen(true);
  };

  const handleCreated = (item: ReportDashboard | ReportDashboardFolder) => {
    if ('widgets' in item) {
      setDashboards((prev) => [item, ...prev]);
    } else {
      setFolders((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
    }
  };

  const startRenameFolder = (folder: ReportDashboardFolder) => {
    setRenamingFolderId(folder.id);
    setRenameFolderValue(folder.name);
  };

  const commitRenameFolder = async (folderId: string) => {
    if (!renameFolderValue.trim()) {
      setRenamingFolderId(null);
      return;
    }
    setIsMutating(true);
    try {
      const updated = await api.reports.updateDashboardFolder(folderId, {
        name: renameFolderValue.trim(),
      });
      setFolders((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    } catch (err) {
      setError((err as Error).message || t('dashboard.error'));
    } finally {
      setIsMutating(false);
      setRenamingFolderId(null);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (deletingId !== folderId) {
      setDeletingId(folderId);
      return;
    }
    setIsMutating(true);
    setDeletingId(null);
    try {
      await api.reports.deleteDashboardFolder(folderId);
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      setDashboards((prev) =>
        prev.map((d) => (d.folderId === folderId ? { ...d, folderId: null } : d)),
      );
      if (currentFolderId === folderId) onNavigateToFolder(null);
    } catch (err) {
      setError((err as Error).message || t('dashboard.error'));
    } finally {
      setIsMutating(false);
    }
  };

  const handleDeleteDashboard = async (dashboardId: string) => {
    if (deletingId !== dashboardId) {
      setDeletingId(dashboardId);
      return;
    }
    setIsMutating(true);
    setDeletingId(null);
    try {
      await api.reports.deleteDashboard(dashboardId);
      setDashboards((prev) => prev.filter((d) => d.id !== dashboardId));
    } catch (err) {
      setError((err as Error).message || t('dashboard.error'));
    } finally {
      setIsMutating(false);
    }
  };

  const formatUpdated = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const isEmpty = visibleFolders.length === 0 && visibleDashboards.length === 0;
  const emptyKey = searchQuery.trim()
    ? 'dashboard.browser.emptySearch'
    : currentFolderId
      ? 'dashboard.browser.emptyFolder'
      : 'dashboard.browser.emptyRoot';

  return (
    <>
      <div className="space-y-6 animate-in fade-in duration-300">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <button
                type="button"
                onClick={() => onNavigateToFolder(null)}
                className={
                  currentFolderId
                    ? 'font-medium text-praetor hover:underline'
                    : 'font-bold text-slate-800 cursor-default'
                }
              >
                {t('dashboard.browser.title')}
              </button>
              {currentFolder && (
                <>
                  <i className="fa-solid fa-chevron-right text-xs text-slate-400" />
                  <span className="font-bold text-slate-800">{currentFolder.name}</span>
                </>
              )}
            </div>
          </div>

          {canCreate && (
            <div className="flex items-center gap-2">
              {!currentFolderId && (
                <button
                  type="button"
                  onClick={() => openCreateModal('folder')}
                  className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <i className="fa-solid fa-folder-plus text-amber-500" />
                  {t('dashboard.browser.newFolder')}
                </button>
              )}
              <button
                type="button"
                onClick={() => openCreateModal('dashboard')}
                className="flex items-center gap-2 rounded-xl bg-praetor px-4 py-2.5 text-sm font-bold text-white shadow-xl shadow-slate-200 transition hover:brightness-110"
              >
                <i className="fa-solid fa-plus" />
                {t('dashboard.browser.newDashboard')}
              </button>
            </div>
          )}
        </div>

        {/* Search bar */}
        <div className="relative">
          <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('dashboard.browser.searchPlaceholder')}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">
            <i className="fa-solid fa-circle-notch fa-spin mr-2" />
            {t('dashboard.loading')}
          </div>
        ) : isEmpty ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
            {t(emptyKey)}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Folder cards */}
            {visibleFolders.map((folder) => (
              <div
                key={folder.id}
                className="group relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
              >
                <button
                  type="button"
                  onClick={() => onNavigateToFolder(folder.id)}
                  className="flex w-full items-center gap-4 text-left"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <i className="fa-solid fa-folder text-xl" />
                  </div>
                  <div className="min-w-0">
                    {renamingFolderId === folder.id ? (
                      <input
                        value={renameFolderValue}
                        onChange={(e) => setRenameFolderValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRenameFolder(folder.id);
                          if (e.key === 'Escape') setRenamingFolderId(null);
                        }}
                        onBlur={() => void commitRenameFolder(folder.id)}
                        autoFocus
                        className="w-full rounded-lg border border-praetor bg-white px-2 py-1 text-sm font-bold text-slate-800 outline-none"
                      />
                    ) : (
                      <p className="truncate font-bold text-slate-800">{folder.name}</p>
                    )}
                    <p className="text-xs text-slate-500">
                      {t('dashboard.browser.dashboardCount', {
                        count: folder.dashboardCount,
                      })}
                    </p>
                  </div>
                </button>

                {(canUpdate || canDelete) && renamingFolderId !== folder.id && (
                  <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {canUpdate && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startRenameFolder(folder);
                        }}
                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-xs text-slate-500 hover:text-slate-700"
                        title={t('dashboard.browser.renameFolder')}
                      >
                        <i className="fa-solid fa-pen" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteFolder(folder.id);
                        }}
                        disabled={isMutating}
                        className={`rounded-lg border p-1.5 text-xs transition ${
                          deletingId === folder.id
                            ? 'border-red-300 bg-red-50 text-red-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:text-red-600'
                        }`}
                        title={
                          deletingId === folder.id
                            ? t('dashboard.browser.confirmDeleteFolder')
                            : undefined
                        }
                      >
                        <i className="fa-solid fa-trash" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Dashboard cards */}
            {visibleDashboards.map((dashboard) => {
              const folderName =
                searchQuery.trim() && dashboard.folderId
                  ? (folders.find((f) => f.id === dashboard.folderId)?.name ?? null)
                  : null;

              return (
                <div
                  key={dashboard.id}
                  className="group relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
                >
                  <button
                    type="button"
                    onClick={() => onOpenDashboard(dashboard.id)}
                    className="flex w-full items-center gap-4 text-left"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <i className="fa-solid fa-chart-pie text-xl" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-800">{dashboard.name}</p>
                      <p className="text-xs text-slate-500">
                        {t('dashboard.browser.widgetCount', {
                          count: dashboard.widgets.length,
                        })}
                        {folderName ? (
                          <span className="ml-1 text-slate-400">
                            · {t('dashboard.browser.inFolder', { name: folderName })}
                          </span>
                        ) : searchQuery.trim() && !dashboard.folderId ? (
                          <span className="ml-1 text-slate-400">
                            · {t('dashboard.browser.inRoot')}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {t('dashboard.browser.lastUpdated', {
                          date: formatUpdated(dashboard.updatedAt),
                        })}
                      </p>
                    </div>
                  </button>

                  {canDelete && (
                    <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteDashboard(dashboard.id);
                        }}
                        disabled={isMutating}
                        className={`rounded-lg border p-1.5 text-xs transition ${
                          deletingId === dashboard.id
                            ? 'border-red-300 bg-red-50 text-red-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:text-red-600'
                        }`}
                        title={
                          deletingId === dashboard.id
                            ? t('dashboard.browser.confirmDeleteDashboard')
                            : undefined
                        }
                      >
                        <i className="fa-solid fa-trash" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DashboardCreateModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        type={createModalType}
        currentFolderId={currentFolderId}
        onCreated={handleCreated}
      />
    </>
  );
};

export default DashboardBrowser;
