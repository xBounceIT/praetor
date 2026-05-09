import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type SortingState,
  type Column as TanStackColumn,
  type Updater,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  Children,
  isValidElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { readTextFromClipboard, writeTextToClipboard } from '../../utils/clipboard';
import { downloadCsv } from '../../utils/csv';
import { getLocalDateString } from '../../utils/date';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import CustomViewModal from './CustomViewModal';
import {
  type CustomView,
  computeViewApplication,
  type FilterState,
  filterStatesEqual,
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
import Modal from './Modal';
import Tooltip from './Tooltip';

const STORAGE_SUFFIX = {
  rows: 'rows',
  fontSize: 'fontsize',
  colWidths: 'colwidths',
  customViews: 'customviews',
  activeView: 'activeview',
} as const;
type StorageSuffix = (typeof STORAGE_SUFFIX)[keyof typeof STORAGE_SUFFIX];

const slugify = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

const getStorageKey = (t: string, suffix: StorageSuffix) => `praetor_table_${suffix}_${slugify(t)}`;

const FONT_SIZES = ['xs', 'sm', 'base'] as const;
type FontSize = (typeof FONT_SIZES)[number];

const VIEW_ERROR_DURATION_MS = 3000;
const COPIED_FEEDBACK_DURATION_MS = 1500;
const DEFAULT_MIN_COL_WIDTH = 40;
const HEADER_RESIZE_EXTRA_WIDTH = 64;
type ViewModalState = { kind: 'create' } | { kind: 'edit'; view: CustomView } | null;

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
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const resizeMinWidthRef = useRef(DEFAULT_MIN_COL_WIDTH);

  const [sortState, setSortState] = useState<SortState>(null);
  const [filterState, setFilterState] = useState<FilterState>(initialFilterState ?? {});
  const filterStateRef = useRef(filterState);
  filterStateRef.current = filterState;

  const [currentPage, setCurrentPage] = useState(1);
  const [gearOpen, setGearOpen] = useState(false);
  const [resizingColId, setResizingColId] = useState<string | null>(null);

  const [rowsPerPage, setRowsPerPage] = useState(() => {
    if (typeof window === 'undefined') return defaultRowsPerPage;
    const key = getStorageKey(title, STORAGE_SUFFIX.rows);
    const saved = localStorage.getItem(key);
    if (saved) {
      const val = Number(saved);
      if ([5, 10, 20, 50].includes(val)) {
        return val;
      }
    }
    return defaultRowsPerPage;
  });

  const [fontSize, setFontSize] = useState<FontSize>(() => {
    if (typeof window === 'undefined') return 'sm';
    const saved = localStorage.getItem(getStorageKey(title, STORAGE_SUFFIX.fontSize));
    if (saved && (FONT_SIZES as readonly string[]).includes(saved)) return saved as FontSize;
    return 'sm';
  });

  // Session-only: column visibility resets on page reload
  const [hiddenColIds, setHiddenColIds] = useState<Set<string>>(new Set<string>());

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    const saved = localStorage.getItem(getStorageKey(title, STORAGE_SUFFIX.colWidths));
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
    return parseStoredViews(localStorage.getItem(getStorageKey(title, STORAGE_SUFFIX.customViews)));
  });
  const [activeViewId, setActiveViewId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(getStorageKey(title, STORAGE_SUFFIX.activeView));
  });
  const [viewsSubmenuOpen, setViewsSubmenuOpen] = useState(false);
  const [modalState, setModalState] = useState<ViewModalState>(null);
  const [draggingViewId, setDraggingViewId] = useState<string | null>(null);
  const [dragOverViewId, setDragOverViewId] = useState<string | null>(null);
  const [copiedViewId, setCopiedViewId] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [filterSearchByColumnId, setFilterSearchByColumnId] = useState<Record<string, string>>({});
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewsAppliedOnceRef = useRef(false);

  const storageKey = useMemo(() => getStorageKey(title, STORAGE_SUFFIX.rows), [title]);

  const updateCustomViews = useCallback(
    (updater: (prev: CustomView[]) => CustomView[]) => {
      setCustomViews((prev) => {
        const next = updater(prev);
        if (next !== prev && typeof window !== 'undefined') {
          try {
            localStorage.setItem(
              getStorageKey(title, STORAGE_SUFFIX.customViews),
              JSON.stringify(next),
            );
          } catch {}
        }
        return next;
      });
    },
    [title],
  );

  const updateActiveViewId = useCallback(
    (id: string | null) => {
      setActiveViewId(id);
      if (typeof window === 'undefined') return;
      const key = getStorageKey(title, STORAGE_SUFFIX.activeView);
      try {
        if (id) localStorage.setItem(key, id);
        else localStorage.removeItem(key);
      } catch {}
    },
    [title],
  );

  useEffect(() => {
    const next = initialFilterState ?? {};
    if (filterStatesEqual(filterStateRef.current, next)) return;
    setFilterState(next);
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

  // Rightmost non-sticky column absorbs leftover width. When the last column is
  // sticky-right, this prevents that sticky column from expanding to fill space.
  const stretchColumnIdx = useMemo(() => {
    for (let i = visibleColumns.length - 1; i >= 0; i--) {
      if (visibleColumns[i].sticky !== 'right') return i;
    }
    return -1;
  }, [visibleColumns]);
  const usesFixedTableLayout = resizingColId !== null || Object.keys(columnWidths).length > 0;

  // Excludes statically hidden filter-only columns; sort/filter still target them via colsById.
  const gearColumns = useMemo(() => columns?.filter((col) => !col.hidden) ?? [], [columns]);

  const modalColumns = useMemo(
    () => gearColumns.map((col) => ({ id: getColId(col), header: col.header })),
    [gearColumns, getColId],
  );

  const activeView = useMemo(
    () => (activeViewId ? (customViews.find((v) => v.id === activeViewId) ?? null) : null),
    [activeViewId, customViews],
  );

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
  }, [gearColumns, activeViewId, customViews, applyViewState, updateActiveViewId]);

  useEffect(() => {
    if (!gearOpen) setViewsSubmenuOpen(false);
  }, [gearOpen]);

  useEffect(
    () => () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      if (viewErrorTimeoutRef.current) clearTimeout(viewErrorTimeoutRef.current);
    },
    [],
  );

  const showViewError = (msg: string) => {
    setViewError(msg);
    if (viewErrorTimeoutRef.current) clearTimeout(viewErrorTimeoutRef.current);
    viewErrorTimeoutRef.current = setTimeout(() => setViewError(null), VIEW_ERROR_DURATION_MS);
  };

  const fontSizeClass = fontSize === 'xs' ? 'text-xs' : fontSize === 'sm' ? 'text-sm' : 'text-base';

  useEffect(() => {
    if (!resizingColId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartXRef.current;
      const newWidth = Math.max(resizeMinWidthRef.current, resizeStartWidthRef.current + delta);
      setColumnWidths((prev) => {
        if (prev[resizingColId] === newWidth) return prev;
        return { ...prev, [resizingColId]: newWidth };
      });
    };

    const handleMouseUp = () => {
      setResizingColId(null);
      document.body.style.cursor = '';
      setColumnWidths((prev) => {
        localStorage.setItem(getStorageKey(title, STORAGE_SUFFIX.colWidths), JSON.stringify(prev));
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

  const getValue = useCallback((row: T, col: Column<T>) => {
    if (col.accessorFn) return col.accessorFn(row);
    if (col.accessorKey) return row[col.accessorKey];
    return null;
  }, []);

  // Empty raw values collapse to a single sentinel so the filter list shows
  // one "N/A" entry instead of "", "null", "undefined" duplicates.
  const formatForFilter = useCallback(
    (rawVal: T[keyof T] | string | number | boolean | null | undefined, col: Column<T>): string => {
      if (rawVal === null || rawVal === undefined || rawVal === '') return '';
      return col.filterFormat ? col.filterFormat(rawVal) : String(rawVal);
    },
    [],
  );

  const colsById = useMemo(() => {
    const m = new Map<string, Column<T>>();
    for (const col of columns ?? []) {
      m.set(getColId(col), col);
    }
    return m;
  }, [columns, getColId]);

  const tanStackColumns = useMemo<ColumnDef<T, unknown>[]>(
    () =>
      (columns ?? []).map((col) => {
        const colId = getColId(col);
        return {
          id: colId,
          accessorFn: (row) => getValue(row, col),
          header: col.header,
          cell: (info) => {
            const row = info.row.original;
            const value = info.getValue() as
              | T[keyof T]
              | string
              | number
              | boolean
              | null
              | undefined;
            return col.cell
              ? col.cell({ getValue: () => value, row, value })
              : (value as ReactNode);
          },
          enableSorting: !col.disableSorting,
          enableColumnFilter: !col.disableFiltering,
          enableHiding: !col.hidden,
          sortingFn: (rowA, rowB) => {
            const valA = rowA.getValue(colId);
            const valB = rowB.getValue(colId);
            if (typeof valA === 'number' && typeof valB === 'number') {
              return valA - valB;
            }
            const strA = String(valA || '').toLowerCase();
            const strB = String(valB || '').toLowerCase();
            if (strA < strB) return -1;
            if (strA > strB) return 1;
            return 0;
          },
          filterFn: (row, columnId, selectedValues) => {
            const selected =
              typeof selectedValues === 'string'
                ? [selectedValues]
                : Array.isArray(selectedValues)
                  ? selectedValues
                  : [];
            if (selected.length === 0) return true;
            const formatted = formatForFilter(row.getValue(columnId), col);
            return selected.some((value) => formatted.toLowerCase().includes(value.toLowerCase()));
          },
        } satisfies ColumnDef<T, unknown>;
      }),
    [columns, getColId, getValue, formatForFilter],
  );

  const sorting = useMemo<SortingState>(
    () => (sortState ? [{ id: sortState.colId, desc: sortState.px === 'desc' }] : []),
    [sortState],
  );

  const columnFilters = useMemo<ColumnFiltersState>(
    () => Object.entries(filterState).map(([id, value]) => ({ id, value })),
    [filterState],
  );

  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: currentPage - 1, pageSize: rowsPerPage }),
    [currentPage, rowsPerPage],
  );

  const columnVisibility = useMemo(
    () =>
      Object.fromEntries(
        (columns ?? []).map((col) => {
          const colId = getColId(col);
          return [colId, !col.hidden && !hiddenColIds.has(colId)];
        }),
      ) as VisibilityState,
    [columns, getColId, hiddenColIds],
  );

  const onSortingChange = useCallback(
    (updater: Updater<SortingState>) => {
      const next = functionalUpdate(updater, sorting);
      const firstSort = next[0];
      setSortState(firstSort ? { colId: firstSort.id, px: firstSort.desc ? 'desc' : 'asc' } : null);
      updateActiveViewId(null);
    },
    [sorting, updateActiveViewId],
  );

  const onColumnFiltersChange = useCallback(
    (updater: Updater<ColumnFiltersState>) => {
      const next = functionalUpdate(updater, columnFilters);
      const nextFilterState: FilterState = {};
      for (const filter of next) {
        if (Array.isArray(filter.value)) {
          if (filter.value.length > 0) nextFilterState[filter.id] = filter.value;
        } else if (typeof filter.value === 'string' && filter.value.trim().length > 0) {
          nextFilterState[filter.id] = [filter.value];
        }
      }
      setFilterState(nextFilterState);
      setCurrentPage(1);
      updateActiveViewId(null);
    },
    [columnFilters, updateActiveViewId],
  );

  const onPaginationChange = useCallback(
    (updater: Updater<PaginationState>) => {
      const next = functionalUpdate(updater, pagination);
      setCurrentPage(next.pageIndex + 1);
      if (next.pageSize !== rowsPerPage) {
        setRowsPerPage(next.pageSize);
        if (storageKey) {
          localStorage.setItem(storageKey, String(next.pageSize));
        }
      }
    },
    [pagination, rowsPerPage, storageKey],
  );

  const onColumnVisibilityChange = useCallback(
    (updater: Updater<VisibilityState>) => {
      const next = functionalUpdate(updater, columnVisibility);
      const nextHiddenColIds = new Set<string>();
      for (const col of gearColumns) {
        const colId = getColId(col);
        if (next[colId] === false) nextHiddenColIds.add(colId);
      }

      setHiddenColIds(nextHiddenColIds);
      if (sortState && nextHiddenColIds.has(sortState.colId)) setSortState(null);
      setFilterState((prev) => {
        let changed = false;
        const nextFilters = { ...prev };
        for (const colId of nextHiddenColIds) {
          if (nextFilters[colId]) {
            delete nextFilters[colId];
            changed = true;
          }
        }
        return changed ? nextFilters : prev;
      });
      updateActiveViewId(null);
    },
    [columnVisibility, gearColumns, getColId, sortState, updateActiveViewId],
  );

  const table = useReactTable({
    data: data ?? [],
    columns: tanStackColumns,
    onSortingChange,
    onColumnFiltersChange,
    onPaginationChange,
    onColumnVisibilityChange,
    state: {
      sorting,
      columnFilters,
      pagination,
      columnVisibility,
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const processedRows = data ? table.getPrePaginationRowModel().rows : [];
  const totalItems = data ? processedRows.length : externalTotalCount || 0;
  const totalPages = data ? table.getPageCount() : Math.ceil(totalItems / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedRows = data ? table.getRowModel().rows : [];

  useEffect(() => {
    if (totalPages === 0) {
      if (currentPage !== 1) setCurrentPage(1);
      return;
    }
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  // Pre-computed once per data/columns change so each filter popup open is O(1)
  // instead of re-scanning the full dataset on every header re-render.
  const filterOptionsByCol = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!data || !columns) return m;
    for (const col of columns) {
      if (col.disableFiltering) continue;
      const values = new Set<string>();
      for (const row of data) {
        values.add(formatForFilter(getValue(row, col), col));
      }
      m.set(getColId(col), Array.from(values).sort());
    }
    return m;
  }, [data, columns, getValue, formatForFilter, getColId]);

  const getFilterOptions = (colId: string) => filterOptionsByCol.get(colId) ?? [];

  const getSelectedFilterValues = (column: TanStackColumn<T, unknown>) => {
    const filterValue = column.getFilterValue();
    if (Array.isArray(filterValue)) return filterValue as string[];
    if (typeof filterValue === 'string') return [filterValue];
    return [];
  };

  const isRowActionColumn = (col: Column<T>) =>
    col.sticky === 'right' && col.accessorKey == null && col.accessorFn == null;

  const getElementLike = (node: ReactNode) => {
    if (isValidElement(node))
      return { type: node.type, props: node.props as Record<string, unknown> };
    if (typeof node === 'object' && node !== null && 'props' in node) {
      return node as { type?: unknown; props: Record<string, unknown> };
    }
    return null;
  };

  const getNodeText = (node: ReactNode): string => {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(getNodeText).join(' ').trim();
    const element = getElementLike(node);
    if (element) return getNodeText(element.props.children as ReactNode);
    return '';
  };

  const collectClassNames = (node: ReactNode): string => {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (Array.isArray(node)) return node.map(collectClassNames).join(' ');
    const element = getElementLike(node);
    if (!element) return '';
    const props = element.props as { className?: unknown; children?: ReactNode };
    return [
      typeof props.className === 'string' ? props.className : '',
      collectClassNames(props.children),
    ]
      .filter(Boolean)
      .join(' ');
  };

  const getActionIconClassName = (node: ReactNode) => {
    const classNames = collectClassNames(node);
    if (classNames.includes('fa-trash')) return 'text-destructive';
    if (classNames.includes('fa-ban')) return 'text-amber-600';
    if (classNames.includes('fa-rotate-left')) return 'text-primary';
    if (classNames.includes('fa-pen')) return 'text-blue-500';
    return 'text-muted-foreground';
  };

  const renderActionMenuButton = (node: ReactNode, label: ReactNode, key: number) => {
    const labelText = getNodeText(label);
    const element = getElementLike(node);
    const isButtonElement =
      element &&
      ((typeof element.type === 'string' && element.type === 'button') ||
        element.props.type === 'button' ||
        typeof element.props.onClick === 'function');
    if (!isButtonElement) {
      return (
        <div key={key} className="flex min-h-7 items-center gap-2 px-2 py-1 text-xs">
          {node}
          {labelText && <span className="truncate">{labelText}</span>}
        </div>
      );
    }

    const props = element.props as React.ButtonHTMLAttributes<HTMLButtonElement> & {
      children?: ReactNode;
      'data-testid'?: string;
    };
    const explicitLabel = props['aria-label'] ?? props.title;
    const testId = props['data-testid'];
    const text =
      labelText ||
      (typeof explicitLabel === 'string' ? explicitLabel : getNodeText(explicitLabel)) ||
      getNodeText(props.children);

    return (
      <button
        key={key}
        type="button"
        aria-label={typeof explicitLabel === 'string' ? explicitLabel : undefined}
        data-testid={testId}
        disabled={props.disabled}
        className="flex h-7 w-full items-center justify-start gap-2 rounded-sm px-2 text-xs font-medium text-popover-foreground outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
        onClick={(event) => {
          event.stopPropagation();
          props.onClick?.(event);
        }}
      >
        <span className={`w-3.5 shrink-0 text-center ${getActionIconClassName(props.children)}`}>
          {props.children}
        </span>
        {text && <span className="truncate">{text}</span>}
      </button>
    );
  };

  const renderActionMenuItems = (node: ReactNode) => {
    const items: ReactNode[] = [];
    const visit = (current: ReactNode) => {
      if (current === null || current === undefined || typeof current === 'boolean') return;
      if (typeof current === 'string' || typeof current === 'number') return;
      if (Array.isArray(current)) {
        current.forEach(visit);
        return;
      }
      const element = getElementLike(current);
      if (!element) return;

      const props = element.props as {
        children?: ReactNode | (() => ReactNode);
        label?: ReactNode;
      };

      if (props.label !== undefined && typeof props.children === 'function') {
        items.push(renderActionMenuButton(props.children(), props.label, items.length));
        return;
      }

      if (
        (typeof element.type === 'string' && element.type === 'button') ||
        (props as { type?: unknown }).type === 'button' ||
        typeof (props as { onClick?: unknown }).onClick === 'function'
      ) {
        items.push(renderActionMenuButton(current, undefined, items.length));
        return;
      }

      Children.toArray(props.children as ReactNode).forEach(visit);
    };

    visit(node);
    return items.length > 0 ? items : node;
  };

  const stepFontSize = (delta: -1 | 1) => {
    setFontSize((prev) => {
      const idx = FONT_SIZES.indexOf(prev);
      const targetIdx = idx + delta;
      if (targetIdx < 0 || targetIdx >= FONT_SIZES.length) return prev;
      const next = FONT_SIZES[targetIdx];
      localStorage.setItem(getStorageKey(title, STORAGE_SUFFIX.fontSize), next);
      return next;
    });
  };

  // Exports the currently visible columns and the post-filter/sort rows so the
  // CSV mirrors what the user sees (active view, manual filters, hidden cols).
  // Skips columns without an accessor (Actions, etc.) - they render UI from
  // `cell` and have no scalar value to serialize.
  const handleExportToCsv = () => {
    const exportColumns = visibleColumns.filter(
      (c) => c.accessorKey != null || c.accessorFn != null,
    );
    const rows = [
      exportColumns.map((c) => c.header),
      ...processedRows.map((row) =>
        exportColumns.map((col) => formatForFilter(getValue(row.original, col), col)),
      ),
    ];
    downloadCsv(rows, `${slugify(title)}_${getLocalDateString()}.csv`);
  };

  const resetColumnVisibility = () => {
    table.setColumnVisibility({});
  };

  const applyView = (view: CustomView) => {
    setViewsSubmenuOpen(false);
    setGearOpen(false);
    if (view.id === activeViewId) return;
    applyViewState(view);
    updateActiveViewId(view.id);
    setCurrentPage(1);
  };

  const saveView = ({ name, hiddenColIds: hidden }: { name: string; hiddenColIds: string[] }) => {
    if (modalState?.kind === 'edit') {
      const editingId = modalState.view.id;
      updateCustomViews((prev) =>
        prev.map((v) =>
          v.id === editingId ? { ...v, name, hiddenColIds: hidden, sortState, filterState } : v,
        ),
      );
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
      updateCustomViews((prev) => [...prev, newView]);
      updateActiveViewId(newView.id);
      setHiddenColIds(new Set(hidden));
    }
    setModalState(null);
  };

  const deleteView = (id: string) => {
    updateCustomViews((prev) => prev.filter((v) => v.id !== id));
    if (activeViewId === id) updateActiveViewId(null);
  };

  const moveViewByDelta = (id: string, delta: number) => {
    updateCustomViews((prev) =>
      moveByDelta(
        prev,
        prev.findIndex((v) => v.id === id),
        delta,
      ),
    );
  };

  const reorderViews = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    updateCustomViews((prev) => {
      const fromIdx = prev.findIndex((v) => v.id === fromId);
      const toIdx = prev.findIndex((v) => v.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      return reorderDropAbove(prev, fromIdx, toIdx);
    });
  };

  const exportView = async (view: CustomView) => {
    const payload = {
      name: view.name,
      hiddenColIds: view.hiddenColIds,
      sortState: view.sortState,
      filterState: view.filterState,
    };
    const ok = await writeTextToClipboard(JSON.stringify(payload));
    if (!ok) {
      showViewError(t('table.viewCopyFailed'));
      return;
    }
    setCopiedViewId(view.id);
    if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = setTimeout(() => setCopiedViewId(null), COPIED_FEEDBACK_DURATION_MS);
  };

  // Returns null on success, an i18n key on failure so callers can decide
  // whether to show the message inline (paste modal) or in the submenu.
  const importViewFromText = (text: string): string | null => {
    if (text.length > IMPORT_PAYLOAD_MAX_BYTES) return 'table.viewImportTooLarge';
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return 'table.viewImportFailed';
    }
    if (!isValidImportedView(parsed)) return 'table.viewImportFailed';
    const newView: CustomView = {
      id: generateViewId(),
      name: parsed.name,
      hiddenColIds: parsed.hiddenColIds,
      sortState: parseSortState(parsed.sortState),
      filterState: parseFilterState(parsed.filterState),
    };
    updateCustomViews((prev) => [...prev, newView]);
    return null;
  };

  const importView = async () => {
    const result = await readTextFromClipboard();
    if (!result.ok) {
      // Permission denied is recoverable by manual paste; unavailable
      // (non-secure context, no API) is also handled by the paste modal.
      setPasteText('');
      setPasteError(null);
      setPasteModalOpen(true);
      setViewsSubmenuOpen(false);
      return;
    }
    const errKey = importViewFromText(result.text);
    if (errKey) showViewError(t(errKey));
    else setViewError(null);
  };

  const submitPasteImport = () => {
    const trimmed = pasteText.trim();
    if (!trimmed) {
      setPasteError(t('table.viewImportFailed'));
      return;
    }
    const errKey = importViewFromText(trimmed);
    if (errKey) {
      setPasteError(t(errKey));
      return;
    }
    setPasteModalOpen(false);
    setPasteText('');
    setPasteError(null);
  };

  const closePasteModal = () => {
    setPasteModalOpen(false);
    setPasteText('');
    setPasteError(null);
  };

  const handleResizeStart = (e: React.MouseEvent<HTMLDivElement>, colId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.parentElement as HTMLTableCellElement;
    const headerLabel = th.querySelector<HTMLElement>('[data-column-header-label]');
    const headerTextWidth = Math.max(
      headerLabel?.scrollWidth ?? 0,
      headerLabel?.getBoundingClientRect().width ?? 0,
    );
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = th.getBoundingClientRect().width;
    resizeMinWidthRef.current = Math.max(
      DEFAULT_MIN_COL_WIDTH,
      Math.ceil(headerTextWidth + HEADER_RESIZE_EXTRA_WIDTH),
    );
    setResizingColId(colId);
  };

  const renderToolbarButton = ({
    tooltipKey,
    iconClass,
    onClick,
    disabled = false,
    active = false,
    buttonRef,
    tooltipDisabled = false,
    text,
  }: {
    tooltipKey: string;
    iconClass: string;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
    buttonRef?: Ref<HTMLButtonElement>;
    tooltipDisabled?: boolean;
    text?: string;
  }) => {
    const label = t(tooltipKey);
    return (
      <Tooltip label={label} position="bottom" disabled={tooltipDisabled}>
        {() => (
          <Button
            type="button"
            ref={buttonRef}
            aria-label={label}
            variant={active ? 'secondary' : 'outline'}
            size={text ? 'sm' : 'icon-sm'}
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            disabled={disabled}
          >
            <i className={`fa-solid ${iconClass} text-xs`} aria-hidden="true"></i>
            {text && <span>{text}</span>}
          </Button>
        )}
      </Tooltip>
    );
  };

  const renderHeaderFilter = (column: TanStackColumn<T, unknown>, sourceColumn: Column<T>) => {
    if (!column.getCanFilter()) return null;
    const selectedValues = getSelectedFilterValues(column);
    const hasFilter = selectedValues.length > 0;
    const options = getFilterOptions(column.id);
    const filterSearch = filterSearchByColumnId[column.id] ?? '';
    const normalizedFilterSearch = filterSearch.trim().toLocaleLowerCase();
    const visibleOptions = normalizedFilterSearch
      ? options.filter((option) =>
          (option || t('table.empty')).toLocaleLowerCase().includes(normalizedFilterSearch),
        )
      : options;

    return (
      <DropdownMenu
        onOpenChange={(open) => {
          if (open || !filterSearchByColumnId[column.id]) return;
          setFilterSearchByColumnId((prev) => {
            const next = { ...prev };
            delete next[column.id];
            return next;
          });
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={hasFilter ? 'secondary' : 'ghost'}
            size="icon-xs"
            aria-label={`${t('table.filters')} ${sourceColumn.header}`}
            onClick={(event) => event.stopPropagation()}
            className="size-6"
          >
            <i className="fa-solid fa-filter text-[10px]" aria-hidden="true"></i>
            {hasFilter && <span className="sr-only">{selectedValues.length}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-64"
          onClick={(event) => event.stopPropagation()}
        >
          <DropdownMenuLabel className="text-xs">{sourceColumn.header}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="p-1">
            <Input
              type="search"
              value={filterSearch}
              onChange={(event) => {
                const value = event.target.value;
                setFilterSearchByColumnId((prev) => ({ ...prev, [column.id]: value }));
              }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder={t('table.search')}
              aria-label={`${t('table.search')} ${sourceColumn.header}`}
              className="h-8 text-xs"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {visibleOptions.length > 0 ? (
              visibleOptions.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option || '__empty__'}
                  checked={selectedValues.includes(option)}
                  onSelect={(event) => {
                    event.preventDefault();
                    const next = selectedValues.includes(option)
                      ? selectedValues.filter((value) => value !== option)
                      : [...selectedValues, option];
                    column.setFilterValue(next.length > 0 ? next : undefined);
                    table.setPageIndex(0);
                  }}
                  className="text-xs"
                >
                  <span className="truncate">{option || t('table.empty')}</span>
                </DropdownMenuCheckboxItem>
              ))
            ) : (
              <DropdownMenuItem disabled className="text-xs">
                {t('table.noResults')}
              </DropdownMenuItem>
            )}
          </div>
          {hasFilter && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  column.setFilterValue(undefined);
                  table.setPageIndex(0);
                }}
                className="text-xs"
              >
                {t('table.clearFilter')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const renderInternalFooter = () => {
    const isSinglePage = Math.max(totalPages, 1) <= 1;
    const canPreviousPage = !isSinglePage && table.getCanPreviousPage();
    const canNextPage = !isSinglePage && table.getCanNextPage();

    return (
      <>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {t('pagination.showing')
              .replace('{{start}}', String(totalItems > 0 ? startIndex + 1 : 0))
              .replace('{{end}}', String(Math.min(startIndex + rowsPerPage, totalItems)))
              .replace('{{total}}', String(totalItems))}
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            {t('pagination.rowsPerPage')}
          </span>
          <Select
            value={rowsPerPage.toString()}
            onValueChange={(val) => {
              const newValue = Number(val);
              table.setPageIndex(0);
              table.setPageSize(newValue);
            }}
          >
            <SelectTrigger size="sm" className="h-8 w-[76px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[5, 10, 20, 50].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              table.previousPage();
            }}
            disabled={!canPreviousPage}
          >
            {t('buttons.previous')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {currentPage} / {Math.max(totalPages, 1)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              table.nextPage();
            }}
            disabled={!canNextPage}
          >
            {t('buttons.next')}
          </Button>
        </div>
      </>
    );
  };

  return (
    <div className={`w-full space-y-3 ${containerClassName ?? ''}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
          {typeof totalItems === 'number' && (
            <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {totalItems} {totalLabel || t('table.total')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {headerExtras}
          {headerAction}
          {data != null && columns != null && (
            <>
              {renderToolbarButton({
                tooltipKey: 'table.exportToCsv',
                iconClass: 'fa-file-export',
                onClick: handleExportToCsv,
                disabled: processedRows.length === 0,
                text: t('table.export'),
              })}
              {renderToolbarButton({
                tooltipKey: 'table.decreaseFont',
                iconClass: 'fa-minus',
                onClick: () => stepFontSize(-1),
                disabled: fontSize === 'xs',
              })}
              {renderToolbarButton({
                tooltipKey: 'table.increaseFont',
                iconClass: 'fa-plus',
                onClick: () => stepFontSize(1),
                disabled: fontSize === 'base',
              })}
              <DropdownMenu open={gearOpen} onOpenChange={setGearOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    aria-label={t('table.columnSettings')}
                    variant="outline"
                    size="sm"
                    className="data-[state=open]:border-border data-[state=open]:bg-accent data-[state=open]:text-accent-foreground focus-visible:ring-0"
                  >
                    {t('table.columns')}
                    <i className="fa-solid fa-chevron-down text-xs" aria-hidden="true"></i>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel
                    className="truncate text-xs"
                    title={activeView ? activeView.name : undefined}
                  >
                    {activeView ? `${t('table.columns')} · ${activeView.name}` : t('table.columns')}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <div className="max-h-64 overflow-y-auto">
                    {table
                      .getAllColumns()
                      .filter((column) => column.getCanHide() && colsById.has(column.id))
                      .map((column) => {
                        const sourceColumn = colsById.get(column.id);
                        const isVisible = column.getIsVisible();
                        const isLastVisible =
                          table
                            .getVisibleLeafColumns()
                            .filter((visibleColumn) => visibleColumn.getCanHide()).length === 1 &&
                          isVisible;
                        return (
                          <DropdownMenuCheckboxItem
                            key={column.id}
                            checked={isVisible}
                            disabled={isLastVisible}
                            onSelect={(event) => {
                              event.preventDefault();
                              if (!isLastVisible) column.toggleVisibility(!isVisible);
                            }}
                            className="text-xs"
                          >
                            <span className="truncate">{sourceColumn?.header ?? column.id}</span>
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      resetColumnVisibility();
                    }}
                    className="text-xs"
                  >
                    <i className="fa-solid fa-rotate-left text-[10px]" aria-hidden="true"></i>
                    <span>{t('table.resetColumns')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSub open={viewsSubmenuOpen} onOpenChange={setViewsSubmenuOpen}>
                    <DropdownMenuSubTrigger className="text-xs">
                      <i className="fa-solid fa-layer-group text-[10px]" aria-hidden="true"></i>
                      <span>{t('table.customViews')}</span>
                      {customViews.length > 0 && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {customViews.length}
                        </span>
                      )}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-72">
                      <DropdownMenuLabel className="text-xs">
                        {t('table.customViews')}
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {customViews.length > 0 && (
                        <div className="max-h-64 overflow-y-auto p-1">
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
                                className={`group flex items-center gap-1 rounded-sm border-t-2 px-1 py-1 text-sm outline-hidden transition-colors ${
                                  isActive
                                    ? 'bg-accent text-accent-foreground'
                                    : 'hover:bg-accent hover:text-accent-foreground'
                                } ${isDragOver ? 'border-primary' : 'border-transparent'} ${
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
                                  className="flex size-6 shrink-0 cursor-move items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
                                    setGearOpen(false);
                                  }}
                                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                  title={view.name}
                                >
                                  {isActive && (
                                    <i
                                      className="fa-solid fa-check shrink-0 text-[10px]"
                                      aria-hidden="true"
                                    ></i>
                                  )}
                                  <span className="truncate text-xs font-medium">{view.name}</span>
                                </button>
                                <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                                  <DropdownMenuItem
                                    aria-label={t('table.renameView')}
                                    onSelect={(e) => {
                                      e.preventDefault();
                                      setModalState({ kind: 'edit', view });
                                      setGearOpen(false);
                                    }}
                                    className="size-7 justify-center p-0"
                                  >
                                    <i
                                      className="fa-solid fa-pen text-[10px]"
                                      aria-hidden="true"
                                    ></i>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    aria-label={
                                      isCopied ? t('table.viewCopied') : t('table.exportView')
                                    }
                                    onSelect={(e) => {
                                      e.preventDefault();
                                      void exportView(view);
                                    }}
                                    className="size-7 justify-center p-0"
                                  >
                                    <i
                                      className={`fa-solid ${isCopied ? 'fa-check' : 'fa-copy'} text-[10px]`}
                                      aria-hidden="true"
                                    ></i>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    aria-label={t('table.deleteView')}
                                    variant="destructive"
                                    onSelect={(e) => {
                                      e.preventDefault();
                                      deleteView(view.id);
                                    }}
                                    className="size-7 justify-center p-0"
                                  >
                                    <i
                                      className="fa-solid fa-trash text-[10px]"
                                      aria-hidden="true"
                                    ></i>
                                  </DropdownMenuItem>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <DropdownMenuSeparator />
                      <div className="flex gap-1 p-1">
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setModalState({ kind: 'create' });
                            setGearOpen(false);
                          }}
                          className="flex-1 justify-center text-xs"
                        >
                          <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
                          <span>{t('buttons.add')}</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            void importView();
                          }}
                          className="flex-1 justify-center text-xs"
                        >
                          <i className="fa-solid fa-file-import text-[10px]" aria-hidden="true"></i>
                          <span>{t('buttons.import')}</span>
                        </DropdownMenuItem>
                      </div>
                      {viewError && (
                        <div
                          role="alert"
                          className="px-2 pb-2 text-center text-xs text-destructive"
                        >
                          {viewError}
                        </div>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      <div
        className={`rounded-md border border-border bg-card shadow-sm ${tableContainerClassName ?? 'overflow-x-auto'} ${resizingColId ? 'select-none' : ''}`}
      >
        {columns && data ? (
          <Table className={`w-full text-left ${usesFixedTableLayout ? 'table-fixed' : ''}`}>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="border-border hover:bg-transparent">
                  {headerGroup.headers.map((header, colIdx) => {
                    const col = colsById.get(header.column.id);
                    if (!col) return null;
                    const colId = getColId(col);
                    const isStickyRightColumn = col.sticky === 'right';
                    const isActionColumn = isRowActionColumn(col);
                    const isFirstColumn = colIdx === 0;
                    const isLastColumn = colIdx === headerGroup.headers.length - 1;
                    const isStretchColumn = colIdx === stretchColumnIdx;
                    // Force alignment: first column left, last column right, otherwise use col.align
                    const effectiveAlign = isFirstColumn
                      ? 'left'
                      : isLastColumn
                        ? 'right'
                        : col.align;
                    const colWidth = columnWidths[colId];
                    const sorted = header.column.getIsSorted();

                    return (
                      <TableHead
                        key={header.id}
                        style={
                          colWidth
                            ? { width: colWidth, minWidth: colWidth }
                            : isStickyRightColumn
                              ? { minWidth: '40px', width: 'auto' }
                              : undefined
                        }
                        aria-label={isActionColumn ? col.header : undefined}
                        className={`relative group h-10 border-border ${isLastColumn ? 'pl-3 pr-2' : 'px-3'} whitespace-nowrap ${usesFixedTableLayout ? '' : isStretchColumn ? 'w-full' : isStickyRightColumn ? 'w-auto' : 'w-px'} ${effectiveAlign === 'right' ? 'text-right' : effectiveAlign === 'center' ? 'text-center' : ''} ${isStickyRightColumn ? 'sticky right-0 z-20 border-l border-border bg-card' : ''} ${col.headerClassName || ''}`}
                      >
                        {!isActionColumn && (
                          <div
                            className={`flex items-center gap-1 ${effectiveAlign === 'right' ? 'justify-end' : effectiveAlign === 'center' ? 'justify-center' : 'justify-start'}`}
                          >
                            <button
                              type="button"
                              disabled={!header.column.getCanSort()}
                              onClick={header.column.getToggleSortingHandler()}
                              className="inline-flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-100"
                            >
                              <span className="truncate" data-column-header-label={colId}>
                                {header.isPlaceholder
                                  ? null
                                  : flexRender(header.column.columnDef.header, header.getContext())}
                              </span>
                              {header.column.getCanSort() && (
                                <i
                                  className={`fa-solid ${
                                    sorted === 'asc'
                                      ? 'fa-arrow-up'
                                      : sorted === 'desc'
                                        ? 'fa-arrow-down'
                                        : 'fa-arrow-up-arrow-down'
                                  } shrink-0 text-[10px] transition-colors`}
                                  aria-hidden="true"
                                ></i>
                              )}
                            </button>
                            {renderHeaderFilter(header.column, col)}
                          </div>
                        )}

                        {!isActionColumn && (
                          <div
                            className="absolute top-0 -right-1 z-10 flex h-full w-2 cursor-col-resize items-center justify-center"
                            data-column-resize-handle={colId}
                            onMouseDown={(e) => handleResizeStart(e, colId)}
                          >
                            <span
                              data-column-resize-line={colId}
                              className={`h-5 w-px rounded-full transition-colors ${
                                resizingColId === colId
                                  ? 'bg-primary'
                                  : 'bg-border group-hover:bg-primary/40'
                              }`}
                            />
                          </div>
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {paginatedRows.length > 0 ? (
                paginatedRows.map((tableRow) => {
                  const row = tableRow.original;
                  const visibleCells = tableRow.getVisibleCells();
                  return (
                    <TableRow
                      key={tableRow.id}
                      onClick={() => !disabledRow?.(row) && onRowClick?.(row)}
                      className={`group border-border transition-colors ${fontSizeClass} ${disabledRow?.(row) ? 'bg-muted text-muted-foreground opacity-70' : `${onRowClick ? 'cursor-pointer' : ''} ${rowClassName ? rowClassName(row) : 'hover:bg-muted/50'}`}`}
                    >
                      {visibleCells.map((cell, colIdx) => {
                        const colId = cell.column.id;
                        const col = colsById.get(colId);
                        if (!col) return null;
                        const isStickyRightColumn = col.sticky === 'right';
                        const isActionColumn = isRowActionColumn(col);
                        const isFirstColumn = colIdx === 0;
                        const isLastColumn = colIdx === visibleCells.length - 1;
                        const isStretchColumn = colIdx === stretchColumnIdx;
                        // Force alignment: first column left, last column right, otherwise use col.align
                        const effectiveAlign = isFirstColumn
                          ? 'left'
                          : isLastColumn
                            ? 'right'
                            : col.align;
                        const colWidth = columnWidths[colId];
                        const rawValue = cell.getValue() as
                          | T[keyof T]
                          | string
                          | number
                          | boolean
                          | null
                          | undefined;
                        const cellContent = flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        );
                        const actionCellContent =
                          isActionColumn && col.cell
                            ? col.cell({ getValue: () => rawValue, row, value: rawValue })
                            : cellContent;
                        return (
                          <TableCell
                            key={cell.id}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              col.onCellDoubleClick?.(row);
                            }}
                            style={
                              colWidth
                                ? { width: colWidth, minWidth: colWidth }
                                : isStickyRightColumn
                                  ? { minWidth: '40px' }
                                  : undefined
                            }
                            className={`${isLastColumn ? 'pl-3 pr-2' : 'px-3'} py-2 whitespace-nowrap ${usesFixedTableLayout && !isActionColumn ? 'max-w-0 overflow-hidden text-ellipsis' : ''} ${isStickyRightColumn ? 'w-auto text-right' : `${usesFixedTableLayout ? '' : isStretchColumn ? 'w-full' : 'w-px'} align-middle ${effectiveAlign === 'right' ? 'text-right' : effectiveAlign === 'center' ? 'text-center' : ''}`} ${isStickyRightColumn ? 'sticky right-0 z-20 border-l border-border bg-card transition-colors group-hover:bg-muted/50' : ''} ${col.className || ''}`}
                          >
                            {isActionColumn ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={t('table.rowActions')}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <i
                                      className="fa-solid fa-ellipsis text-[10px]"
                                      aria-hidden="true"
                                    ></i>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  className="w-36 p-1"
                                  onClick={(event) => event.stopPropagation()}
                                  onDoubleClick={(event) => event.stopPropagation()}
                                >
                                  <div className="flex flex-col gap-0.5">
                                    {renderActionMenuItems(actionCellContent)}
                                  </div>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : (
                              cellContent
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })
              ) : (
                <TableRow className="border-border">
                  <TableCell
                    colSpan={Math.max(visibleColumns.length, 1)}
                    className="p-12 text-center text-sm font-medium text-muted-foreground"
                  >
                    {emptyState ?? t('table.noResults')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        ) : (
          children
        )}
      </div>

      {(externalFooter || (data && columns)) && (
        <div
          className={`py-1 ${
            footerClassName ?? 'flex justify-between items-center flex-wrap gap-4'
          }`}
        >
          {data && columns ? renderInternalFooter() : externalFooter}
        </div>
      )}

      {data && columns && (
        <CustomViewModal
          key={
            modalState?.kind === 'edit'
              ? `edit-${modalState.view.id}`
              : modalState?.kind === 'create'
                ? 'create'
                : 'closed'
          }
          isOpen={modalState !== null}
          onClose={() => setModalState(null)}
          onSave={saveView}
          columns={modalColumns}
          initialHiddenColIds={hiddenColIds}
          editingView={modalState?.kind === 'edit' ? modalState.view : undefined}
        />
      )}

      {data && columns && pasteModalOpen && (
        <Modal isOpen={pasteModalOpen} onClose={closePasteModal}>
          <div className="w-full max-w-md rounded-md border border-border bg-card shadow-lg animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <i className="fa-solid fa-file-import text-primary"></i>
                {t('table.pasteViewTitle')}
              </h3>
              <button
                type="button"
                onClick={closePasteModal}
                className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-xs text-muted-foreground">{t('table.pasteViewDescription')}</p>
              <textarea
                value={pasteText}
                onChange={(e) => {
                  setPasteText(e.target.value);
                  if (pasteError) setPasteError(null);
                }}
                placeholder={t('table.pasteViewPlaceholder')}
                rows={6}
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              {pasteError && (
                <div role="alert" className="text-[11px] text-red-500">
                  {pasteError}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">
              <Button type="button" variant="ghost" size="sm" onClick={closePasteModal}>
                {t('table.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={submitPasteImport}
                disabled={pasteText.trim().length === 0}
              >
                {t('table.importView')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default StandardTable;
