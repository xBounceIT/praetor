import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import type { ReportDashboard, ReportDashboardFolder } from '../../services/api/reports';
import { buildPermission, hasPermission } from '../../utils/permissions';
import Checkbox from '../shared/Checkbox';
import Modal from '../shared/Modal';
import DashboardCreateModal from './DashboardCreateModal';

export interface DashboardBrowserProps {
  permissions: string[];
  onOpenDashboard: (dashboardId: string) => void;
}

// ─── Folder Row ───────────────────────────────────────────────────────────────

interface FolderRowProps {
  folder: ReportDashboardFolder;
  isExpanded: boolean;
  isOver: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isRenaming: boolean;
  renameValue: string;
  isMutating: boolean;
  onToggle: () => void;
  onRenameStart: () => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onDelete: () => void;
  droppableRef: (node: HTMLElement | null) => void;
}

const FolderRow: React.FC<FolderRowProps> = ({
  folder,
  isExpanded,
  isOver,
  canUpdate,
  canDelete,
  isRenaming,
  renameValue,
  isMutating,
  onToggle,
  onRenameStart,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onDelete,
  droppableRef,
}) => {
  const { t } = useTranslation('reports');

  return (
    <div
      ref={droppableRef}
      className={`group flex items-center gap-2 px-2 py-2 transition ${
        isOver ? 'bg-blue-50 ring-2 ring-blue-200' : 'hover:bg-slate-50'
      }`}
    >
      {/* Chevron toggle */}
      <button
        type="button"
        onClick={onToggle}
        className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-400 hover:text-slate-600"
        tabIndex={-1}
      >
        <i
          className={`fa-solid fa-chevron-right text-xs transition-transform duration-200 ${
            isExpanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {/* Folder icon */}
      <i className="fa-solid fa-folder text-base text-amber-500 shrink-0" />

      {/* Name / rename input */}
      {isRenaming ? (
        <input
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameCommit();
            if (e.key === 'Escape') onRenameCancel();
          }}
          onBlur={onRenameCommit}
          autoFocus
          className="min-w-0 flex-1 rounded-lg border border-praetor bg-white px-2 py-0.5 text-sm font-semibold text-slate-800 outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left text-sm font-semibold text-slate-800 truncate"
        >
          {folder.name}
        </button>
      )}

      {/* Dashboard count */}
      <span className="shrink-0 text-xs text-slate-400 tabular-nums">
        {t('dashboard.browser.dashboardCount', { count: folder.dashboardCount })}
      </span>

      {/* Actions (hover) */}
      {(canUpdate || canDelete) && !isRenaming && (
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {canUpdate && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRenameStart();
              }}
              className="rounded-lg border border-slate-200 bg-white p-1 text-xs text-slate-500 hover:text-slate-700"
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
                onDelete();
              }}
              disabled={isMutating}
              className="rounded-lg border border-slate-200 bg-white p-1 text-xs text-slate-500 transition hover:text-red-600"
            >
              <i className="fa-solid fa-trash" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Dashboard Row ─────────────────────────────────────────────────────────────

interface DashboardRowProps {
  dashboard: ReportDashboard;
  indented: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  deletingId: string | null;
  isMutating: boolean;
  folderName?: string | null;
  showFolderBadge?: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

const DashboardRowInner: React.FC<
  DashboardRowProps & {
    dragHandleProps?: React.HTMLAttributes<HTMLElement>;
    dragRef?: (node: HTMLElement | null) => void;
    isDragging?: boolean;
  }
> = ({
  dashboard,
  indented,
  canUpdate,
  canDelete,
  deletingId,
  isMutating,
  folderName,
  showFolderBadge,
  onOpen,
  onDelete,
  dragHandleProps,
  dragRef,
  isDragging,
}) => {
  const { t } = useTranslation('reports');
  const isConfirmDelete = deletingId === dashboard.id;

  const formatUpdated = (ts: number) => {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div
      ref={dragRef}
      className={`group flex items-center gap-2 px-2 py-2 transition ${
        indented ? 'pl-9' : ''
      } ${isDragging ? 'opacity-40' : 'hover:bg-slate-50'}`}
    >
      {/* Drag handle */}
      {canUpdate && (
        <span
          {...dragHandleProps}
          className="shrink-0 cursor-grab touch-none text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        >
          <i className="fa-solid fa-grip-vertical text-xs" />
        </span>
      )}

      {/* Dashboard icon */}
      <i className="fa-solid fa-chart-pie text-base text-blue-500 shrink-0" />

      {/* Name */}
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left text-sm font-medium text-slate-800 truncate hover:text-praetor"
      >
        {dashboard.name}
      </button>

      {/* Folder badge (search mode) */}
      {showFolderBadge && (
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          {folderName
            ? t('dashboard.browser.inFolder', { name: folderName })
            : t('dashboard.browser.inRoot')}
        </span>
      )}

      {/* Widget count */}
      <span className="shrink-0 text-xs text-slate-400 tabular-nums">
        {t('dashboard.browser.widgetCount', { count: dashboard.widgets.length })}
      </span>

      {/* Updated date */}
      <span className="hidden shrink-0 text-xs text-slate-400 sm:block">
        {formatUpdated(dashboard.updatedAt)}
      </span>

      {/* Delete action */}
      {canDelete && (
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            disabled={isMutating}
            className={`rounded-lg border p-1 text-xs transition ${
              isConfirmDelete
                ? 'border-red-300 bg-red-50 text-red-700'
                : 'border-slate-200 bg-white text-slate-500 hover:text-red-600'
            }`}
            title={isConfirmDelete ? t('dashboard.browser.confirmDeleteDashboard') : undefined}
          >
            <i className="fa-solid fa-trash" />
          </button>
        </div>
      )}
    </div>
  );
};

// Draggable wrapper
const DraggableDashboardRow: React.FC<DashboardRowProps> = (props) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: props.dashboard.id,
    data: { type: 'dashboard', dashboard: props.dashboard },
    disabled: !props.canUpdate,
  });

  return (
    <DashboardRowInner
      {...props}
      dragRef={setNodeRef}
      dragHandleProps={{ ...attributes, ...listeners }}
      isDragging={isDragging}
    />
  );
};

// Droppable folder wrapper
const DroppableFolderRow: React.FC<Omit<FolderRowProps, 'isOver' | 'droppableRef'>> = (props) => {
  const { isOver, setNodeRef } = useDroppable({
    id: `folder-${props.folder.id}`,
    data: { type: 'folder', folderId: props.folder.id },
  });

  return <FolderRow {...props} isOver={isOver} droppableRef={setNodeRef} />;
};

// Root droppable zone
const RootDropZone: React.FC<{ children: React.ReactNode; showDropArea: boolean }> = ({
  children,
  showDropArea,
}) => {
  const { isOver, setNodeRef } = useDroppable({
    id: 'root',
    data: { type: 'root' },
  });
  const rootDropZoneClass = [
    showDropArea ? 'min-h-8' : 'min-h-0',
    'rounded-lg transition',
    isOver ? 'bg-blue-50 ring-2 ring-blue-200' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={setNodeRef} className={rootDropZoneClass}>
      {children}
    </div>
  );
};

// ─── Main Browser Component ────────────────────────────────────────────────────

const DashboardBrowser: React.FC<DashboardBrowserProps> = ({ permissions, onOpenDashboard }) => {
  const { t } = useTranslation('reports');
  const [folders, setFolders] = useState<ReportDashboardFolder[]>([]);
  const [dashboards, setDashboards] = useState<ReportDashboard[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalType, setCreateModalType] = useState<'dashboard' | 'folder'>('dashboard');
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [folderPendingDelete, setFolderPendingDelete] = useState<ReportDashboardFolder | null>(
    null,
  );
  const [deleteDashboardsInFolder, setDeleteDashboardsInFolder] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  const canCreate = hasPermission(permissions, buildPermission('reports.dashboard', 'create'));
  const canUpdate = hasPermission(permissions, buildPermission('reports.dashboard', 'update'));
  const canDelete = hasPermission(permissions, buildPermission('reports.dashboard', 'delete'));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (!isAddMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAddMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isAddMenuOpen]);

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

  const dashboardsByFolder = useMemo(() => {
    const map = new Map<string | null, ReportDashboard[]>();
    for (const d of dashboards) {
      const key = d.folderId ?? null;
      if (!map.has(key)) map.set(key, []);
      (map.get(key) as ReportDashboard[]).push(d);
    }
    return map;
  }, [dashboards]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return dashboards.filter((d) => d.name.toLowerCase().includes(q));
  }, [dashboards, searchQuery]);

  const isEmpty = !searchQuery.trim() && folders.length === 0 && dashboards.length === 0;

  // ── Expand/collapse ────────────────────────────────────────────────────────

  const toggleFolder = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  // ── CRUD ───────────────────────────────────────────────────────────────────

  const openCreateModal = (type: 'dashboard' | 'folder') => {
    setIsAddMenuOpen(false);
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

  const openDeleteFolderModal = (folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    setFolderPendingDelete(folder);
    setDeleteDashboardsInFolder(false);
  };

  const closeDeleteFolderModal = () => {
    if (isMutating) return;
    setFolderPendingDelete(null);
    setDeleteDashboardsInFolder(false);
  };

  const handleDeleteFolder = async () => {
    if (!folderPendingDelete) return;
    const folderId = folderPendingDelete.id;
    const shouldDeleteDashboards = deleteDashboardsInFolder;
    setIsMutating(true);
    try {
      await api.reports.deleteDashboardFolder(folderId, {
        deleteDashboards: shouldDeleteDashboards,
      });
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      if (shouldDeleteDashboards) {
        setDashboards((prev) => prev.filter((d) => d.folderId !== folderId));
      } else {
        setDashboards((prev) =>
          prev.map((d) => (d.folderId === folderId ? { ...d, folderId: null } : d)),
        );
      }
      setFolderPendingDelete(null);
      setDeleteDashboardsInFolder(false);
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

  // ── Drag-and-drop ──────────────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    setDeletingId(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const draggedId = activeDragId;
    setActiveDragId(null);

    const { over } = event;
    if (!over || !draggedId) return;

    const overData = over.data.current as { type: string; folderId?: string } | undefined;
    const newFolderId: string | null =
      overData?.type === 'folder' ? (overData.folderId ?? null) : null;

    const dashboard = dashboards.find((d) => d.id === draggedId);
    if (!dashboard) return;

    const oldFolderId = dashboard.folderId ?? null;
    if (oldFolderId === newFolderId) return;

    // Optimistic update
    setDashboards((prev) =>
      prev.map((d) => (d.id === draggedId ? { ...d, folderId: newFolderId } : d)),
    );
    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === oldFolderId) return { ...f, dashboardCount: f.dashboardCount - 1 };
        if (f.id === newFolderId) return { ...f, dashboardCount: f.dashboardCount + 1 };
        return f;
      }),
    );

    try {
      await api.reports.updateDashboard(draggedId, { folderId: newFolderId });
    } catch (err) {
      // Revert
      setDashboards((prev) =>
        prev.map((d) => (d.id === draggedId ? { ...d, folderId: oldFolderId } : d)),
      );
      setFolders((prev) =>
        prev.map((f) => {
          if (f.id === oldFolderId) return { ...f, dashboardCount: f.dashboardCount + 1 };
          if (f.id === newFolderId) return { ...f, dashboardCount: f.dashboardCount - 1 };
          return f;
        }),
      );
      setError((err as Error).message || t('dashboard.error'));
    }
  };

  const activeDashboard = activeDragId ? dashboards.find((d) => d.id === activeDragId) : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-6 animate-in fade-in duration-300">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-black text-slate-800">{t('dashboard.browser.title')}</h2>

          {canCreate && (
            <div className="relative" ref={addMenuRef}>
              <button
                type="button"
                onClick={() => setIsAddMenuOpen((prev) => !prev)}
                className="flex items-center gap-2 rounded-xl bg-praetor px-4 py-2.5 text-sm font-bold text-white shadow-xl shadow-slate-200 transition hover:brightness-110"
                aria-haspopup="menu"
                aria-expanded={isAddMenuOpen}
              >
                <i className="fa-solid fa-plus" />
                {t('dashboard.browser.add')}
              </button>

              {isAddMenuOpen && (
                <div
                  className="absolute right-0 z-30 mt-2 w-56 rounded-2xl border border-slate-200 bg-white py-2 shadow-xl animate-in fade-in zoom-in-95 duration-150 origin-top-right"
                  role="menu"
                >
                  <button
                    type="button"
                    onClick={() => openCreateModal('folder')}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                    role="menuitem"
                  >
                    <i className="fa-solid fa-folder-plus text-amber-500" />
                    {t('dashboard.browser.newFolder')}
                  </button>
                  <button
                    type="button"
                    onClick={() => openCreateModal('dashboard')}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                    role="menuitem"
                  >
                    <i className="fa-solid fa-chart-pie text-blue-500" />
                    {t('dashboard.browser.newDashboard')}
                  </button>
                </div>
              )}
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
            {t('dashboard.browser.emptyRoot')}
          </div>
        ) : searchResults ? (
          /* ── Search results (flat) ── */
          searchResults.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
              {t('dashboard.browser.emptySearch')}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
              {searchResults.map((dashboard) => {
                const folderName = dashboard.folderId
                  ? (folders.find((f) => f.id === dashboard.folderId)?.name ?? null)
                  : null;
                return (
                  <DashboardRowInner
                    key={dashboard.id}
                    dashboard={dashboard}
                    indented={false}
                    canUpdate={canUpdate}
                    canDelete={canDelete}
                    deletingId={deletingId}
                    isMutating={isMutating}
                    folderName={folderName}
                    showFolderBadge
                    onOpen={() => onOpenDashboard(dashboard.id)}
                    onDelete={() => void handleDeleteDashboard(dashboard.id)}
                  />
                );
              })}
            </div>
          )
        ) : (
          /* ── Tree view ── */
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
              {/* Folders */}
              {folders.map((folder) => {
                const children = dashboardsByFolder.get(folder.id) ?? [];
                const isExpanded = expandedFolderIds.has(folder.id);

                return (
                  <div key={folder.id}>
                    <DroppableFolderRow
                      folder={folder}
                      isExpanded={isExpanded}
                      canUpdate={canUpdate}
                      canDelete={canDelete}
                      isRenaming={renamingFolderId === folder.id}
                      renameValue={renameFolderValue}
                      isMutating={isMutating}
                      onToggle={() => toggleFolder(folder.id)}
                      onRenameStart={() => {
                        setRenamingFolderId(folder.id);
                        setRenameFolderValue(folder.name);
                      }}
                      onRenameChange={setRenameFolderValue}
                      onRenameCommit={() => void commitRenameFolder(folder.id)}
                      onRenameCancel={() => setRenamingFolderId(null)}
                      onDelete={() => openDeleteFolderModal(folder.id)}
                    />

                    {/* Animated children container */}
                    <div
                      className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
                        isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                      }`}
                    >
                      <div className="overflow-hidden min-h-0">
                        {children.length === 0 ? (
                          <div className="pl-9 py-2 text-xs text-slate-400 italic">
                            {t('dashboard.browser.emptyFolderExpanded')}
                          </div>
                        ) : (
                          children.map((dashboard) => (
                            <DraggableDashboardRow
                              key={dashboard.id}
                              dashboard={dashboard}
                              indented
                              canUpdate={canUpdate}
                              canDelete={canDelete}
                              deletingId={deletingId}
                              isMutating={isMutating}
                              onOpen={() => onOpenDashboard(dashboard.id)}
                              onDelete={() => void handleDeleteDashboard(dashboard.id)}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Root-level (unfiled) dashboards */}
              <RootDropZone showDropArea={Boolean(activeDragId)}>
                {(dashboardsByFolder.get(null) ?? []).map((dashboard) => (
                  <DraggableDashboardRow
                    key={dashboard.id}
                    dashboard={dashboard}
                    indented={false}
                    canUpdate={canUpdate}
                    canDelete={canDelete}
                    deletingId={deletingId}
                    isMutating={isMutating}
                    onOpen={() => onOpenDashboard(dashboard.id)}
                    onDelete={() => void handleDeleteDashboard(dashboard.id)}
                  />
                ))}
              </RootDropZone>
            </div>

            {/* Drag overlay */}
            <DragOverlay>
              {activeDashboard ? (
                <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-white px-3 py-2 shadow-lg">
                  <i className="fa-solid fa-chart-pie text-blue-500" />
                  <span className="text-sm font-medium text-slate-700">{activeDashboard.name}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <DashboardCreateModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        type={createModalType}
        folders={folders}
        onCreated={handleCreated}
      />

      <Modal isOpen={Boolean(folderPendingDelete)} onClose={closeDeleteFolderModal}>
        <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="space-y-4 p-6">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
              <i className="fa-solid fa-trash text-xl text-red-600" />
            </div>

            <div className="text-center">
              <h3 className="text-xl font-black text-slate-800">
                {t('dashboard.browser.deleteFolderTitleWithName', {
                  name: folderPendingDelete?.name,
                })}
              </h3>
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-100 px-6 py-4">
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <Checkbox
                checked={deleteDashboardsInFolder}
                onChange={(e) => setDeleteDashboardsInFolder(e.target.checked)}
                disabled={isMutating}
              />
              <span className="text-sm font-semibold text-slate-700">
                {t('dashboard.browser.deleteFolderWithDashboards')}
              </span>
            </label>
            <p className="text-xs text-slate-400">{t('dashboard.browser.deleteFolderHint')}</p>
          </div>

          <div className="flex gap-3 px-6 pb-6">
            <button
              type="button"
              onClick={closeDeleteFolderModal}
              disabled={isMutating}
              className="flex-1 rounded-xl py-3 text-sm font-bold text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {t('dashboard.createModal.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteFolder()}
              disabled={isMutating}
              className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white shadow-lg shadow-red-200 transition-all hover:bg-red-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {isMutating ? (
                <i className="fa-solid fa-circle-notch fa-spin" />
              ) : (
                t('dashboard.browser.deleteFolderAction')
              )}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default DashboardBrowser;
