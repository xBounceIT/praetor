import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Checkbox from './Checkbox';
import CustomSelect from './CustomSelect';
import CustomViewModal from './CustomViewModal';
import {
  type CustomView,
  computeViewApplication,
  type FilterState,
  generateViewId,
  IMPORT_PAYLOAD_MAX_BYTES,
  isValidImportedView,
  moveByDelta,
  parseFilterState,
  parseSortState,
  parseStoredViews,
  reorderDropAbove,
  type SortState,
} from './customViewHelpers';
import TableFilter from './TableFilter';
import Tooltip from './Tooltip';

const getStorageKey = (t: string, suffix: string) =>
  `praetor_table_${suffix}_${t.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;

const FONT_SIZES = ['xs', 'sm', 'base'] as const;
type FontSize = (typeof FONT_SIZES)[number];

type ViewModalState = { kind: 'create' } | { kind: 'edit'; view: CustomView } | null;

const ViewActionButton = ({
  icon,
  title,
  onClick,
  className = 'hover:bg-slate-200 text-slate-500',
}: {
  icon: string;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-label={title}
    className={`w-5 h-5 flex items-center justify-center rounded ${className}`}
  >
    <i className={`fa-solid ${icon} text-[9px]`} aria-hidden="true"></i>
  </button>
);

export type Column<T> = {
  header: string;
  accessorKey?: keyof T;
  accessorFn?: (row: T) => string | number | boolean | null | undefined;
  cell?: (info: {
    getValue: () => T[keyof T] | string | number | boolean | null | undefined;
    row: T;
    value: T[keyof T] | string | number | boolean | null | undefined;
  }) => ReactNode;
  id?: string; // Unique ID for the column, required if accessorKey is missing
  className?: string;
  headerClassName?: string;
  disableSorting?: boolean;
  disableFiltering?: boolean;
  filterFormat?: (value: T[keyof T] | string | number | boolean | null | undefined) => string;
  align?: 'left' | 'center' | 'right';
  hidden?: boolean;
  sticky?: 'right';
  onCellDoubleClick?: (row: T) => void; // Cell-level double click handler
};

export type StandardTableProps<T extends object = object> = {
  title: string;
  totalCount?: number;
  totalLabel?: string;
  headerExtras?: ReactNode;
  headerAction?: ReactNode;
  containerClassName?: string;
  tableContainerClassName?: string;
  footer?: ReactNode;
  footerClassName?: string;
  children?: ReactNode;
  emptyState?: ReactNode;
  // Data-driven props
  data?: T[];
  columns?: Column<T>[];
  defaultRowsPerPage?: number;
  rowClassName?: (row: T) => string;
  disabledRow?: (row: T) => boolean;
  onRowClick?: (row: T) => void;
  initialFilterState?: Record<string, string[]>;
};

const StandardTable = <T extends object>({
  title,
  totalCount: externalTotalCount,
  totalLabel,
  headerExtras,
  headerAction,
  containerClassName,
  tableContainerClassName,
  footer: externalFooter,
  footerClassName,
  children,
  emptyState,
  data,
  columns,
  defaultRowsPerPage = 10,
  rowClassName,
  disabledRow,
  onRowClick,
  initialFilterState,
}: StandardTableProps<T>) => {
  const { t } = useTranslation('common');
  const filterRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const gearButtonRef = useRef<HTMLButtonElement>(null);
  const gearPopupRef = useRef<HTMLDivElement>(null);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  // Internal State for Data Mode
  const [sortState, setSortState] = useState<SortState>(null);
  const [filterState, setFilterState] = useState<FilterState>(initialFilterState ?? {});

  const [activeFilterCol, setActiveFilterCol] = useState<string | null>(null);
  const [filterPos, setFilterPos] = useState<{ top: number; left: number } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [gearOpen, setGearOpen] = useState(false);
  const [resizingColId, setResizingColId] = useState<string | null>(null);

  // Lazy initialization for rowsPerPage
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    if (typeof window === 'undefined') return defaultRowsPerPage;
    const key = getStorageKey(title, 'rows');
    const saved = localStorage.getItem(key);
    if (saved) {
      const val = Number(saved);
      if ([5, 10, 20, 50].includes(val)) {
        return val;
      }
    }
    return defaultRowsPerPage;
  });

  // Lazy initialization for fontSize
  const [fontSize, setFontSize] = useState<FontSize>(() => {
    if (typeof window === 'undefined') return 'sm';
    const saved = localStorage.getItem(getStorageKey(title, 'fontsize'));
    if (saved && (FONT_SIZES as readonly string[]).includes(saved)) return saved as FontSize;
    return 'sm';
  });

  // Session-only: column visibility resets on page reload
  const [hiddenColIds, setHiddenColIds] = useState<Set<string>>(new Set<string>());

  // Lazy initialization for columnWidths
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    const saved = localStorage.getItem(getStorageKey(title, 'colwidths'));
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, number>;
      } catch {}
    }
    return {};
  });

  const [customViews, setCustomViews] = useState<CustomView[]>(() => {
    if (typeof window === 'undefined') return [];
    return parseStoredViews(localStorage.getItem(getStorageKey(title, 'customviews')));
  });
  const [activeViewId, setActiveViewId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(getStorageKey(title, 'activeview'));
  });
  const [viewsSubmenuOpen, setViewsSubmenuOpen] = useState(false);
  const [modalState, setModalState] = useState<ViewModalState>(null);
  const [draggingViewId, setDraggingViewId] = useState<string | null>(null);
  const [dragOverViewId, setDragOverViewId] = useState<string | null>(null);
  const [copiedViewId, setCopiedViewId] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const viewsHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewsAppliedOnceRef = useRef(false);

  const storageKey = useMemo(() => getStorageKey(title, 'rows'), [title]);

  const persistCustomViews = useCallback(
    (views: CustomView[]) => {
      if (typeof window === 'undefined') return;
      try {
        localStorage.setItem(getStorageKey(title, 'customviews'), JSON.stringify(views));
      } catch {}
    },
    [title],
  );

  const persistActiveViewId = useCallback(
    (id: string | null) => {
      if (typeof window === 'undefined') return;
      const key = getStorageKey(title, 'activeview');
      try {
        if (id) localStorage.setItem(key, id);
        else localStorage.removeItem(key);
      } catch {}
    },
    [title],
  );

  const updateActiveViewId = useCallback(
    (id: string | null) => {
      setActiveViewId(id);
      persistActiveViewId(id);
    },
    [persistActiveViewId],
  );

  // Sync table filterState with prop changes. After the boot apply-view effect
  // has run, prop-driven resets are dirty changes — clear the active marker so
  // the UI doesn't claim a view is applied when its filter snapshot diverges.
  useEffect(() => {
    setFilterState(initialFilterState ?? {});
    if (viewsAppliedOnceRef.current) {
      updateActiveViewId(null);
    }
  }, [initialFilterState, updateActiveViewId]);

  const getColId = useCallback(
    (col: Column<T>) =>
      col.id || (col.accessorKey ? String(col.accessorKey) : undefined) || col.header,
    [],
  );

  const visibleColumns = useMemo(
    () =>
      columns?.filter((col) => {
        if (col.hidden) return false;
        return !hiddenColIds.has(getColId(col));
      }) ?? [],
    [columns, hiddenColIds, getColId],
  );

  // Columns listed in gear popup (excludes statically hidden filter-only columns)
  const gearColumns = useMemo(() => columns?.filter((col) => !col.hidden) ?? [], [columns]);

  const activeView = activeViewId ? (customViews.find((v) => v.id === activeViewId) ?? null) : null;

  const applyViewState = useCallback(
    (view: CustomView) => {
      const gearIds = new Set(gearColumns.map((c) => getColId(c)));
      const allIds = new Set((columns ?? []).map((c) => getColId(c)));
      const result = computeViewApplication(view, gearIds, allIds);
      setHiddenColIds(result.hiddenColIds);
      setSortState(result.sortState);
      setFilterState(result.filterState);
    },
    [columns, gearColumns, getColId],
  );

  useEffect(() => {
    if (viewsAppliedOnceRef.current) return;
    if (!gearColumns.length) return;
    viewsAppliedOnceRef.current = true;
    if (!activeViewId) return;
    const view = customViews.find((v) => v.id === activeViewId);
    if (!view) {
      updateActiveViewId(null);
      return;
    }
    applyViewState(view);
    // Preserve deep-link / initial paging — don't reset currentPage
  }, [gearColumns, activeViewId, customViews, applyViewState, updateActiveViewId]);

  // Close submenu whenever the gear popup closes, so re-opening starts collapsed
  useEffect(() => {
    if (!gearOpen) setViewsSubmenuOpen(false);
  }, [gearOpen]);

  useEffect(
    () => () => {
      if (viewsHoverTimeoutRef.current) clearTimeout(viewsHoverTimeoutRef.current);
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      if (viewErrorTimeoutRef.current) clearTimeout(viewErrorTimeoutRef.current);
    },
    [],
  );

  const showViewError = useCallback((msg: string) => {
    setViewError(msg);
    if (viewErrorTimeoutRef.current) clearTimeout(viewErrorTimeoutRef.current);
    viewErrorTimeoutRef.current = setTimeout(() => setViewError(null), 3000);
  }, []);

  const fontSizeClass = fontSize === 'xs' ? 'text-xs' : fontSize === 'sm' ? 'text-sm' : 'text-base';

  // Close filter popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        filterRef.current &&
        !filterRef.current.contains(event.target as Node) &&
        popupRef.current &&
        !popupRef.current.contains(event.target as Node)
      ) {
        setActiveFilterCol(null);
      }
    };

    if (activeFilterCol) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeFilterCol]);

  // Close gear popup when clicking outside
  useEffect(() => {
    if (!gearOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        gearButtonRef.current &&
        !gearButtonRef.current.contains(event.target as Node) &&
        gearPopupRef.current &&
        !gearPopupRef.current.contains(event.target as Node)
      ) {
        setGearOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [gearOpen]);

  // Column resize mouse events
  useEffect(() => {
    if (!resizingColId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartXRef.current;
      const newWidth = Math.max(40, resizeStartWidthRef.current + delta);
      setColumnWidths((prev) => ({ ...prev, [resizingColId]: newWidth }));
    };

    const handleMouseUp = () => {
      setResizingColId(null);
      document.body.style.cursor = '';
      setColumnWidths((prev) => {
        localStorage.setItem(getStorageKey(title, 'colwidths'), JSON.stringify(prev));
        return prev;
      });
    };

    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };
  }, [resizingColId, title]);

  // Helper to resolve value
  const getValue = useCallback((row: T, col: Column<T>) => {
    if (col.accessorFn) return col.accessorFn(row);
    if (col.accessorKey) return row[col.accessorKey];
    return null;
  }, []);

  // Normalize empty raw values to a single sentinel so the filter list shows
  // one "N/A" entry instead of "", "null", "undefined" duplicates. Columns
  // with their own `filterFormat` returning a placeholder (e.g. '-') are
  // unaffected because their raw value isn't null/empty.
  const formatForFilter = useCallback(
    (rawVal: T[keyof T] | string | number | boolean | null | undefined, col: Column<T>): string => {
      if (rawVal === null || rawVal === undefined || rawVal === '') return '';
      return col.filterFormat ? col.filterFormat(rawVal) : String(rawVal);
    },
    [],
  );

  // Derived Data
  const processedData = useMemo(() => {
    if (!data || !columns) return [];
    let result = [...data];

    // 1. Filtering
    Object.keys(filterState).forEach((filterColId) => {
      const selectedValues = filterState[filterColId];
      if (selectedValues && selectedValues.length > 0) {
        const col = columns.find((c) => getColId(c) === filterColId);
        if (col) {
          result = result.filter((row) => {
            const rawVal = getValue(row, col);
            const val = formatForFilter(rawVal, col);
            return selectedValues.includes(val);
          });
        }
      }
    });

    // 2. Sorting
    if (sortState) {
      const col = columns.find((c) => getColId(c) === sortState.colId);
      if (col) {
        result.sort((a, b) => {
          const valA = getValue(a, col);
          const valB = getValue(b, col);

          // Simple comparison handling numbers and strings
          if (typeof valA === 'number' && typeof valB === 'number') {
            return sortState.px === 'asc' ? valA - valB : valB - valA;
          }
          const strA = String(valA || '').toLowerCase();
          const strB = String(valB || '').toLowerCase();
          if (strA < strB) return sortState.px === 'asc' ? -1 : 1;
          if (strA > strB) return sortState.px === 'asc' ? 1 : -1;
          return 0;
        });
      }
    }

    return result;
  }, [data, columns, filterState, sortState, getValue, getColId, formatForFilter]);

  // Pagination
  const totalItems = data ? processedData.length : externalTotalCount || 0;
  const totalPages = Math.ceil(totalItems / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedData = data ? processedData.slice(startIndex, startIndex + rowsPerPage) : [];

  // Filter Options Generator
  const getFilterOptions = (colId: string) => {
    if (!data || !columns) return [];
    const col = columns.find((c) => getColId(c) === colId);
    if (!col) return [];

    // Get all unique values from the FULL dataset
    const values = new Set<string>();
    data.forEach((row) => {
      const val = getValue(row, col);
      values.add(formatForFilter(val, col));
    });
    return Array.from(values).sort();
  };

  // Handlers
  const handleSort = (colId: string, dir: 'asc' | 'desc' | null) => {
    if (!dir) setSortState(null);
    else setSortState({ colId, px: dir });
    updateActiveViewId(null);
  };

  const handleFilter = (colId: string, selected: string[]) => {
    setFilterState((prev) => {
      const next = { ...prev };
      if (selected.length === 0) delete next[colId];
      else next[colId] = selected;
      return next;
    });
    setCurrentPage(1); // Reset to page 1 on filter
    updateActiveViewId(null);
  };

  const handleIncreaseFontSize = () => {
    setFontSize((prev) => {
      const idx = FONT_SIZES.indexOf(prev);
      const next = idx < FONT_SIZES.length - 1 ? FONT_SIZES[idx + 1] : prev;
      localStorage.setItem(getStorageKey(title, 'fontsize'), next);
      return next;
    });
  };

  const handleDecreaseFontSize = () => {
    setFontSize((prev) => {
      const idx = FONT_SIZES.indexOf(prev);
      const next = idx > 0 ? FONT_SIZES[idx - 1] : prev;
      localStorage.setItem(getStorageKey(title, 'fontsize'), next);
      return next;
    });
  };

  const toggleColumnVisibility = (colId: string) => {
    setHiddenColIds((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) {
        next.delete(colId);
      } else {
        next.add(colId);
        if (sortState?.colId === colId) setSortState(null);
        setFilterState((fs) => {
          if (!fs[colId]) return fs;
          const nextFs = { ...fs };
          delete nextFs[colId];
          return nextFs;
        });
      }
      return next;
    });
    updateActiveViewId(null);
  };

  const resetColumnVisibility = () => {
    setHiddenColIds(new Set<string>());
    updateActiveViewId(null);
  };

  const applyView = (view: CustomView) => {
    applyViewState(view);
    updateActiveViewId(view.id);
    setCurrentPage(1);
    setViewsSubmenuOpen(false);
    setGearOpen(false);
  };

  const saveView = ({ name, hiddenColIds: hidden }: { name: string; hiddenColIds: string[] }) => {
    if (modalState?.kind === 'edit') {
      const editingId = modalState.view.id;
      setCustomViews((prev) => {
        const next = prev.map((v) =>
          v.id === editingId ? { ...v, name, hiddenColIds: hidden, sortState, filterState } : v,
        );
        persistCustomViews(next);
        return next;
      });
      // If the edited view is currently active, mirror its new column visibility on the table.
      if (activeViewId === editingId) {
        setHiddenColIds(new Set(hidden));
      }
    } else {
      const newView: CustomView = {
        id: generateViewId(),
        name,
        hiddenColIds: hidden,
        sortState,
        filterState,
      };
      setCustomViews((prev) => {
        const next = [...prev, newView];
        persistCustomViews(next);
        return next;
      });
      updateActiveViewId(newView.id);
      setHiddenColIds(new Set(hidden));
    }
    setModalState(null);
  };

  const deleteView = (id: string) => {
    setCustomViews((prev) => {
      const next = prev.filter((v) => v.id !== id);
      persistCustomViews(next);
      return next;
    });
    if (activeViewId === id) updateActiveViewId(null);
  };

  // Keyboard-accessible single-step reorder: ArrowUp/ArrowDown on the grip
  // swaps the view with its neighbor. Mouse drag still uses `reorderViews`.
  const moveViewByDelta = (id: string, delta: number) => {
    setCustomViews((prev) => {
      const idx = prev.findIndex((v) => v.id === id);
      const next = moveByDelta(prev, idx, delta);
      if (next === prev) return prev;
      persistCustomViews(next);
      return next;
    });
  };

  const reorderViews = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setCustomViews((prev) => {
      const fromIdx = prev.findIndex((v) => v.id === fromId);
      const toIdx = prev.findIndex((v) => v.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = reorderDropAbove(prev, fromIdx, toIdx);
      persistCustomViews(next);
      return next;
    });
  };

  const exportView = (view: CustomView) => {
    const payload = {
      name: view.name,
      hiddenColIds: view.hiddenColIds,
      sortState: view.sortState,
      filterState: view.filterState,
    };
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      showViewError(t('table.viewActionUnavailable'));
      return;
    }
    navigator.clipboard
      .writeText(JSON.stringify(payload))
      .then(() => {
        setCopiedViewId(view.id);
        if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
        copiedTimeoutRef.current = setTimeout(() => setCopiedViewId(null), 1500);
      })
      .catch(() => {
        showViewError(t('table.viewCopyFailed'));
      });
  };

  const importView = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      showViewError(t('table.viewActionUnavailable'));
      return;
    }
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      showViewError(t('table.viewClipboardDenied'));
      return;
    }
    if (text.length > IMPORT_PAYLOAD_MAX_BYTES) {
      showViewError(t('table.viewImportTooLarge'));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      showViewError(t('table.viewImportFailed'));
      return;
    }
    if (!isValidImportedView(parsed)) {
      showViewError(t('table.viewImportFailed'));
      return;
    }
    const newView: CustomView = {
      id: generateViewId(),
      name: parsed.name,
      hiddenColIds: parsed.hiddenColIds,
      sortState: parseSortState(parsed.sortState),
      filterState: parseFilterState(parsed.filterState),
    };
    setCustomViews((prev) => {
      const next = [...prev, newView];
      persistCustomViews(next);
      return next;
    });
    setViewError(null);
  };

  const handleViewsMouseEnter = () => {
    if (viewsHoverTimeoutRef.current) clearTimeout(viewsHoverTimeoutRef.current);
    setViewsSubmenuOpen(true);
  };

  const handleViewsMouseLeave = () => {
    if (viewsHoverTimeoutRef.current) clearTimeout(viewsHoverTimeoutRef.current);
    viewsHoverTimeoutRef.current = setTimeout(() => setViewsSubmenuOpen(false), 200);
  };

  const handleResizeStart = (e: React.MouseEvent<HTMLDivElement>, colId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.parentElement as HTMLTableCellElement;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = th.getBoundingClientRect().width;
    setResizingColId(colId);
  };

  // Internal Footer Render
  const renderInternalFooter = () => (
    <>
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-slate-500">{t('pagination.rowsPerPage')}</span>
        <CustomSelect
          options={[
            { id: '5', name: '5' },
            { id: '10', name: '10' },
            { id: '20', name: '20' },
            { id: '50', name: '50' },
          ]}
          value={rowsPerPage.toString()}
          onChange={(val) => {
            const newValue = Number(val);
            setRowsPerPage(newValue);
            setCurrentPage(1);
            if (storageKey) {
              localStorage.setItem(storageKey, String(newValue));
            }
          }}
          className="w-20"
          buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
          searchable={false}
        />
        <span className="text-xs font-bold text-slate-400 ml-2">
          {t('pagination.showing')
            .replace('{{start}}', String(totalItems > 0 ? startIndex + 1 : 0))
            .replace('{{end}}', String(Math.min(startIndex + rowsPerPage, totalItems)))
            .replace('{{total}}', String(totalItems))}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCurrentPage((prev) => Math.max(1, prev - 1));
          }}
          disabled={currentPage === 1}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
        >
          <i className="fa-solid fa-chevron-left text-xs"></i>
        </button>
        <div className="flex items-center gap-1">
          {/* Simple pagination logic: show all pages logic might be too big, limiting to 5 mostly used in InternalListingView */}
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(
              (p) => p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1),
            )
            .map((page, i, arr) => (
              <div key={page} className="flex items-center">
                {i > 0 && page - arr[i - 1] > 1 && <span className="text-slate-400 mx-1">...</span>}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentPage(page);
                  }}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                    currentPage === page
                      ? 'bg-praetor text-white shadow-md shadow-slate-200'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {page}
                </button>
              </div>
            ))}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCurrentPage((prev) => Math.min(totalPages, prev + 1));
          }}
          disabled={currentPage === totalPages || totalPages === 0}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
        >
          <i className="fa-solid fa-chevron-right text-xs"></i>
        </button>
      </div>
    </>
  );

  // Render
  return (
    <div
      className={`bg-white rounded-3xl border border-slate-200 shadow-sm ${containerClassName ?? ''}`.trim()}
    >
      <div className="px-3 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center rounded-t-3xl">
        <div className="flex items-center gap-3">
          <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">
            {title}
          </h4>
          {typeof totalItems === 'number' && (
            <span className="bg-slate-100 text-praetor px-3 py-1 rounded-full text-[10px] font-black uppercase">
              {totalItems} {totalLabel || t('table.total')}
            </span>
          )}
        </div>
        {(data != null && columns != null) || headerExtras != null || headerAction != null ? (
          <div className="flex items-center gap-3">
            {data != null && columns != null && (
              <div className="flex items-center gap-1">
                <Tooltip label={t('table.decreaseFont')} position="bottom">
                  {() => (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDecreaseFontSize();
                      }}
                      disabled={fontSize === 'xs'}
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                    >
                      <i className="fa-solid fa-minus text-[10px]"></i>
                    </button>
                  )}
                </Tooltip>
                <Tooltip label={t('table.increaseFont')} position="bottom">
                  {() => (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleIncreaseFontSize();
                      }}
                      disabled={fontSize === 'base'}
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                    >
                      <i className="fa-solid fa-plus text-[10px]"></i>
                    </button>
                  )}
                </Tooltip>
                <div className="relative">
                  <Tooltip label={t('table.columnSettings')} position="bottom" disabled={gearOpen}>
                    {() => (
                      <button
                        type="button"
                        ref={gearButtonRef}
                        onClick={(e) => {
                          e.stopPropagation();
                          setGearOpen((prev) => !prev);
                        }}
                        className={`w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 bg-white transition-colors ${gearOpen ? 'text-praetor bg-slate-100' : 'text-slate-500 hover:bg-slate-100'}`}
                      >
                        <i className="fa-solid fa-gear text-[10px]"></i>
                      </button>
                    )}
                  </Tooltip>
                  {gearOpen && (
                    <div
                      ref={gearPopupRef}
                      className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 animate-in fade-in zoom-in-95 duration-200 origin-top-right"
                    >
                      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2">
                        <span
                          className="text-[10px] font-black text-slate-400 uppercase tracking-wider truncate"
                          title={activeView ? activeView.name : undefined}
                        >
                          {activeView
                            ? `${t('table.columns')} · ${activeView.name}`
                            : t('table.columns')}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setGearOpen(false);
                          }}
                          className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
                        >
                          <i className="fa-solid fa-xmark text-xs"></i>
                        </button>
                      </div>
                      <div className="max-h-60 overflow-y-auto p-1.5 space-y-0.5">
                        {gearColumns.map((col) => {
                          const colId = getColId(col);
                          const isVisible = !hiddenColIds.has(colId);
                          const isLastVisible = visibleColumns.length === 1 && isVisible;
                          return (
                            <div
                              key={colId}
                              className="flex items-center gap-2 px-1.5 py-1 hover:bg-slate-50 rounded cursor-pointer"
                              onClick={() => !isLastVisible && toggleColumnVisibility(colId)}
                            >
                              <Checkbox
                                size="sm"
                                checked={isVisible}
                                disabled={isLastVisible}
                                onChange={() => toggleColumnVisibility(colId)}
                              />
                              <span className="text-[11px] text-slate-600 select-none">
                                {col.header}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="p-2 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            resetColumnVisibility();
                          }}
                          className="w-full px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:text-white bg-slate-50 hover:bg-praetor rounded-lg transition-all flex items-center justify-center gap-1.5"
                        >
                          <i className="fa-solid fa-rotate-left text-[10px]"></i>
                          <span>{t('table.resetColumns')}</span>
                        </button>
                      </div>
                      <div
                        className="relative border-t border-slate-100 p-2"
                        onMouseEnter={handleViewsMouseEnter}
                        onMouseLeave={handleViewsMouseLeave}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewsSubmenuOpen(true);
                          }}
                          onFocus={() => setViewsSubmenuOpen(true)}
                          className={`w-full px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors flex items-center justify-between ${
                            viewsSubmenuOpen
                              ? 'bg-slate-100 text-praetor'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <i className="fa-solid fa-layer-group text-[10px]"></i>
                            {t('table.customViews')}
                            {customViews.length > 0 && (
                              <span className="text-[9px] font-bold text-slate-400">
                                ({customViews.length})
                              </span>
                            )}
                          </span>
                          <i className="fa-solid fa-chevron-right text-[9px]"></i>
                        </button>
                        {viewsSubmenuOpen && (
                          <div
                            className="absolute right-full top-0 mr-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 animate-in fade-in zoom-in-95 duration-150 origin-top-right"
                            onMouseEnter={handleViewsMouseEnter}
                            onMouseLeave={handleViewsMouseLeave}
                          >
                            <div className="px-3 py-2 border-b border-slate-100">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                {t('table.customViews')}
                              </span>
                            </div>
                            {customViews.length > 0 && (
                              <div className="max-h-60 overflow-y-auto p-1.5 space-y-0.5">
                                {customViews.map((view) => {
                                  const isActive = view.id === activeViewId;
                                  const isCopied = copiedViewId === view.id;
                                  const isDragOver =
                                    dragOverViewId === view.id && draggingViewId !== view.id;
                                  return (
                                    <div
                                      key={view.id}
                                      draggable
                                      onDragStart={(e) => {
                                        e.stopPropagation();
                                        e.dataTransfer.effectAllowed = 'move';
                                        // Firefox aborts the drag unless setData is called.
                                        e.dataTransfer.setData('text/plain', view.name);
                                        setDraggingViewId(view.id);
                                      }}
                                      onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        e.dataTransfer.dropEffect = 'move';
                                        if (
                                          draggingViewId &&
                                          draggingViewId !== view.id &&
                                          dragOverViewId !== view.id
                                        ) {
                                          setDragOverViewId(view.id);
                                        }
                                      }}
                                      onDragLeave={(e) => {
                                        e.stopPropagation();
                                        if (dragOverViewId === view.id) setDragOverViewId(null);
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (draggingViewId) {
                                          reorderViews(draggingViewId, view.id);
                                        }
                                        setDraggingViewId(null);
                                        setDragOverViewId(null);
                                      }}
                                      onDragEnd={() => {
                                        setDraggingViewId(null);
                                        setDragOverViewId(null);
                                      }}
                                      className={`group flex items-center gap-1 px-1.5 py-1 rounded transition-colors border-t-2 ${
                                        isActive ? 'bg-slate-100' : 'hover:bg-slate-50'
                                      } ${isDragOver ? 'border-praetor' : 'border-transparent'} ${
                                        draggingViewId === view.id ? 'opacity-40' : ''
                                      }`}
                                    >
                                      <button
                                        type="button"
                                        title={t('table.reorderViewHandle')}
                                        aria-label={t('table.reorderViewHandle')}
                                        onClick={(e) => e.stopPropagation()}
                                        onKeyDown={(e) => {
                                          if (e.key === 'ArrowUp') {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            moveViewByDelta(view.id, -1);
                                          } else if (e.key === 'ArrowDown') {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            moveViewByDelta(view.id, 1);
                                          }
                                        }}
                                        className="text-slate-300 group-hover:text-slate-400 hover:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-praetor/40 rounded cursor-move flex-shrink-0 px-0.5"
                                      >
                                        <i
                                          className="fa-solid fa-grip-vertical text-[10px]"
                                          aria-hidden="true"
                                        ></i>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          applyView(view);
                                        }}
                                        className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
                                        title={view.name}
                                      >
                                        {isActive && (
                                          <i className="fa-solid fa-check text-[10px] text-praetor flex-shrink-0"></i>
                                        )}
                                        <span
                                          className={`text-[11px] truncate ${
                                            isActive
                                              ? 'text-praetor font-bold'
                                              : 'text-slate-600 font-semibold'
                                          }`}
                                        >
                                          {view.name}
                                        </span>
                                      </button>
                                      <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                        <ViewActionButton
                                          icon="fa-pen"
                                          title={t('table.renameView')}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setModalState({ kind: 'edit', view });
                                            setViewsSubmenuOpen(false);
                                          }}
                                        />
                                        <ViewActionButton
                                          icon={isCopied ? 'fa-check' : 'fa-copy'}
                                          title={
                                            isCopied ? t('table.viewCopied') : t('table.exportView')
                                          }
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            exportView(view);
                                          }}
                                          className={`hover:bg-slate-200 ${isCopied ? 'text-praetor' : 'text-slate-500'}`}
                                        />
                                        <ViewActionButton
                                          icon="fa-trash"
                                          title={t('table.deleteView')}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            deleteView(view.id);
                                          }}
                                          className="hover:bg-red-100 hover:text-red-600 text-slate-500"
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <div className="p-2 border-t border-slate-100 space-y-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setModalState({ kind: 'create' });
                                  setViewsSubmenuOpen(false);
                                }}
                                className="w-full px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:text-white bg-slate-50 hover:bg-praetor rounded-lg transition-all flex items-center justify-center gap-1.5"
                              >
                                <i className="fa-solid fa-plus text-[10px]"></i>
                                <span>{t('table.addCustomView')}</span>
                              </button>
                              {typeof navigator !== 'undefined' &&
                                !!navigator.clipboard?.readText && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void importView();
                                    }}
                                    className="w-full px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                                  >
                                    <i className="fa-solid fa-file-import text-[10px]"></i>
                                    <span>{t('table.importView')}</span>
                                  </button>
                                )}
                              {viewError && (
                                <div
                                  role="alert"
                                  className="text-[10px] text-red-500 text-center px-1 pt-1"
                                >
                                  {viewError}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {headerExtras}
            {headerAction}
          </div>
        ) : null}
      </div>

      <div
        className={`${tableContainerClassName ?? 'overflow-x-auto custom-horizontal-scrollbar'} ${resizingColId ? 'select-none' : ''}`}
      >
        {columns && data ? (
          <table className="w-full text-left border-separate border-spacing-0">
            {(paginatedData.length > 0 ||
              Object.keys(filterState).length > 0 ||
              sortState !== null) && (
              <thead className="bg-slate-50">
                <tr>
                  {visibleColumns.map((col, colIdx) => {
                    const colId = getColId(col);
                    const isFiltered = filterState[colId] && filterState[colId].length > 0;
                    const isSorted = sortState?.colId === colId;
                    const isFirstColumn = colIdx === 0;
                    const isLastColumn = colIdx === visibleColumns.length - 1;
                    // Force alignment: first column left, last column right, otherwise use col.align
                    const effectiveAlign = isFirstColumn
                      ? 'left'
                      : isLastColumn
                        ? 'right'
                        : col.align;
                    const colWidth = columnWidths[colId];

                    return (
                      <th
                        key={colId}
                        style={
                          colWidth
                            ? { width: colWidth, minWidth: colWidth }
                            : col.sticky === 'right'
                              ? { minWidth: '40px', width: 'auto' }
                              : undefined
                        }
                        className={`relative group ${isLastColumn ? 'pl-3 pr-2' : 'px-3'} py-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap border-b border-slate-100 ${isLastColumn && col.sticky !== 'right' ? 'w-full' : col.sticky === 'right' ? 'w-auto' : 'w-px'} ${effectiveAlign === 'right' ? 'text-right' : effectiveAlign === 'center' ? 'text-center' : ''} ${!isLastColumn ? 'border-r border-slate-100' : ''} ${col.sticky === 'right' ? 'sticky right-0 bg-slate-50 border-l border-slate-200 z-20 shadow-[-4px_0_6px_-1px_rgba(0,0,0,0.05)]' : ''} ${col.headerClassName || ''}`}
                      >
                        {/* Inline wrapper for button beside text */}
                        <span className="inline-flex items-center gap-1">
                          <span>{col.header}</span>

                          {/* Filter button - inline with header text */}
                          {!col.disableFiltering && (
                            <button
                              type="button"
                              ref={activeFilterCol === colId ? filterRef : undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (activeFilterCol === colId) {
                                  setActiveFilterCol(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setFilterPos({
                                    top: rect.bottom + window.scrollY + 4,
                                    left: rect.left + window.scrollX,
                                  });
                                  setActiveFilterCol(colId);
                                }
                              }}
                              className={`p-1 rounded hover:bg-slate-200 transition-colors ${
                                isFiltered || isSorted || activeFilterCol === colId
                                  ? 'text-praetor'
                                  : 'text-slate-400'
                              }`}
                            >
                              <i className="fa-solid fa-filter"></i>
                            </button>
                          )}
                        </span>

                        {/* Column resize handle */}
                        <div
                          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 opacity-0 group-hover:opacity-100 hover:bg-praetor/30 ${resizingColId === colId ? 'opacity-100 bg-praetor/50' : ''}`}
                          onMouseDown={(e) => handleResizeStart(e, colId)}
                        />

                        {/* Portal for filter popup - outside the wrapper */}
                        {activeFilterCol === colId &&
                          filterPos &&
                          createPortal(
                            <div
                              ref={popupRef}
                              style={{
                                top: filterPos.top,
                                left: filterPos.left,
                                position: 'absolute',
                                zIndex: 9999,
                              }}
                            >
                              <TableFilter
                                title={col.header}
                                options={getFilterOptions(colId)}
                                selectedValues={filterState[colId] || []}
                                onFilterChange={(selected) => handleFilter(colId, selected)}
                                sortDirection={sortState?.colId === colId ? sortState.px : null}
                                onSortChange={(dir) => handleSort(colId, dir)}
                                onClose={() => setActiveFilterCol(null)}
                              />
                            </div>,
                            document.body,
                          )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
            )}
            <tbody>
              {paginatedData.length > 0 ? (
                paginatedData.map((row, idx) => {
                  const isLastRow = idx === paginatedData.length - 1;
                  return (
                    <tr
                      key={idx}
                      onClick={() => !disabledRow?.(row) && onRowClick?.(row)}
                      className={`group transition-colors ${fontSizeClass} ${disabledRow?.(row) ? 'bg-slate-300 text-slate-500' : `${onRowClick ? 'cursor-pointer' : ''} ${rowClassName ? rowClassName(row) : 'hover:bg-slate-50/50'}`}`}
                    >
                      {visibleColumns.map((col, colIdx) => {
                        const colId = getColId(col);
                        const val = getValue(row, col);
                        const isFirstColumn = colIdx === 0;
                        const isLastColumn = colIdx === visibleColumns.length - 1;
                        // Force alignment: first column left, last column right, otherwise use col.align
                        const effectiveAlign = isFirstColumn
                          ? 'left'
                          : isLastColumn
                            ? 'right'
                            : col.align;
                        const colWidth = columnWidths[colId];
                        return (
                          <td
                            key={colId}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              col.onCellDoubleClick?.(row);
                            }}
                            style={
                              colWidth
                                ? { width: colWidth, minWidth: colWidth }
                                : col.sticky === 'right'
                                  ? { minWidth: '40px' }
                                  : undefined
                            }
                            className={`${isLastColumn ? 'pl-3 pr-2' : 'px-3'} py-px whitespace-nowrap ${isLastColumn && col.sticky !== 'right' ? 'w-full' : col.sticky === 'right' ? 'w-auto text-right' : `w-px align-middle ${effectiveAlign === 'right' ? 'text-right' : effectiveAlign === 'center' ? 'text-center' : ''}`} ${!isLastColumn ? 'border-r border-slate-100' : ''} ${!isLastRow ? 'border-b border-slate-100' : ''} ${col.sticky === 'right' ? 'sticky right-0 bg-white group-hover:bg-slate-50 transition-all duration-500 border-l border-slate-200 z-20 shadow-[-4px_0_6px_-1px_rgba(0,0,0,0.05)]' : ''} ${col.className || ''}`}
                          >
                            {col.sticky === 'right' ? (
                              <div className="flex justify-end items-center w-full h-full">
                                {col.cell
                                  ? col.cell({ getValue: () => val, row, value: val })
                                  : (val as ReactNode)}
                              </div>
                            ) : col.cell ? (
                              col.cell({ getValue: () => val, row, value: val })
                            ) : (
                              (val as ReactNode)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={Math.max(visibleColumns.length, 1)}
                    className="p-12 text-center text-slate-400 text-sm font-bold"
                  >
                    {emptyState ?? t('table.noResults')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          children
        )}
      </div>

      {(externalFooter || (data && columns)) && (
        <div
          className={`px-3 py-2 bg-slate-50 border-t border-slate-200 rounded-b-3xl ${
            footerClassName ?? 'flex justify-between items-center flex-wrap gap-4'
          }`}
        >
          {data && columns ? renderInternalFooter() : externalFooter}
        </div>
      )}

      {data && columns && (
        <CustomViewModal
          isOpen={modalState !== null}
          onClose={() => setModalState(null)}
          onSave={saveView}
          columns={gearColumns.map((col) => ({ id: getColId(col), header: col.header }))}
          initialHiddenColIds={hiddenColIds}
          editingView={modalState?.kind === 'edit' ? modalState.view : undefined}
        />
      )}
    </div>
  );
};

export default StandardTable;
