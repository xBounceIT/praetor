import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnSizingState,
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
import { ArrowDown, ArrowUp, ArrowUpDown, ZoomIn, ZoomOut } from 'lucide-react';
import {
  Children,
  Fragment,
  isValidElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError } from '../../services/api/client';
import { type SavedViewAccess, type SavedViewDto, viewsApi } from '../../services/api/views';
import { readTextFromClipboard, writeTextToClipboard } from '../../utils/clipboard';
import { downloadCsv } from '../../utils/csv';
import { getLocalDateString } from '../../utils/date';
import { Button } from '../ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '../ui/context-menu';
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
import { Empty, EmptyHeader, EmptyTitle } from '../ui/empty';
import { Field, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Textarea } from '../ui/textarea';
import CustomViewModal from './CustomViewModal';
import {
  type CustomView,
  computeViewApplication,
  decodeLegacyFilterValue,
  type FilterState,
  filterStatesEqual,
  generateViewId,
  IMPORT_PAYLOAD_MAX_BYTES,
  isValidImportedView,
  type LegacyFilterColumnAlias,
  moveByDelta,
  parseFilterState,
  parseSortState,
  parseStoredViews,
  reorderDropAbove,
  type SortState,
} from './customViewHelpers';
import Modal from './Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from './ModalLayout';
import ShareViewModal from './ShareViewModal';
import { TABLE_CONTROL_BUTTON_CLASSNAME } from './tableControlStyles';
import ViewOwnerAvatar from './ViewOwnerAvatar';

const STORAGE_SUFFIX = {
  rows: 'rows',
  fontSize: 'fontsize',
  colWidths: 'colwidths',
  customViews: 'customviews',
  activeView: 'activeview',
} as const;
type StorageSuffix = (typeof STORAGE_SUFFIX)[keyof typeof STORAGE_SUFFIX];

// Keep in sync with the `h-11` Tailwind class on padding rows (1rem*2.75 = 44px).
// Reserved height of empty-state cell = minBodyRows × this constant.
const BODY_ROW_HEIGHT_PX = 44;

const getSelectedFilterValues = <TData,>(column: TanStackColumn<TData, unknown>) => {
  const filterValue = column.getFilterValue();
  if (Array.isArray(filterValue)) return filterValue as string[];
  if (typeof filterValue === 'string') return [filterValue];
  return [];
};

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

const findActionNode = (node: ReactNode): ReactNode | null => {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const actionNode = findActionNode(child);
      if (actionNode) return actionNode;
    }
    return null;
  }
  const element = getElementLike(node);
  if (!element) return null;
  if (
    (typeof element.type === 'string' && element.type === 'button') ||
    element.props.type === 'button' ||
    typeof element.props.onClick === 'function'
  ) {
    return node;
  }

  for (const child of Children.toArray(element.props.children as ReactNode)) {
    const actionNode = findActionNode(child);
    if (actionNode) return actionNode;
  }
  return null;
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

const hasActionMenuItems = (node: ReactNode): boolean => {
  const visit = (current: ReactNode): boolean => {
    if (current === null || current === undefined || typeof current === 'boolean') return false;
    if (typeof current === 'string' || typeof current === 'number') return false;
    if (Array.isArray(current)) return current.some(visit);

    const element = getElementLike(current);
    if (!element) return false;

    const props = element.props as {
      children?: ReactNode | (() => ReactNode);
      label?: ReactNode;
      onClick?: unknown;
      type?: unknown;
    };

    if (props.label !== undefined && typeof props.children === 'function') return true;

    if (
      (typeof element.type === 'string' && element.type === 'button') ||
      props.type === 'button' ||
      typeof props.onClick === 'function'
    ) {
      return true;
    }

    return Children.toArray(props.children as ReactNode).some(visit);
  };

  return visit(node);
};

interface HeaderFilterProps<T> {
  column: TanStackColumn<T, unknown>;
  sourceColumn: Column<T>;
  options: string[];
  filterSearch: string;
  t: (key: string) => string;
  onFilterSearchChange: (columnId: string, value: string) => void;
  onFilterSearchClose: (columnId: string) => void;
  onResetPage: () => void;
}

const HeaderFilter = <T,>({
  column,
  sourceColumn,
  options,
  filterSearch,
  t,
  onFilterSearchChange,
  onFilterSearchClose,
  onResetPage,
}: HeaderFilterProps<T>) => {
  if (!column.getCanFilter()) return null;
  const selectedValues = getSelectedFilterValues(column);
  const hasFilter = selectedValues.length > 0;
  const normalizedFilterSearch = filterSearch.trim().toLocaleLowerCase();
  const visibleOptions = normalizedFilterSearch
    ? options.filter((option) =>
        (option || t('table.empty')).toLocaleLowerCase().includes(normalizedFilterSearch),
      )
    : options;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open || !filterSearch) return;
        onFilterSearchClose(column.id);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={hasFilter ? 'secondary' : 'ghost'}
          size="icon-xs"
          aria-label={`${t('table.filters')} ${sourceColumn.header}`}
          onClick={(event) => event.stopPropagation()}
          className="size-6 rounded-lg"
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
            onChange={(event) => onFilterSearchChange(column.id, event.target.value)}
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
                  onResetPage();
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
                onResetPage();
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

const StandardTableToolbarButton = ({
  label,
  iconClass,
  icon,
  onClick,
  disabled = false,
  active = false,
  buttonRef,
  tooltipDisabled = false,
  text,
}: {
  label: string;
  iconClass?: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  tooltipDisabled?: boolean;
  text?: string;
}) => (
  <Tooltip disabled={tooltipDisabled}>
    <TooltipTrigger asChild>
      <span className="inline-flex">
        <Button
          type="button"
          ref={buttonRef}
          aria-label={label}
          variant={active ? 'secondary' : 'outline'}
          size="sm"
          className={TABLE_CONTROL_BUTTON_CLASSNAME}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          disabled={disabled}
        >
          {icon ?? <i className={`fa-solid ${iconClass} text-xs`} aria-hidden="true"></i>}
          {text && <span>{text}</span>}
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>
);

const slugify = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

const getStorageKey = (t: string, suffix: StorageSuffix) => `praetor_table_${suffix}_${slugify(t)}`;

// Client-local view ordering for server-backed mode. The server has no `sort_order`
// column (v1), so the user's preferred ordering is persisted per `viewKey` on this device.
const getViewOrderStorageKey = (viewKey: string) => `praetor_table_vieworder_${slugify(viewKey)}`;

// Schema version stamped onto the server `config` payload. Mirrors the backend's
// table-config validator so a future migration can detect and upgrade old payloads.
const SERVER_VIEW_SCHEMA_VERSION = 1;

// Per-view server metadata kept alongside the `CustomView[]` list so the shared
// apply/dirty helpers stay untouched (they only read the `CustomView` fields) while
// the submenu can still gate UI by ownership/permission.
type ServerViewMeta = { access: SavedViewAccess; ownerId: string; ownerName: string };

// `config` maps 1:1 onto `CustomView` minus id/name. Map the server DTO into the
// in-memory `CustomView` shape the apply/dirty logic already understands, reusing the
// same lenient parsers as the localStorage path so junk in `jsonb` can't crash a render.
const serverViewToCustomView = (dto: SavedViewDto): CustomView => {
  const config = dto.config ?? {};
  const hiddenColIds = Array.isArray(config.hiddenColIds)
    ? (config.hiddenColIds.filter((id) => typeof id === 'string') as string[])
    : [];
  return {
    id: dto.id,
    name: dto.name,
    hiddenColIds,
    sortState: parseSortState(config.sortState),
    filterState: parseFilterState(config.filterState),
  };
};

// Build the opaque `config` payload persisted to the server from a `CustomView`.
const customViewToConfig = (view: {
  hiddenColIds: string[];
  sortState: SortState;
  filterState: FilterState;
}): Record<string, unknown> => ({
  schemaVersion: SERVER_VIEW_SCHEMA_VERSION,
  hiddenColIds: view.hiddenColIds,
  sortState: view.sortState,
  filterState: view.filterState,
});

const readViewOrder = (viewKey: string): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(getViewOrderStorageKey(viewKey)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const writeViewOrder = (viewKey: string, order: string[]) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getViewOrderStorageKey(viewKey), JSON.stringify(order));
  } catch {}
};

// Apply the device-local ordering to a freshly fetched list: known ids keep their
// saved order, anything new (or shared after the order was saved) is appended.
const applyViewOrder = (views: CustomView[], order: string[]): CustomView[] => {
  if (order.length === 0) return views;
  const orderIndex = new Map(order.map((id, idx) => [id, idx]));
  return views.toSorted((a, b) => {
    const ai = orderIndex.get(a.id);
    const bi = orderIndex.get(b.id);
    if (ai == null && bi == null) return 0;
    if (ai == null) return 1;
    if (bi == null) return -1;
    return ai - bi;
  });
};

const sanitizeColumnWidths = (
  value: unknown,
  validIds?: ReadonlySet<string>,
): Record<string, number> => {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([id, width]) =>
        (!validIds || validIds.has(id)) && typeof width === 'number' && Number.isFinite(width),
    ),
  );
};

const FONT_SIZES = ['xs', 'sm', 'base'] as const;
type FontSize = (typeof FONT_SIZES)[number];

const VIEW_ERROR_DURATION_MS = 3000;
const COPIED_FEEDBACK_DURATION_MS = 1500;
const DEFAULT_COL_WIDTH = 150;
const DEFAULT_MIN_COL_WIDTH = 56;
const HEADER_TEXT_CHAR_WIDTH = 7;
const HEADER_CELL_HORIZONTAL_PADDING = 24;
const HEADER_RESIZE_GUTTER_WIDTH = 0;
const HEADER_SORT_BUTTON_HORIZONTAL_PADDING = 16;
const HEADER_SORT_ICON_WIDTH = 12;
const HEADER_SORT_ICON_GAP = 4;
const HEADER_FILTER_BUTTON_WIDTH = 24;
const HEADER_CONTENT_GAP = 4;
const ACTION_COLUMN_WIDTH = 64;
const ACTION_MENU_CONTENT_CLASSNAME = 'w-max min-w-[9rem] max-w-[calc(100vw-2rem)] p-1';
const ACTION_MENU_ITEMS_CLASSNAME = 'flex flex-col gap-0.5';
const ACTION_MENU_BUTTON_CLASSNAME =
  'flex h-7 w-full items-center justify-start gap-2 rounded-sm px-2 text-xs font-medium whitespace-nowrap text-popover-foreground outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50';
type ViewModalState = { kind: 'create' } | { kind: 'edit'; view: CustomView } | null;
type StateUpdate<T> = T | ((prev: T) => T);
type TableViewApplication = ReturnType<typeof computeViewApplication>;
type TableViewState = {
  sortState: SortState;
  filterState: FilterState;
  hiddenColIds: Set<string>;
  activeViewId: string | null;
};
type TableViewAction =
  | { type: 'set-active-view'; activeViewId: string | null }
  | { type: 'set-filter-state'; filterState: FilterState; activeViewId?: string | null }
  | { type: 'set-hidden-columns'; hiddenColIds: Set<string> }
  | { type: 'set-sort-state'; sortState: SortState }
  | {
      type: 'apply-view';
      application: TableViewApplication;
      activeViewId?: string | null;
    }
  | { type: 'apply-column-visibility'; hiddenColIds: Set<string> };

const tableViewReducer = (state: TableViewState, action: TableViewAction): TableViewState => {
  switch (action.type) {
    case 'set-active-view':
      return { ...state, activeViewId: action.activeViewId };
    case 'set-filter-state':
      return {
        ...state,
        filterState: action.filterState,
        activeViewId: action.activeViewId === undefined ? state.activeViewId : action.activeViewId,
      };
    case 'set-hidden-columns':
      return { ...state, hiddenColIds: action.hiddenColIds };
    case 'set-sort-state':
      return { ...state, sortState: action.sortState };
    case 'apply-view':
      return {
        ...state,
        hiddenColIds: action.application.hiddenColIds,
        sortState: action.application.sortState,
        filterState: action.application.filterState,
        activeViewId: action.activeViewId === undefined ? state.activeViewId : action.activeViewId,
      };
    case 'apply-column-visibility': {
      const filterState = { ...state.filterState };
      let filtersChanged = false;
      for (const colId of action.hiddenColIds) {
        if (filterState[colId]) {
          delete filterState[colId];
          filtersChanged = true;
        }
      }
      return {
        ...state,
        hiddenColIds: action.hiddenColIds,
        sortState:
          state.sortState && action.hiddenColIds.has(state.sortState.colId)
            ? null
            : state.sortState,
        filterState: filtersChanged ? filterState : state.filterState,
        activeViewId: null,
      };
    }
  }
};

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
  legacyHiddenColumnIds?: string[];
  legacySortColumnIds?: string[];
  legacyFilterColumnIds?: string[];
  mapLegacyFilterValue?: (value: string, legacyColumnId: string) => string | null | undefined;
  legacySortAccessorFn?: (
    row: T,
    legacyColumnId: string,
  ) => string | number | boolean | null | undefined;
  legacyFilterAccessorFn?: (
    row: T,
    legacyColumnId: string,
  ) => string | number | boolean | null | undefined;
  sticky?: 'right';
  onCellDoubleClick?: (row: T) => void; // Cell-level double click handler
};

const getColumnId = <T,>(col: Column<T>) =>
  col.id || (col.accessorKey ? String(col.accessorKey) : undefined) || col.header;

const isTableActionColumn = <T,>(col: Column<T>) =>
  getColumnId(col) === 'actions' ||
  (col.sticky === 'right' && col.accessorKey == null && col.accessorFn == null);

const getViewApplicationForColumns = <T,>(view: CustomView, columns: Column<T>[] | undefined) => {
  const gearIds = new Set<string>();
  const allIds = new Set<string>();
  const hiddenColumnAliases = new Map<string, string[]>();
  const sortColumnAliases = new Map<string, string>();
  const filterColumnAliases = new Map<string, LegacyFilterColumnAlias[]>();
  for (const column of columns ?? []) {
    const columnId = getColumnId(column);
    allIds.add(columnId);
    if (!column.hidden && !isTableActionColumn(column)) {
      gearIds.add(columnId);
      for (const legacyId of column.legacyHiddenColumnIds ?? []) {
        const mappedIds = hiddenColumnAliases.get(legacyId);
        if (mappedIds) mappedIds.push(columnId);
        else hiddenColumnAliases.set(legacyId, [columnId]);
      }
      for (const legacyId of column.legacySortColumnIds ?? []) {
        if (!sortColumnAliases.has(legacyId)) sortColumnAliases.set(legacyId, columnId);
      }
      for (const legacyId of column.legacyFilterColumnIds ?? []) {
        const mappedFilters = filterColumnAliases.get(legacyId);
        const alias = { columnId, mapValue: column.mapLegacyFilterValue };
        if (mappedFilters) mappedFilters.push(alias);
        else filterColumnAliases.set(legacyId, [alias]);
      }
    }
  }
  return computeViewApplication(view, gearIds, allIds, {
    hiddenColumnAliases,
    sortColumnAliases,
    filterColumnAliases,
  });
};

const normalizeViewForColumns = <T,>(
  view: CustomView,
  columns: Column<T>[] | undefined,
): CustomView => {
  const application = getViewApplicationForColumns(view, columns);
  return {
    ...view,
    hiddenColIds: Array.from(application.hiddenColIds),
    sortState: application.sortState,
    filterState: application.filterState,
  };
};

const readStoredActiveViewId = (title: string, skipSavedView: boolean) => {
  if (typeof window === 'undefined' || skipSavedView) return null;
  return localStorage.getItem(getStorageKey(title, STORAGE_SUFFIX.activeView));
};

const readInitialCustomViews = (title: string, isServerBacked: boolean) => {
  if (typeof window === 'undefined' || isServerBacked) return [];
  return parseStoredViews(localStorage.getItem(getStorageKey(title, STORAGE_SUFFIX.customViews)));
};

const readInitialRowsPerPage = (title: string, defaultRowsPerPage: number) => {
  if (typeof window === 'undefined') return defaultRowsPerPage;
  const saved = localStorage.getItem(getStorageKey(title, STORAGE_SUFFIX.rows));
  if (saved) {
    const value = Number(saved);
    if ([5, 10, 20, 50].includes(value)) return value;
  }
  return defaultRowsPerPage;
};

const readInitialFontSize = (title: string): FontSize => {
  if (typeof window === 'undefined') return 'sm';
  const saved = localStorage.getItem(getStorageKey(title, STORAGE_SUFFIX.fontSize));
  if (saved && (FONT_SIZES as readonly string[]).includes(saved)) return saved as FontSize;
  return 'sm';
};

const readInitialColumnSizing = (title: string): ColumnSizingState => {
  if (typeof window === 'undefined') return {};
  const saved = localStorage.getItem(getStorageKey(title, STORAGE_SUFFIX.colWidths));
  if (saved) {
    try {
      return sanitizeColumnWidths(JSON.parse(saved));
    } catch {}
  }
  return {};
};

type StandardTableUiState = {
  currentPage: number;
  gearOpen: boolean;
  openActionMenuRowId: string | null;
  openContextMenuRowId: string | null;
  rowsPerPage: number;
  fontSize: FontSize;
  columnSizing: ColumnSizingState;
  customViews: CustomView[];
  serverViewMeta: Map<string, ServerViewMeta>;
  viewsLoading: boolean;
  viewsLoadFailed: boolean;
  viewBusy: boolean;
  shareModalView: CustomView | null;
  viewsSubmenuOpen: boolean;
  modalState: ViewModalState;
  draggingViewId: string | null;
  dragOverViewId: string | null;
  copiedViewId: string | null;
  viewError: string | null;
  pasteModalOpen: boolean;
  pasteText: string;
  pasteError: string | null;
  filterSearchByColumnId: Record<string, string>;
};

type StandardTableUiValue = StandardTableUiState[keyof StandardTableUiState];
type StandardTableUiUpdate = StateUpdate<StandardTableUiValue>;

type StandardTableUiAction =
  | { type: 'setField'; field: keyof StandardTableUiState; update: StandardTableUiUpdate }
  | { type: 'patch'; values: Partial<StandardTableUiState> };

const resolveStateUpdate = <T,>(current: T, update: StateUpdate<T>): T =>
  typeof update === 'function' ? (update as (prev: T) => T)(current) : update;

const createInitialStandardTableUiState = ({
  title,
  defaultRowsPerPage,
  isServerBacked,
  viewKey,
}: {
  title: string;
  defaultRowsPerPage: number;
  isServerBacked: boolean;
  viewKey: string | undefined;
}): StandardTableUiState => ({
  currentPage: 1,
  gearOpen: false,
  openActionMenuRowId: null,
  openContextMenuRowId: null,
  rowsPerPage: readInitialRowsPerPage(title, defaultRowsPerPage),
  fontSize: readInitialFontSize(title),
  columnSizing: readInitialColumnSizing(title),
  customViews: readInitialCustomViews(title, isServerBacked),
  serverViewMeta: new Map(),
  viewsLoading: Boolean(isServerBacked && viewKey),
  viewsLoadFailed: false,
  viewBusy: false,
  shareModalView: null,
  viewsSubmenuOpen: false,
  modalState: null,
  draggingViewId: null,
  dragOverViewId: null,
  copiedViewId: null,
  viewError: null,
  pasteModalOpen: false,
  pasteText: '',
  pasteError: null,
  filterSearchByColumnId: {},
});

const standardTableUiReducer = (
  state: StandardTableUiState,
  action: StandardTableUiAction,
): StandardTableUiState => {
  switch (action.type) {
    case 'setField':
      return {
        ...state,
        [action.field]: resolveStateUpdate(
          state[action.field],
          action.update as StateUpdate<(typeof state)[typeof action.field]>,
        ),
      };
    case 'patch':
      return { ...state, ...action.values };
  }
};

const createInitialTableViewState = <T,>({
  title,
  columns,
  initialFilterState,
  skipSavedView,
  isServerBacked,
}: {
  title: string;
  columns: Column<T>[] | undefined;
  initialFilterState: Record<string, string[]> | undefined;
  skipSavedView: boolean;
  isServerBacked: boolean;
}): TableViewState => {
  const activeViewId = readStoredActiveViewId(title, skipSavedView);
  const baseState: TableViewState = {
    sortState: null,
    filterState: initialFilterState ?? {},
    hiddenColIds: new Set<string>(),
    activeViewId,
  };
  if (!activeViewId || isServerBacked) return baseState;

  const view = readInitialCustomViews(title, false).find(
    (candidate) => candidate.id === activeViewId,
  );
  if (!view) {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(getStorageKey(title, STORAGE_SUFFIX.activeView));
      } catch {}
    }
    return { ...baseState, activeViewId: null };
  }

  const application = getViewApplicationForColumns(view, columns);
  return {
    ...baseState,
    hiddenColIds: application.hiddenColIds,
    sortState: application.sortState,
    filterState: application.filterState,
  };
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
  isLoading?: boolean;
  loadingState?: ReactNode;
  data?: T[];
  columns?: Column<T>[];
  defaultRowsPerPage?: number;
  /**
   * Minimum visible body rows. When the current page has fewer rows than this,
   * the body is padded with inert placeholder rows so the table footprint stays
   * stable across empty / sparse / full states. Defaults to 4.
   */
  minBodyRows?: number;
  rowClassName?: (row: T) => string;
  disabledRow?: (row: T) => boolean;
  onRowClick?: (row: T) => void;
  initialFilterState?: Record<string, string[]>;
  /**
   * Force programmatic/deep-link mode: skip hydrating the persisted saved view on
   * mount even when `initialFilterState` is still empty. Use when the filter value
   * is resolved asynchronously (e.g. a quick-view product id that needs the loaded
   * product list to map to a column), so a saved view that hides the filter column
   * can't slip in before the filter materializes.
   */
  suppressSavedView?: boolean;
  /**
   * Stable scope key (e.g. `projects.directory`). When set, the table switches to
   * SERVER-BACKED mode: custom views are loaded from / persisted to the shared
   * `viewsApi` store (own + shared, owner/read/write gating) instead of localStorage.
   * When absent, the table keeps its legacy per-device localStorage view behavior.
   */
  viewKey?: string;
};

const useStandardTableController = <T extends object>({
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
  isLoading = false,
  loadingState,
  data,
  columns,
  defaultRowsPerPage = 10,
  minBodyRows = 4,
  rowClassName,
  disabledRow,
  onRowClick,
  initialFilterState,
  suppressSavedView = false,
  viewKey,
}: StandardTableProps<T>) => {
  const { t } = useTranslation('common');
  const isServerBacked = viewKey != null;
  const tableContainerRef = useRef<HTMLDivElement | null>(null);

  // A programmatic filter (a quick-view deep link or a cross-view "view X"
  // navigation) must win over a persisted saved view, which would otherwise
  // overwrite the filter — and its hidden columns / sort would persist — once
  // views hydrate after mount. Since the prop identity never changes, the sync
  // effect wouldn't re-apply it. So skip hydrating the saved active view when a
  // non-empty `initialFilterState` is present OR the caller forces deep-link mode
  // (`suppressSavedView`) because its filter value resolves asynchronously.
  const skipSavedView =
    suppressSavedView || (initialFilterState != null && Object.keys(initialFilterState).length > 0);
  const [tableViewState, dispatchTableView] = useReducer(tableViewReducer, null, () =>
    createInitialTableViewState({
      title,
      columns,
      initialFilterState,
      skipSavedView,
      isServerBacked,
    }),
  );
  const { sortState, filterState, hiddenColIds, activeViewId } = tableViewState;
  const filterStateRef = useRef(filterState);
  filterStateRef.current = filterState;

  const [tableUiState, dispatchTableUi] = useReducer(
    standardTableUiReducer,
    { title, defaultRowsPerPage, isServerBacked, viewKey },
    createInitialStandardTableUiState,
  );
  const setTableUiField = useCallback(
    <K extends keyof StandardTableUiState>(
      field: K,
      update: StateUpdate<StandardTableUiState[K]>,
    ) => {
      dispatchTableUi({ type: 'setField', field, update: update as StandardTableUiUpdate });
    },
    [],
  );
  const {
    currentPage,
    gearOpen,
    openActionMenuRowId,
    openContextMenuRowId,
    rowsPerPage,
    fontSize,
    columnSizing,
    customViews,
    serverViewMeta,
    viewsLoading,
    viewsLoadFailed,
    viewBusy,
    shareModalView,
    viewsSubmenuOpen,
    modalState,
    draggingViewId,
    dragOverViewId,
    copiedViewId,
    viewError,
    pasteModalOpen,
    pasteText,
    pasteError,
    filterSearchByColumnId,
  } = tableUiState;
  const setCurrentPage = useCallback(
    (update: StateUpdate<number>) => setTableUiField('currentPage', update),
    [setTableUiField],
  );
  const setGearOpen = useCallback(
    (update: StateUpdate<boolean>) => setTableUiField('gearOpen', update),
    [setTableUiField],
  );
  const setOpenActionMenuRowId = useCallback(
    (update: StateUpdate<string | null>) => setTableUiField('openActionMenuRowId', update),
    [setTableUiField],
  );
  const setOpenContextMenuRowId = useCallback(
    (update: StateUpdate<string | null>) => setTableUiField('openContextMenuRowId', update),
    [setTableUiField],
  );
  const setRowsPerPage = useCallback(
    (update: StateUpdate<number>) => setTableUiField('rowsPerPage', update),
    [setTableUiField],
  );
  const setFontSize = useCallback(
    (update: StateUpdate<FontSize>) => setTableUiField('fontSize', update),
    [setTableUiField],
  );
  const setColumnSizing = useCallback(
    (update: StateUpdate<ColumnSizingState>) => setTableUiField('columnSizing', update),
    [setTableUiField],
  );
  const setCustomViews = useCallback(
    (update: StateUpdate<CustomView[]>) => setTableUiField('customViews', update),
    [setTableUiField],
  );
  const setServerViewMeta = useCallback(
    (update: StateUpdate<Map<string, ServerViewMeta>>) => setTableUiField('serverViewMeta', update),
    [setTableUiField],
  );
  const setViewsLoading = useCallback(
    (update: StateUpdate<boolean>) => setTableUiField('viewsLoading', update),
    [setTableUiField],
  );
  const setViewsLoadFailed = useCallback(
    (update: StateUpdate<boolean>) => setTableUiField('viewsLoadFailed', update),
    [setTableUiField],
  );
  const setViewBusy = useCallback(
    (update: StateUpdate<boolean>) => setTableUiField('viewBusy', update),
    [setTableUiField],
  );
  const setShareModalView = useCallback(
    (update: StateUpdate<CustomView | null>) => setTableUiField('shareModalView', update),
    [setTableUiField],
  );
  const setViewsSubmenuOpen = useCallback(
    (update: StateUpdate<boolean>) => setTableUiField('viewsSubmenuOpen', update),
    [setTableUiField],
  );
  const setModalState = useCallback(
    (update: StateUpdate<ViewModalState>) => setTableUiField('modalState', update),
    [setTableUiField],
  );
  const setDraggingViewId = useCallback(
    (update: StateUpdate<string | null>) => setTableUiField('draggingViewId', update),
    [setTableUiField],
  );
  const setDragOverViewId = useCallback(
    (update: StateUpdate<string | null>) => setTableUiField('dragOverViewId', update),
    [setTableUiField],
  );
  const setCopiedViewId = useCallback(
    (update: StateUpdate<string | null>) => setTableUiField('copiedViewId', update),
    [setTableUiField],
  );
  const setViewError = useCallback(
    (update: StateUpdate<string | null>) => setTableUiField('viewError', update),
    [setTableUiField],
  );
  const setPasteModalOpen = useCallback(
    (update: StateUpdate<boolean>) => setTableUiField('pasteModalOpen', update),
    [setTableUiField],
  );
  const setPasteText = useCallback(
    (update: StateUpdate<string>) => setTableUiField('pasteText', update),
    [setTableUiField],
  );
  const setPasteError = useCallback(
    (update: StateUpdate<string | null>) => setTableUiField('pasteError', update),
    [setTableUiField],
  );
  const setFilterSearchByColumnId = useCallback(
    (update: StateUpdate<Record<string, string>>) =>
      setTableUiField('filterSearchByColumnId', update),
    [setTableUiField],
  );

  // Upsert a view's ownership/permission metadata from a server response (server-backed only).
  const rememberServerViewMeta = useCallback(
    (dto: SavedViewDto) => {
      setServerViewMeta((prev) => {
        const next = new Map(prev);
        next.set(dto.id, { access: dto.access, ownerId: dto.ownerId, ownerName: dto.ownerName });
        return next;
      });
    },
    [setServerViewMeta],
  );
  // Read by the legacy-view migration so it can re-point a persisted active-view id (an old local
  // UUID) at the new server id after upload, without becoming a load-effect dependency.
  const activeViewIdRef = useRef(activeViewId);
  activeViewIdRef.current = activeViewId;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewsAppliedOnceRef = useRef(!isServerBacked);
  const hasSeenInitialFilterStateRef = useRef(initialFilterState !== undefined);

  const handleGearOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setViewsSubmenuOpen(false);
      setGearOpen(open);
    },
    [setGearOpen, setViewsSubmenuOpen],
  );

  const storageKey = useMemo(() => getStorageKey(title, STORAGE_SUFFIX.rows), [title]);

  const updateCustomViews = useCallback(
    (updater: (prev: CustomView[]) => CustomView[]) => {
      setCustomViews((prev) => {
        const next = updater(prev);
        // Server-backed mode persists views to the API, not localStorage; only the
        // device-local *ordering* is mirrored to localStorage (handled separately).
        if (next !== prev && !isServerBacked && typeof window !== 'undefined') {
          try {
            localStorage.setItem(
              getStorageKey(title, STORAGE_SUFFIX.customViews),
              JSON.stringify(next),
            );
          } catch {}
        }
        if (next !== prev && isServerBacked && viewKey) {
          writeViewOrder(
            viewKey,
            next.map((v) => v.id),
          );
        }
        return next;
      });
    },
    [title, isServerBacked, setCustomViews, viewKey],
  );

  const updateActiveViewId = useCallback(
    (id: string | null) => {
      dispatchTableView({ type: 'set-active-view', activeViewId: id });
      if (typeof window === 'undefined') return;
      const key = getStorageKey(title, STORAGE_SUFFIX.activeView);
      try {
        if (id) localStorage.setItem(key, id);
        else localStorage.removeItem(key);
      } catch {}
    },
    [title],
  );

  // Tracks the in-flight list request so a remount / viewKey change aborts the old one
  // and a stale response can't overwrite fresh state.
  const loadAbortRef = useRef<AbortController | null>(null);
  // Bumped each time the user retries; re-runs the load effect.
  const [viewsReloadToken, reloadViews] = useReducer((token: number) => token + 1, 0);
  const viewsLoadKey =
    isServerBacked && viewKey ? `${viewKey}|${viewsReloadToken}` : 'local-storage';
  const loadedViewsKeyRef = useRef(viewsLoadKey);

  if (loadedViewsKeyRef.current !== viewsLoadKey) {
    loadedViewsKeyRef.current = viewsLoadKey;
    viewsAppliedOnceRef.current = !isServerBacked;
    setViewsLoading(Boolean(isServerBacked && viewKey));
    setViewsLoadFailed(false);
  }

  // One-time, best-effort migration of legacy localStorage views into the server store the first
  // time a table gains a `viewKey`. Without it, existing users would lose the custom views they
  // created before the upgrade (server mode ignores the legacy title-slug key and hides clipboard
  // import). A per-`viewKey` sentinel tracks progress ('pending' → 'done'): a view is removed from
  // localStorage only once uploaded, and the sentinel reaches 'done' only after EVERY view is
  // uploaded — so a transient create failure retries the leftovers on a later load instead of
  // stranding the data behind a set sentinel. Returns true when it uploaded anything (re-list).
  const migrateLegacyViews = useCallback(
    async (key: string, noOwnViews: boolean, signal: AbortSignal): Promise<boolean> => {
      if (typeof window === 'undefined') return false;
      const sentinelKey = `praetor_table_viewsmigrated_${slugify(key)}`;
      const legacyKey = getStorageKey(title, STORAGE_SUFFIX.customViews);
      let state: string | null = null;
      try {
        state = localStorage.getItem(sentinelKey);
      } catch {
        return false;
      }
      if (state === 'done') return false;

      let legacy: CustomView[] = [];
      try {
        legacy = parseStoredViews(localStorage.getItem(legacyKey));
      } catch {}

      if (state !== 'pending') {
        // First attempt for this device + viewKey. Nothing to migrate, or the user already has
        // OWN views on the server (migrated on another device) → mark done. Shared-with-me views
        // don't count, so another user's shared view can't suppress migrating local presets.
        if (legacy.length === 0 || !noOwnViews) {
          try {
            localStorage.setItem(sentinelKey, 'done');
          } catch {}
          return false;
        }
        // Commit to migrating: mark 'pending' so a transient upload failure resumes on a later
        // load (ignoring noOwnViews, since we already own this migration) rather than being lost.
        try {
          localStorage.setItem(sentinelKey, 'pending');
        } catch {}
      }

      const activeId = activeViewIdRef.current;
      const uploadResults = await Promise.all(
        legacy.map(async (view) => {
          if (signal.aborted) return { status: 'skipped' as const, view };
          try {
            const dto = await viewsApi.create({
              kind: 'table',
              scopeKey: key,
              name: view.name,
              config: customViewToConfig(view),
            });
            return { status: 'uploaded' as const, view, dto };
          } catch (err) {
            console.error('Failed to migrate a legacy table view', err);
            return { status: 'failed' as const, view };
          }
        }),
      );

      const remaining: CustomView[] = [];
      let uploaded = false;
      for (const result of uploadResults) {
        if (result.status !== 'uploaded') {
          remaining.push(result.view);
          continue;
        }
        uploaded = true;
        // Keep the user's active preset applied after upgrade: re-point the persisted active
        // marker (an old local id) at the new server id so the post-relist guard matches it.
        if (result.view.id === activeId && !signal.aborted) {
          activeViewIdRef.current = result.dto.id;
          updateActiveViewId(result.dto.id);
        }
      }

      try {
        if (remaining.length === 0) {
          localStorage.setItem(sentinelKey, 'done');
          localStorage.removeItem(legacyKey);
        } else {
          // Keep only the not-yet-uploaded views; the 'pending' sentinel stays so a later load
          // retries exactly those.
          localStorage.setItem(legacyKey, JSON.stringify(remaining));
        }
      } catch {}

      return uploaded;
    },
    [title, updateActiveViewId],
  );

  // Server-backed mode: load own + shared views on mount (and on viewKey change / retry).
  // Views are applied client-local ordering and the dangling-active-view guard re-runs once
  // the list resolves. Legacy mode is a no-op here (localStorage hydration happened in state init).
  useEffect(() => {
    void viewsReloadToken;
    if (!isServerBacked || !viewKey) return;
    const controller = new AbortController();
    loadAbortRef.current?.abort();
    loadAbortRef.current = controller;
    (async () => {
      try {
        let dtos = await viewsApi.list('table', viewKey, controller.signal);
        if (!controller.signal.aborted) {
          // One-time migration of pre-upgrade localStorage views (claimed on the first
          // server-backed load); re-list so any uploaded rows show up.
          const migrated = await migrateLegacyViews(
            viewKey,
            !dtos.some((d) => d.access === 'owner'),
            controller.signal,
          );
          if (!controller.signal.aborted && migrated) {
            dtos = await viewsApi.list('table', viewKey, controller.signal);
          }
        }
        if (!controller.signal.aborted) {
          const views = applyViewOrder(dtos.map(serverViewToCustomView), readViewOrder(viewKey));
          setServerViewMeta(
            new Map(
              dtos.map((dto) => [
                dto.id,
                { access: dto.access, ownerId: dto.ownerId, ownerName: dto.ownerName },
              ]),
            ),
          );
          setCustomViews(views);
          setViewsLoading(false);
          const activeId = activeViewIdRef.current;
          if (activeId) {
            const activeView = views.find((view) => view.id === activeId);
            if (activeView) {
              const application = getViewApplicationForColumns(activeView, columnsRef.current);
              dispatchTableView({ type: 'apply-view', application });
            } else {
              updateActiveViewId(null);
            }
          }
          viewsAppliedOnceRef.current = true;
        }
      } catch (err) {
        if (!controller.signal.aborted && !(err instanceof Error && err.name === 'AbortError')) {
          console.error('Failed to load saved views', err);
          setViewsLoading(false);
          setViewsLoadFailed(true);
        }
      }
    })();
    return () => controller.abort();
  }, [
    isServerBacked,
    migrateLegacyViews,
    setCustomViews,
    setServerViewMeta,
    setViewsLoadFailed,
    setViewsLoading,
    updateActiveViewId,
    viewKey,
    viewsReloadToken,
  ]);

  useEffect(
    () => () => {
      loadAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (initialFilterState === undefined && !suppressSavedView) {
      if (!hasSeenInitialFilterStateRef.current) return;
    } else {
      hasSeenInitialFilterStateRef.current = true;
    }
    const next = initialFilterState ?? {};
    if (filterStatesEqual(filterStateRef.current, next)) return;
    dispatchTableView({
      type: 'set-filter-state',
      filterState: next,
      activeViewId: viewsAppliedOnceRef.current ? null : undefined,
    });
    if (viewsAppliedOnceRef.current) {
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem(getStorageKey(title, STORAGE_SUFFIX.activeView));
        } catch {}
      }
    }
  }, [initialFilterState, suppressSavedView, title]);

  const getColId = useCallback(getColumnId, []);

  const isRowActionColumn = useCallback(isTableActionColumn, []);

  const visibleColumns = useMemo(
    () =>
      columns?.filter((col) => {
        if (col.hidden) return false;
        if (isRowActionColumn(col)) return true;
        return !hiddenColIds.has(getColId(col));
      }) ?? [],
    [columns, hiddenColIds, getColId, isRowActionColumn],
  );

  const getColumnMinWidth = useCallback(
    (col: Column<T>) => {
      const headerTextWidth = String(col.header).length * HEADER_TEXT_CHAR_WIDTH;
      if (isRowActionColumn(col)) {
        return Math.max(
          ACTION_COLUMN_WIDTH,
          Math.ceil(headerTextWidth + HEADER_CELL_HORIZONTAL_PADDING),
        );
      }

      const filterWidth = col.disableFiltering
        ? 0
        : HEADER_CONTENT_GAP + HEADER_FILTER_BUTTON_WIDTH;
      return Math.max(
        DEFAULT_MIN_COL_WIDTH,
        Math.ceil(
          headerTextWidth +
            HEADER_SORT_BUTTON_HORIZONTAL_PADDING +
            HEADER_SORT_ICON_GAP +
            HEADER_SORT_ICON_WIDTH +
            filterWidth +
            HEADER_CELL_HORIZONTAL_PADDING +
            HEADER_RESIZE_GUTTER_WIDTH,
        ),
      );
    },
    [isRowActionColumn],
  );

  const validColumnSizing = useMemo(() => {
    const validIds = new Set((columns ?? []).map((col) => getColId(col)));
    return sanitizeColumnWidths(columnSizing, validIds);
  }, [columns, columnSizing, getColId]);

  const clampColumnSizing = useCallback(
    (value: ColumnSizingState) => {
      const validIds = new Set((columns ?? []).map((col) => getColId(col)));
      const next = sanitizeColumnWidths(value, validIds);
      for (const col of columns ?? []) {
        const colId = getColId(col);
        if (next[colId] != null) {
          next[colId] = Math.max(next[colId], getColumnMinWidth(col));
        }
      }
      return next;
    },
    [columns, getColId, getColumnMinWidth],
  );

  const clampedColumnSizing = useMemo(
    () => clampColumnSizing(validColumnSizing),
    [clampColumnSizing, validColumnSizing],
  );

  const shouldRenderTable = Boolean(columns && data && !isLoading);
  const usesFixedTableLayout = shouldRenderTable;

  // Excludes statically hidden filter-only columns and row actions; sort/filter
  // still target hidden filter-only columns via colsById.
  const gearColumns = useMemo(
    () => columns?.filter((col) => !col.hidden && !isRowActionColumn(col)) ?? [],
    [columns, isRowActionColumn],
  );

  const modalColumns = useMemo(
    () => gearColumns.map((col) => ({ id: getColId(col), header: col.header })),
    [gearColumns, getColId],
  );

  const activeView = useMemo(
    () => (activeViewId ? (customViews.find((v) => v.id === activeViewId) ?? null) : null),
    [activeViewId, customViews],
  );

  // Access resolution for the views submenu. In legacy mode every view is fully owned
  // (no server concept of sharing), so gating is permissive. Per-row the submenu derives
  // `owned` (delete/share) and `editable` (rename/re-save) from this.
  const getViewAccess = useCallback(
    (id: string): SavedViewAccess => {
      if (!isServerBacked) return 'owner';
      // Fail closed to least privilege if a server view's metadata isn't resolved yet:
      // never surface owner-only controls (delete/share) for a view we can't vouch for.
      return serverViewMeta.get(id)?.access ?? 'read';
    },
    [isServerBacked, serverViewMeta],
  );

  const applyViewState = useCallback(
    (view: CustomView, nextActiveViewId?: string | null) => {
      const result = getViewApplicationForColumns(view, columns);
      dispatchTableView({
        type: 'apply-view',
        application: result,
        activeViewId: nextActiveViewId,
      });
      if (nextActiveViewId !== undefined && typeof window !== 'undefined') {
        const key = getStorageKey(title, STORAGE_SUFFIX.activeView);
        try {
          if (nextActiveViewId) localStorage.setItem(key, nextActiveViewId);
          else localStorage.removeItem(key);
        } catch {}
      }
    },
    [columns, title],
  );

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

  const normalizeViewForCurrentColumns = (view: CustomView) =>
    normalizeViewForColumns(view, columns);

  const normalizeHiddenColIdsForCurrentColumns = (ids: string[]) =>
    normalizeViewForCurrentColumns({
      id: '',
      name: '',
      hiddenColIds: ids,
      sortState: null,
      filterState: {},
    }).hiddenColIds;

  const fontSizeClass = fontSize === 'xs' ? 'text-xs' : fontSize === 'sm' ? 'text-sm' : 'text-base';

  // Persist the clamped column widths whenever they change. The table renders from
  // `clampedColumnSizing` (a memo derived from the raw sizing state), and `onColumnSizingChange`
  // already clamps on every user resize, so there's no need to write the clamped value back into
  // state from here — persisting the derived value directly avoids an extra render.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(
      getStorageKey(title, STORAGE_SUFFIX.colWidths),
      JSON.stringify(clampedColumnSizing),
    );
  }, [clampedColumnSizing, title]);

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
        const minSize = getColumnMinWidth(col);
        const defaultSize = isRowActionColumn(col) ? minSize : Math.max(DEFAULT_COL_WIDTH, minSize);
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
          size: Math.max(clampedColumnSizing[colId] ?? defaultSize, minSize),
          minSize,
          enableResizing: !isRowActionColumn(col),
          enableSorting: !col.disableSorting,
          enableColumnFilter: !col.disableFiltering,
          enableHiding: !col.hidden && !isRowActionColumn(col),
          sortingFn: (rowA, rowB) => {
            const legacySortColumnId =
              sortState?.colId === colId &&
              sortState.legacyColId &&
              col.legacySortColumnIds?.includes(sortState.legacyColId)
                ? sortState.legacyColId
                : null;
            const getSortValue = (row: typeof rowA) =>
              legacySortColumnId && col.legacySortAccessorFn
                ? col.legacySortAccessorFn(row.original, legacySortColumnId)
                : row.getValue(colId);
            const valA = getSortValue(rowA);
            const valB = getSortValue(rowB);
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
            const formattedLower = formatted.toLowerCase();
            const legacyColumnIds = col.legacyFilterColumnIds
              ? new Set(col.legacyFilterColumnIds)
              : null;
            return selected.some((value) => {
              const legacyValue = decodeLegacyFilterValue(value);
              if (legacyValue) {
                if (
                  !col.legacyFilterAccessorFn ||
                  !legacyColumnIds?.has(legacyValue.legacyColumnId)
                ) {
                  return false;
                }
                return (
                  formatForFilter(
                    col.legacyFilterAccessorFn(row.original, legacyValue.legacyColumnId),
                    col,
                  ).toLowerCase() === legacyValue.value.toLowerCase()
                );
              }
              return formattedLower === value.toLowerCase();
            });
          },
        } satisfies ColumnDef<T, unknown>;
      }),
    [
      clampedColumnSizing,
      columns,
      getColId,
      getColumnMinWidth,
      getValue,
      formatForFilter,
      isRowActionColumn,
      sortState,
    ],
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
          if (isRowActionColumn(col)) return [colId, true];
          return [colId, !col.hidden && !hiddenColIds.has(colId)];
        }),
      ) as VisibilityState,
    [columns, getColId, hiddenColIds, isRowActionColumn],
  );

  const onSortingChange = useCallback(
    (updater: Updater<SortingState>) => {
      const next = functionalUpdate(updater, sorting);
      const firstSort = next[0];
      dispatchTableView({
        type: 'set-sort-state',
        sortState: firstSort ? { colId: firstSort.id, px: firstSort.desc ? 'desc' : 'asc' } : null,
      });
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
      dispatchTableView({
        type: 'set-filter-state',
        filterState: nextFilterState,
        activeViewId: null,
      });
      setCurrentPage(1);
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem(getStorageKey(title, STORAGE_SUFFIX.activeView));
        } catch {}
      }
    },
    [columnFilters, setCurrentPage, title],
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
    [pagination, rowsPerPage, setCurrentPage, setRowsPerPage, storageKey],
  );

  const onColumnVisibilityChange = useCallback(
    (updater: Updater<VisibilityState>) => {
      const next = functionalUpdate(updater, columnVisibility);
      const nextHiddenColIds = new Set<string>();
      for (const col of gearColumns) {
        const colId = getColId(col);
        if (next[colId] === false) nextHiddenColIds.add(colId);
      }

      dispatchTableView({
        type: 'apply-column-visibility',
        hiddenColIds: nextHiddenColIds,
      });
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem(getStorageKey(title, STORAGE_SUFFIX.activeView));
        } catch {}
      }
    },
    [columnVisibility, gearColumns, getColId, title],
  );

  const onColumnSizingChange = useCallback(
    (updater: Updater<ColumnSizingState>) => {
      setColumnSizing((prev) => {
        const next = functionalUpdate(updater, clampColumnSizing(prev));
        return clampColumnSizing(next);
      });
    },
    [clampColumnSizing, setColumnSizing],
  );

  const table = useReactTable({
    data: shouldRenderTable ? (data ?? []) : [],
    columns: tanStackColumns,
    onSortingChange,
    onColumnFiltersChange,
    onPaginationChange,
    onColumnVisibilityChange,
    onColumnSizingChange,
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    state: {
      sorting,
      columnFilters,
      pagination,
      columnVisibility,
      columnSizing: clampedColumnSizing,
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const processedRows = shouldRenderTable ? table.getPrePaginationRowModel().rows : [];
  const totalItems = shouldRenderTable ? processedRows.length : externalTotalCount || 0;
  const totalPages = shouldRenderTable ? table.getPageCount() : Math.ceil(totalItems / rowsPerPage);
  const paginatedRows = shouldRenderTable ? table.getRowModel().rows : [];
  const hasTrailingActionColumn =
    visibleColumns.length > 0 && isRowActionColumn(visibleColumns[visibleColumns.length - 1]);
  const visibleDataColumnCount = visibleColumns.filter((col) => !isRowActionColumn(col)).length;
  const shouldAnchorTrailingActionColumn = hasTrailingActionColumn && visibleDataColumnCount > 1;
  const fixedTableWidth = useMemo(() => {
    if (!usesFixedTableLayout) return undefined;
    return table.getTotalSize();
  }, [table, usesFixedTableLayout]);

  // When there's no anchored trailing action column, append an auto-width spacer cell after the
  // last data column so the table stretches to fill its container instead of leaving dead space,
  // while every real column keeps its concrete width (and its resize handle keeps working).
  const hasTrailingSpacer =
    shouldRenderTable && !shouldAnchorTrailingActionColumn && visibleColumns.length > 0;
  const tableStretches = shouldAnchorTrailingActionColumn || hasTrailingSpacer;
  const bodyColSpan = Math.max(
    visibleColumns.length +
      (shouldAnchorTrailingActionColumn ? 1 : 0) +
      (hasTrailingSpacer ? 1 : 0),
    1,
  );
  const normalizedMinBodyRows = Math.max(0, minBodyRows);
  const paddingRowCount = Math.max(0, normalizedMinBodyRows - paginatedRows.length);
  const emptyStateMinHeightPx = normalizedMinBodyRows * BODY_ROW_HEIGHT_PX;

  if (totalPages === 0) {
    if (currentPage !== 1) setCurrentPage(1);
  } else if (currentPage > totalPages) {
    setCurrentPage(totalPages);
  }

  // Pre-computed once per data/columns change so each filter popup open is O(1)
  // instead of re-scanning the full dataset on every header re-render.
  const filterOptionsByCol = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!shouldRenderTable || !data || !columns) return m;
    for (const col of columns) {
      if (col.disableFiltering) continue;
      const values = new Set<string>();
      for (const row of data) {
        values.add(formatForFilter(getValue(row, col), col));
      }
      m.set(getColId(col), Array.from(values).sort());
    }
    return m;
  }, [shouldRenderTable, data, columns, getValue, formatForFilter, getColId]);

  const getFilterOptions = (colId: string) => filterOptionsByCol.get(colId) ?? [];

  const updateFilterSearch = (columnId: string, value: string) => {
    setFilterSearchByColumnId((prev) => ({ ...prev, [columnId]: value }));
  };

  const clearFilterSearch = (columnId: string) => {
    setFilterSearchByColumnId((prev) => {
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
  };

  const resetFilterPage = () => {
    table.setPageIndex(0);
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
        <div
          key={key}
          className="flex min-h-7 items-center gap-2 px-2 py-1 text-xs text-popover-foreground"
        >
          {node}
          {labelText && <span className="whitespace-nowrap">{labelText}</span>}
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
        className={ACTION_MENU_BUTTON_CLASSNAME}
        onClick={(event) => {
          event.stopPropagation();
          setOpenActionMenuRowId(null);
          setOpenContextMenuRowId(null);
          props.onClick?.(event);
        }}
      >
        <span className={`w-3.5 shrink-0 text-center ${getActionIconClassName(props.children)}`}>
          {props.children}
        </span>
        {text && <span className="whitespace-nowrap">{text}</span>}
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
      const children = Children.toArray(
        typeof props.children === 'function' ? undefined : props.children,
      );
      const tooltipTrigger = children.find(
        (child) => getElementLike(child)?.type === TooltipTrigger,
      );
      const tooltipContent = children.find(
        (child) => getElementLike(child)?.type === TooltipContent,
      );
      if (tooltipTrigger && tooltipContent) {
        const triggerProps = getElementLike(tooltipTrigger)?.props as
          | { children?: ReactNode }
          | undefined;
        const contentProps = getElementLike(tooltipContent)?.props as
          | { children?: ReactNode }
          | undefined;
        const actionNode = findActionNode(triggerProps?.children);
        if (actionNode) {
          items.push(renderActionMenuButton(actionNode, contentProps?.children, items.length));
          return;
        }
      }

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
    applyViewState(view, view.id);
    setCurrentPage(1);
  };

  const reloadServerViews = () => {
    viewsAppliedOnceRef.current = false;
    reloadViews();
  };

  // A 403 means the caller's permission was downgraded mid-session; reload so the row
  // self-corrects (the helper still surfaces the inline error for this attempt).
  const handleViewCrudError = (err: unknown, messageKey: string) => {
    console.error('View operation failed', err);
    showViewError(t(messageKey));
    if (err instanceof ApiError && err.status === 403) reloadServerViews();
  };

  // Legacy mode is synchronous (localStorage). Server mode persists optimistically and
  // reverts on failure. Returns a promise so the modal can stay closed only after success.
  const saveView = async ({ name, hiddenColIds }: { name: string; hiddenColIds: string[] }) => {
    const hidden = normalizeHiddenColIdsForCurrentColumns(hiddenColIds);
    const editingView = modalState?.kind === 'edit' ? modalState.view : null;
    const editingId = editingView?.id ?? null;
    // The modal only edits name + visible columns. When editing an existing view, keep THAT view's
    // own sort/filter rather than snapshotting the live table state — otherwise a rename or column
    // tweak (reachable by shared write recipients) would silently overwrite the saved preset's
    // sort/filter for everyone. A brand-new view still snapshots the current table state.
    const savedSortState = editingView ? editingView.sortState : sortState;
    const savedFilterState = editingView ? editingView.filterState : filterState;

    if (!isServerBacked) {
      if (editingId) {
        updateCustomViews((prev) =>
          prev.map((v) =>
            v.id === editingId
              ? {
                  ...v,
                  name,
                  hiddenColIds: hidden,
                  sortState: savedSortState,
                  filterState: savedFilterState,
                }
              : v,
          ),
        );
        if (activeViewId === editingId) {
          dispatchTableView({ type: 'set-hidden-columns', hiddenColIds: new Set(hidden) });
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
        dispatchTableView({ type: 'set-hidden-columns', hiddenColIds: new Set(hidden) });
      }
      setModalState(null);
      return;
    }

    if (!viewKey || viewBusy) return;
    const config = customViewToConfig({
      hiddenColIds: hidden,
      sortState: savedSortState,
      filterState: savedFilterState,
    });
    setViewBusy(true);
    try {
      if (editingId) {
        const dto = await viewsApi.update(editingId, { name, config });
        const updated = serverViewToCustomView(dto);
        updateCustomViews((prev) => prev.map((v) => (v.id === editingId ? updated : v)));
        rememberServerViewMeta(dto);
        if (activeViewId === editingId) {
          dispatchTableView({ type: 'set-hidden-columns', hiddenColIds: new Set(hidden) });
        }
      } else {
        const dto = await viewsApi.create({ kind: 'table', scopeKey: viewKey, name, config });
        const created = serverViewToCustomView(dto);
        updateCustomViews((prev) => [...prev, created]);
        rememberServerViewMeta(dto);
        updateActiveViewId(created.id);
        dispatchTableView({ type: 'set-hidden-columns', hiddenColIds: new Set(hidden) });
      }
      setModalState(null);
    } catch (err) {
      // Modal stays open on failure so the user can retry without losing input.
      handleViewCrudError(err, 'views.saveFailed');
    } finally {
      setViewBusy(false);
    }
  };

  const deleteView = async (id: string) => {
    if (!isServerBacked) {
      updateCustomViews((prev) => prev.filter((v) => v.id !== id));
      if (activeViewId === id) updateActiveViewId(null);
      return;
    }

    if (viewBusy) return;
    // Optimistic removal; restore the snapshot if the request rejects.
    const snapshot = customViews;
    const wasActive = activeViewId === id;
    updateCustomViews((prev) => prev.filter((v) => v.id !== id));
    if (wasActive) updateActiveViewId(null);
    setViewBusy(true);
    try {
      await viewsApi.remove(id);
      setServerViewMeta((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      // Restore through updateCustomViews so the device-local ordering is rewritten too.
      updateCustomViews(() => snapshot);
      if (wasActive) updateActiveViewId(id);
      handleViewCrudError(err, 'views.deleteFailed');
    } finally {
      setViewBusy(false);
    }
  };

  // Fork the current view into a brand-new owned copy. The escape hatch that lets a
  // read recipient get an editable view of their own.
  const duplicateView = async (view: CustomView) => {
    if (!isServerBacked || !viewKey || viewBusy) return;
    const config = customViewToConfig(view);
    setViewBusy(true);
    try {
      const dto = await viewsApi.create({
        kind: 'table',
        scopeKey: viewKey,
        name: view.name,
        config,
      });
      const created = serverViewToCustomView(dto);
      updateCustomViews((prev) => [...prev, created]);
      rememberServerViewMeta(dto);
    } catch (err) {
      handleViewCrudError(err, 'views.saveFailed');
    } finally {
      setViewBusy(false);
    }
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

  const renderInternalFooter = () => {
    const isSinglePage = Math.max(totalPages, 1) <= 1;
    const canPreviousPage = !isSinglePage && table.getCanPreviousPage();
    const canNextPage = !isSinglePage && table.getCanNextPage();

    return (
      <>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
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
            <SelectTrigger
              size="sm"
              className={`${TABLE_CONTROL_BUTTON_CLASSNAME} w-[68px] text-foreground`}
            >
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
            className={TABLE_CONTROL_BUTTON_CLASSNAME}
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
            className={TABLE_CONTROL_BUTTON_CLASSNAME}
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

  return {
    t,
    title,
    totalLabel,
    headerExtras,
    headerAction,
    containerClassName,
    tableContainerClassName,
    externalFooter,
    footerClassName,
    children,
    emptyState,
    loadingState,
    data,
    columns,
    rowClassName,
    disabledRow,
    onRowClick,
    tableContainerRef,
    totalItems,
    shouldRenderTable,
    processedRows,
    handleExportToCsv,
    stepFontSize,
    fontSize,
    gearOpen,
    handleGearOpenChange,
    activeView,
    table,
    colsById,
    resetColumnVisibility,
    viewsSubmenuOpen,
    setViewsSubmenuOpen,
    customViews,
    isServerBacked,
    viewsLoading,
    viewsLoadFailed,
    reloadServerViews,
    copiedViewId,
    dragOverViewId,
    draggingViewId,
    setDraggingViewId,
    setDragOverViewId,
    reorderViews,
    moveViewByDelta,
    applyView,
    setGearOpen,
    getViewAccess,
    serverViewMeta,
    viewBusy,
    setModalState,
    normalizeViewForCurrentColumns,
    duplicateView,
    exportView,
    setShareModalView,
    deleteView,
    importView,
    viewError,
    fixedTableWidth,
    tableStretches,
    shouldAnchorTrailingActionColumn,
    hasTrailingSpacer,
    isRowActionColumn,
    getColumnMinWidth,
    getColId,
    getFilterOptions,
    filterSearchByColumnId,
    updateFilterSearch,
    clearFilterSearch,
    resetFilterPage,
    paginatedRows,
    openActionMenuRowId,
    setOpenActionMenuRowId,
    openContextMenuRowId,
    setOpenContextMenuRowId,
    fontSizeClass,
    renderActionMenuItems,
    paddingRowCount,
    bodyColSpan,
    emptyStateMinHeightPx,
    renderInternalFooter,
    modalState,
    saveView,
    modalColumns,
    hiddenColIds,
    shareModalView,
    pasteModalOpen,
    closePasteModal,
    pasteError,
    pasteText,
    setPasteText,
    setPasteError,
    submitPasteImport,
    activeViewId,
  };
};

type StandardTableController<T extends object> = ReturnType<typeof useStandardTableController<T>>;
type StandardTableHeaderInstance<T extends object> = ReturnType<
  StandardTableController<T>['table']['getHeaderGroups']
>[number]['headers'][number];
type StandardTableRowInstance<T extends object> =
  StandardTableController<T>['paginatedRows'][number];

const StandardTable = <T extends object>(props: StandardTableProps<T>) => {
  const controller = useStandardTableController(props);
  return <StandardTableLayout controller={controller} />;
};

const StandardTableLayout = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => (
  <div className={`w-full space-y-3 ${controller.containerClassName ?? ''}`.trim()}>
    <StandardTableHeader controller={controller} />
    <StandardTableShell controller={controller} />
    <StandardTableFooter controller={controller} />
    <StandardTableModals controller={controller} />
  </div>
);

const StandardTableHeader = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const { t, title, totalItems, totalLabel, headerExtras, headerAction, data, columns } =
    controller;

  return (
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
        {data != null && columns != null && <StandardTableToolbar controller={controller} />}
      </div>
    </div>
  );
};

const StandardTableToolbar = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const { t, handleExportToCsv, processedRows, stepFontSize, fontSize } = controller;

  return (
    <>
      <StandardTableToolbarButton
        label={t('table.exportToCsv')}
        iconClass="fa-file-export"
        onClick={handleExportToCsv}
        disabled={processedRows.length === 0}
        text={t('table.export')}
      />
      <StandardTableToolbarButton
        label={t('table.decreaseFont')}
        icon={<ZoomOut className="size-3.5" aria-hidden="true" />}
        onClick={() => stepFontSize(-1)}
        disabled={fontSize === 'xs'}
      />
      <StandardTableToolbarButton
        label={t('table.increaseFont')}
        icon={<ZoomIn className="size-3.5" aria-hidden="true" />}
        onClick={() => stepFontSize(1)}
        disabled={fontSize === 'base'}
      />
      <StandardTableColumnSettingsMenu controller={controller} />
    </>
  );
};

const StandardTableColumnSettingsMenu = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const { t, gearOpen, handleGearOpenChange, activeView, table, colsById, resetColumnVisibility } =
    controller;

  return (
    <DropdownMenu open={gearOpen} onOpenChange={handleGearOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          aria-label={t('table.columnSettings')}
          variant="outline"
          size="sm"
          className={`${TABLE_CONTROL_BUTTON_CLASSNAME} data-[state=open]:border-border data-[state=open]:bg-accent data-[state=open]:text-accent-foreground focus-visible:ring-0`}
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
        <StandardTableColumnVisibilityItems table={table} colsById={colsById} />
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
        <StandardTableViewsSubmenu controller={controller} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const StandardTableColumnVisibilityItems = <T extends object>({
  table,
  colsById,
}: {
  table: StandardTableController<T>['table'];
  colsById: StandardTableController<T>['colsById'];
}) => {
  const hideableColumns = table
    .getAllColumns()
    .filter((column) => column.getCanHide() && colsById.has(column.id));
  const visibleHideableColumnCount = table
    .getVisibleLeafColumns()
    .filter((visibleColumn) => visibleColumn.getCanHide()).length;

  return (
    <div className="max-h-64 overflow-y-auto">
      {hideableColumns.map((column) => {
        const sourceColumn = colsById.get(column.id);
        const isVisible = column.getIsVisible();
        const isLastVisible = visibleHideableColumnCount === 1 && isVisible;
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
  );
};

const StandardTableViewsSubmenu = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const {
    t,
    viewsSubmenuOpen,
    setViewsSubmenuOpen,
    customViews,
    isServerBacked,
    viewsLoading,
    viewsLoadFailed,
    reloadServerViews,
    viewBusy,
    setModalState,
    setGearOpen,
    importView,
    viewError,
  } = controller;

  return (
    <DropdownMenuSub open={viewsSubmenuOpen} onOpenChange={setViewsSubmenuOpen}>
      <DropdownMenuSubTrigger className="text-xs">
        <i className="fa-solid fa-layer-group text-[10px]" aria-hidden="true"></i>
        <span>{t('table.customViews')}</span>
        {customViews.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">{customViews.length}</span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72">
        <DropdownMenuLabel className="text-xs">{t('table.customViews')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isServerBacked && viewsLoading && <StandardTableViewsLoading controller={controller} />}
        {isServerBacked && viewsLoadFailed && !viewsLoading && (
          <StandardTableViewsLoadFailed t={t} onRetry={reloadServerViews} />
        )}
        {!(isServerBacked && (viewsLoading || viewsLoadFailed)) && customViews.length > 0 && (
          <div className="max-h-64 overflow-y-auto p-1">
            {customViews.map((view) => (
              <StandardTableViewRow key={view.id} controller={controller} view={view} />
            ))}
          </div>
        )}
        <DropdownMenuSeparator />
        <div className="flex gap-1 p-1">
          <DropdownMenuItem
            disabled={isServerBacked && (viewsLoading || viewBusy)}
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
          {!isServerBacked && (
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
          )}
        </div>
        {viewError && (
          <div role="alert" className="px-2 pb-2 text-center text-xs text-destructive">
            {viewError}
          </div>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

const StandardTableViewsLoading = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => (
  <output className="flex items-center justify-center gap-2 px-2 py-3 text-xs text-muted-foreground">
    <i className="fa-solid fa-circle-notch fa-spin text-[10px]" aria-hidden="true"></i>
    <span>{controller.t('views.loadingViews')}</span>
  </output>
);

const StandardTableViewsLoadFailed = ({
  t,
  onRetry,
}: {
  t: (key: string) => string;
  onRetry: () => void;
}) => (
  <div className="flex flex-col items-center gap-2 px-2 py-3 text-center">
    <span role="alert" className="text-xs text-destructive">
      {t('views.loadViewsFailed')}
    </span>
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={(e) => {
        e.stopPropagation();
        onRetry();
      }}
    >
      <i className="fa-solid fa-rotate-right text-[10px]" aria-hidden="true"></i>
      {t('views.retry')}
    </Button>
  </div>
);

const StandardTableViewRow = <T extends object>({
  controller,
  view,
}: {
  controller: StandardTableController<T>;
  view: CustomView;
}) => {
  const {
    t,
    activeViewId,
    copiedViewId,
    dragOverViewId,
    draggingViewId,
    setDraggingViewId,
    setDragOverViewId,
    reorderViews,
    moveViewByDelta,
    applyView,
    setGearOpen,
    isServerBacked,
    getViewAccess,
    serverViewMeta,
    viewBusy,
    setModalState,
    normalizeViewForCurrentColumns,
    duplicateView,
    exportView,
    setShareModalView,
    deleteView,
  } = controller;
  const isActive = view.id === activeViewId;
  const isCopied = copiedViewId === view.id;
  const isDragOver = dragOverViewId === view.id && draggingViewId !== view.id;
  const access = getViewAccess(view.id);
  const owned = access === 'owner';
  const editable = access === 'owner' || access === 'write';
  const ownerName = serverViewMeta.get(view.id)?.ownerName;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', view.name);
        setDraggingViewId(view.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (draggingViewId && draggingViewId !== view.id && dragOverViewId !== view.id) {
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
        if (draggingViewId) reorderViews(draggingViewId, view.id);
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
      <StandardTableViewDragHandle
        t={t}
        viewId={view.id}
        viewName={view.name}
        onMove={moveViewByDelta}
      />
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
        {isActive && <i className="fa-solid fa-check shrink-0 text-[10px]" aria-hidden="true"></i>}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-medium">{view.name}</span>
          {isServerBacked && !owned && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <ViewOwnerAvatar ownerName={ownerName ?? ''} />
              <span className="shrink-0 rounded-sm border border-border bg-muted px-1 leading-tight font-medium uppercase">
                {access === 'write' ? t('views.permissionWrite') : t('views.permissionRead')}
              </span>
            </span>
          )}
        </span>
      </button>
      <StandardTableViewActions
        t={t}
        owned={owned}
        editable={editable}
        isCopied={isCopied}
        isServerBacked={isServerBacked}
        viewBusy={viewBusy}
        onEdit={() => {
          setModalState({ kind: 'edit', view: normalizeViewForCurrentColumns(view) });
          setGearOpen(false);
        }}
        onDuplicate={() => {
          void duplicateView(view);
        }}
        onExport={() => {
          void exportView(view);
        }}
        onShare={() => {
          setShareModalView(view);
          setGearOpen(false);
        }}
        onDelete={() => {
          void deleteView(view.id);
        }}
      />
    </div>
  );
};

const StandardTableViewDragHandle = ({
  t,
  viewId,
  viewName,
  onMove,
}: {
  t: (key: string) => string;
  viewId: string;
  viewName: string;
  onMove: (id: string, delta: number) => void;
}) => (
  <button
    type="button"
    title={t('table.reorderViewHandle')}
    aria-label={`${t('table.reorderViewHandle')}: ${viewName}`}
    onClick={(e) => e.stopPropagation()}
    onKeyDown={(e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        onMove(viewId, -1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        onMove(viewId, 1);
      }
    }}
    className="flex size-6 shrink-0 cursor-move items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50"
  >
    <i className="fa-solid fa-grip-vertical text-[10px]" aria-hidden="true"></i>
  </button>
);

const StandardTableViewActions = ({
  t,
  owned,
  editable,
  isCopied,
  isServerBacked,
  viewBusy,
  onEdit,
  onDuplicate,
  onExport,
  onShare,
  onDelete,
}: {
  t: (key: string) => string;
  owned: boolean;
  editable: boolean;
  isCopied: boolean;
  isServerBacked: boolean;
  viewBusy: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onShare: () => void;
  onDelete: () => void;
}) => (
  <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
    {editable && (
      <DropdownMenuItem
        aria-label={t('table.renameView')}
        disabled={viewBusy}
        onSelect={(e) => {
          e.preventDefault();
          onEdit();
        }}
        className="size-7 justify-center p-0"
      >
        <i className="fa-solid fa-pen text-[10px]" aria-hidden="true"></i>
      </DropdownMenuItem>
    )}
    {isServerBacked ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuItem
            aria-label={t('views.duplicateView')}
            disabled={viewBusy}
            onSelect={(e) => {
              e.preventDefault();
              onDuplicate();
            }}
            className="size-7 justify-center p-0"
          >
            <i className="fa-solid fa-clone text-[10px]" aria-hidden="true"></i>
          </DropdownMenuItem>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('views.duplicateView')}</TooltipContent>
      </Tooltip>
    ) : (
      <DropdownMenuItem
        aria-label={isCopied ? t('table.viewCopied') : t('table.exportView')}
        onSelect={(e) => {
          e.preventDefault();
          onExport();
        }}
        className="size-7 justify-center p-0"
      >
        <i
          className={`fa-solid ${isCopied ? 'fa-check' : 'fa-copy'} text-[10px]`}
          aria-hidden="true"
        ></i>
      </DropdownMenuItem>
    )}
    {isServerBacked && owned && (
      <DropdownMenuItem
        aria-label={t('views.shareView')}
        disabled={viewBusy}
        onSelect={(e) => {
          e.preventDefault();
          onShare();
        }}
        className="size-7 justify-center p-0"
      >
        <i className="fa-solid fa-share-nodes text-[10px]" aria-hidden="true"></i>
      </DropdownMenuItem>
    )}
    {owned && (
      <DropdownMenuItem
        aria-label={t('table.deleteView')}
        variant="destructive"
        disabled={viewBusy}
        onSelect={(e) => {
          e.preventDefault();
          onDelete();
        }}
        className="size-7 justify-center p-0"
      >
        <i className="fa-solid fa-trash text-[10px]" aria-hidden="true"></i>
      </DropdownMenuItem>
    )}
  </div>
);

const StandardTableShell = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const { tableContainerRef, tableContainerClassName, shouldRenderTable, loadingState, children } =
    controller;

  return (
    <div
      ref={tableContainerRef}
      className={`rounded-lg border border-border bg-background shadow-sm ${
        tableContainerClassName ?? 'overflow-x-auto'
      }`}
    >
      {shouldRenderTable ? (
        <StandardTableGrid controller={controller} />
      ) : (
        (loadingState ?? children)
      )}
    </div>
  );
};

const StandardTableGrid = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const { fixedTableWidth, tableStretches } = controller;

  return (
    <Table
      className="table-fixed text-left"
      style={
        fixedTableWidth
          ? {
              width: tableStretches ? '100%' : `${fixedTableWidth}px`,
              minWidth: tableStretches ? `${fixedTableWidth}px` : undefined,
            }
          : undefined
      }
    >
      <StandardTableColGroup controller={controller} />
      <StandardTableHeaderRows controller={controller} />
      <StandardTableBodyRows controller={controller} />
    </Table>
  );
};

const StandardTableColGroup = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const {
    table,
    colsById,
    shouldAnchorTrailingActionColumn,
    hasTrailingSpacer,
    isRowActionColumn,
  } = controller;

  return (
    <colgroup>
      {table.getVisibleLeafColumns().map((column) => {
        const col = colsById.get(column.id);
        const colWidth = column.getSize();
        const needsActionSpacer = shouldAnchorTrailingActionColumn && col && isRowActionColumn(col);
        return (
          <Fragment key={column.id}>
            {needsActionSpacer && <col data-action-spacer style={{ width: 'auto' }} />}
            <col style={{ width: colWidth }} />
          </Fragment>
        );
      })}
      {hasTrailingSpacer && <col data-trailing-spacer style={{ width: 'auto' }} />}
    </colgroup>
  );
};

const StandardTableHeaderRows = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => (
  <TableHeader>
    {controller.table.getHeaderGroups().map((headerGroup) => (
      <TableRow key={headerGroup.id} className="border-border hover:bg-transparent">
        {headerGroup.headers.map((header, colIdx) => (
          <StandardTableHeaderCell
            key={header.id}
            controller={controller}
            header={header}
            colIdx={colIdx}
            headerCount={headerGroup.headers.length}
          />
        ))}
        {controller.hasTrailingSpacer && (
          <TableHead
            aria-hidden="true"
            style={{ width: 'auto', minWidth: 0 }}
            className="h-10 border-border p-0"
          />
        )}
      </TableRow>
    ))}
  </TableHeader>
);

const StandardTableHeaderCell = <T extends object>({
  controller,
  header,
  colIdx,
  headerCount,
}: {
  controller: StandardTableController<T>;
  header: StandardTableHeaderInstance<T>;
  colIdx: number;
  headerCount: number;
}) => {
  const {
    colsById,
    getColId,
    isRowActionColumn,
    shouldAnchorTrailingActionColumn,
    hasTrailingSpacer,
    getColumnMinWidth,
    getFilterOptions,
    filterSearchByColumnId,
    updateFilterSearch,
    clearFilterSearch,
    resetFilterPage,
  } = controller;
  const col = colsById.get(header.column.id);
  if (!col) return null;
  const colId = getColId(col);
  const isActionColumn = isRowActionColumn(col);
  const isStickyRightColumn = col.sticky === 'right' || isActionColumn;
  const isFirstColumn = colIdx === 0;
  const isLastColumn = colIdx === headerCount - 1;
  const isBeforeActionSpacer =
    shouldAnchorTrailingActionColumn && !isActionColumn && colIdx === headerCount - 2;
  const isBeforeTrailingSpacer = hasTrailingSpacer && colIdx === headerCount - 1;
  const effectiveAlign = col.align ?? (isFirstColumn ? 'left' : isLastColumn ? 'right' : undefined);
  const minColumnWidth = getColumnMinWidth(col);
  const colWidth = Math.max(header.getSize(), minColumnWidth);
  const sorted = header.column.getIsSorted();
  const isResizing = header.column.getIsResizing();
  const stickyBorderClass = isStickyRightColumn && !isActionColumn ? 'border-l border-border' : '';
  const resizeHandler = header.getResizeHandler();

  return (
    <Fragment>
      {shouldAnchorTrailingActionColumn && isActionColumn && (
        <TableHead
          aria-hidden="true"
          style={{ width: 'auto', minWidth: 0 }}
          className="h-10 border-border p-0"
        />
      )}
      <TableHead
        style={{ width: colWidth, minWidth: minColumnWidth }}
        aria-label={isActionColumn ? col.header : undefined}
        className={`relative group h-10 border-border ${
          isLastColumn ? 'pl-3 pr-2' : 'px-3'
        } whitespace-nowrap ${
          effectiveAlign === 'right'
            ? 'text-right'
            : effectiveAlign === 'center'
              ? 'text-center'
              : ''
        } ${
          isStickyRightColumn ? `sticky right-0 z-20 bg-background ${stickyBorderClass}` : ''
        } ${col.headerClassName || ''}`}
      >
        {isActionColumn ? (
          <StandardTableActionHeader header={header} colId={colId} />
        ) : (
          <StandardTableSortableHeader
            controller={controller}
            header={header}
            col={col}
            colId={colId}
            sorted={sorted}
            filterSearch={filterSearchByColumnId[header.column.id] ?? ''}
            filterOptions={getFilterOptions(header.column.id)}
            onFilterSearchChange={updateFilterSearch}
            onFilterSearchClose={clearFilterSearch}
            onResetPage={resetFilterPage}
          />
        )}
        {header.column.getCanResize() && (
          <button
            type="button"
            aria-label="Resize column"
            className="absolute top-0 right-0 z-10 flex h-full w-2 cursor-col-resize touch-none select-none items-center justify-end border-0 bg-transparent p-0"
            data-column-resize-handle={colId}
            onMouseDown={(event) => {
              event.stopPropagation();
              resizeHandler(event);
            }}
            onTouchStart={(event) => {
              event.stopPropagation();
              resizeHandler(event);
            }}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <span
              data-column-resize-line={colId}
              className={`h-5 w-px rounded-full transition-colors ${
                isBeforeActionSpacer || isBeforeTrailingSpacer
                  ? 'bg-transparent'
                  : isResizing
                    ? 'bg-primary'
                    : 'bg-border group-hover:bg-primary/40'
              }`}
            />
          </button>
        )}
      </TableHead>
    </Fragment>
  );
};

const StandardTableActionHeader = <T extends object>({
  header,
  colId,
}: {
  header: StandardTableHeaderInstance<T>;
  colId: string;
}) => (
  <div data-column-header-content={colId} className="inline-flex w-max items-center gap-1">
    <span
      className="whitespace-nowrap text-sm font-semibold text-foreground"
      data-column-header-label={colId}
    >
      {header.isPlaceholder
        ? null
        : flexRender(header.column.columnDef.header, header.getContext())}
    </span>
  </div>
);

const StandardTableSortableHeader = <T extends object>({
  controller,
  header,
  col,
  colId,
  sorted,
  filterSearch,
  filterOptions,
  onFilterSearchChange,
  onFilterSearchClose,
  onResetPage,
}: {
  controller: StandardTableController<T>;
  header: StandardTableHeaderInstance<T>;
  col: Column<T>;
  colId: string;
  sorted: false | 'asc' | 'desc';
  filterSearch: string;
  filterOptions: string[];
  onFilterSearchChange: (columnId: string, value: string) => void;
  onFilterSearchClose: (columnId: string) => void;
  onResetPage: () => void;
}) => (
  <div data-column-header-content={colId} className="inline-flex w-max items-center gap-1">
    <button
      type="button"
      disabled={!header.column.getCanSort()}
      onClick={header.column.getToggleSortingHandler()}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 -ml-2 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-100"
    >
      <span className="whitespace-nowrap" data-column-header-label={colId}>
        {header.isPlaceholder
          ? null
          : flexRender(header.column.columnDef.header, header.getContext())}
      </span>
      {sorted === 'asc' ? (
        <ArrowUp className="size-3 shrink-0 transition-colors" aria-hidden="true" />
      ) : sorted === 'desc' ? (
        <ArrowDown className="size-3 shrink-0 transition-colors" aria-hidden="true" />
      ) : (
        <ArrowUpDown className="size-3 shrink-0 transition-colors" aria-hidden="true" />
      )}
    </button>
    <HeaderFilter
      column={header.column}
      sourceColumn={col}
      options={filterOptions}
      filterSearch={filterSearch}
      t={controller.t}
      onFilterSearchChange={onFilterSearchChange}
      onFilterSearchClose={onFilterSearchClose}
      onResetPage={onResetPage}
    />
  </div>
);

const StandardTableBodyRows = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const { paginatedRows, paddingRowCount, bodyColSpan, emptyState, emptyStateMinHeightPx, t } =
    controller;

  return (
    <TableBody>
      {paginatedRows.length > 0 ? (
        <>
          {paginatedRows.map((tableRow) => (
            <StandardTableDataRow key={tableRow.id} controller={controller} tableRow={tableRow} />
          ))}
          {Array.from({ length: paddingRowCount }).map((_, idx) => (
            <TableRow
              key={`__padding-${idx}`}
              aria-hidden="true"
              className="pointer-events-none hover:bg-transparent"
            >
              <TableCell colSpan={bodyColSpan} className="h-11 p-0" />
            </TableRow>
          ))}
        </>
      ) : (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={bodyColSpan} className="p-0">
            {emptyState ? (
              <div
                className="flex w-full items-center justify-center"
                style={{ minHeight: emptyStateMinHeightPx }}
              >
                {emptyState}
              </div>
            ) : (
              <Empty style={{ minHeight: emptyStateMinHeightPx }}>
                <EmptyHeader>
                  <EmptyTitle className="text-sm font-medium text-muted-foreground">
                    {t('table.noResults')}
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
};

const StandardTableDataRow = <T extends object>({
  controller,
  tableRow,
}: {
  controller: StandardTableController<T>;
  tableRow: StandardTableRowInstance<T>;
}) => {
  const {
    colsById,
    isRowActionColumn,
    renderActionMenuItems,
    openActionMenuRowId,
    openContextMenuRowId,
    setOpenContextMenuRowId,
  } = controller;
  const row = tableRow.original;
  const visibleCells = tableRow.getVisibleCells();
  const rowActionCell = visibleCells.find((cell) => {
    const col = colsById.get(cell.column.id);
    return col ? isRowActionColumn(col) : false;
  });
  const rowActionColumn = rowActionCell ? colsById.get(rowActionCell.column.id) : undefined;
  const rowActionValue = rowActionCell?.getValue() as
    | T[keyof T]
    | string
    | number
    | boolean
    | null
    | undefined;
  const rowActionContent = rowActionCell
    ? rowActionColumn?.cell
      ? rowActionColumn.cell({ getValue: () => rowActionValue, row, value: rowActionValue })
      : flexRender(rowActionCell.column.columnDef.cell, rowActionCell.getContext())
    : null;
  const rowActionMenuItems = hasActionMenuItems(rowActionContent)
    ? renderActionMenuItems(rowActionContent)
    : null;
  const isActionMenuOpen = openActionMenuRowId === tableRow.id;
  const isContextMenuOpen = openContextMenuRowId === tableRow.id;
  const rowElement = (
    <StandardTableDataRowElement
      controller={controller}
      tableRow={tableRow}
      rowActionCellId={rowActionCell?.id}
      rowActionContent={rowActionContent}
      rowActionMenuItems={rowActionMenuItems}
      isActionMenuOpen={isActionMenuOpen}
    />
  );

  return rowActionMenuItems ? (
    <ContextMenu onOpenChange={(open) => setOpenContextMenuRowId(open ? tableRow.id : null)}>
      <ContextMenuTrigger
        asChild
        onContextMenu={() => {
          setOpenContextMenuRowId(tableRow.id);
        }}
      >
        {rowElement}
      </ContextMenuTrigger>
      {isContextMenuOpen && (
        <ContextMenuContent
          forceMount
          data-standard-table-action-menu="true"
          className={ACTION_MENU_CONTENT_CLASSNAME}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <div className={ACTION_MENU_ITEMS_CLASSNAME}>{rowActionMenuItems}</div>
        </ContextMenuContent>
      )}
    </ContextMenu>
  ) : (
    rowElement
  );
};

const StandardTableDataRowElement = <T extends object>({
  controller,
  tableRow,
  rowActionCellId,
  rowActionContent,
  rowActionMenuItems,
  isActionMenuOpen,
  ...rowProps
}: {
  controller: StandardTableController<T>;
  tableRow: StandardTableRowInstance<T>;
  rowActionCellId: string | undefined;
  rowActionContent: ReactNode;
  rowActionMenuItems: ReactNode;
  isActionMenuOpen: boolean;
} & React.ComponentProps<typeof TableRow>) => {
  const {
    disabledRow,
    onRowClick,
    fontSizeClass,
    rowClassName,
    hasTrailingSpacer,
    setOpenContextMenuRowId,
  } = controller;
  const row = tableRow.original;
  const visibleCells = tableRow.getVisibleCells();

  return (
    <TableRow
      {...rowProps}
      onClick={(event) => {
        rowProps.onClick?.(event);
        if (!event.defaultPrevented && !disabledRow?.(row)) onRowClick?.(row);
      }}
      onContextMenuCapture={(event) => {
        rowProps.onContextMenuCapture?.(event);
        if (rowActionMenuItems) setOpenContextMenuRowId(tableRow.id);
      }}
      onContextMenu={(event) => {
        rowProps.onContextMenu?.(event);
        if (rowActionMenuItems) setOpenContextMenuRowId(tableRow.id);
      }}
      className={`${rowProps.className ?? ''} group border-border transition-colors ${fontSizeClass} ${
        disabledRow?.(row)
          ? 'bg-muted text-muted-foreground opacity-70'
          : `${onRowClick ? 'cursor-pointer' : ''} ${rowClassName ? rowClassName(row) : 'hover:bg-muted/50'}`
      }`}
    >
      {visibleCells.map((cell, colIdx) => (
        <StandardTableDataCell
          key={cell.id}
          controller={controller}
          cell={cell}
          colIdx={colIdx}
          visibleCellCount={visibleCells.length}
          row={row}
          rowActionCellId={rowActionCellId}
          rowActionContent={rowActionContent}
          rowActionMenuItems={rowActionMenuItems}
          isActionMenuOpen={isActionMenuOpen}
          tableRowId={tableRow.id}
        />
      ))}
      {hasTrailingSpacer && (
        <TableCell
          aria-hidden="true"
          style={{ width: 'auto', minWidth: 0 }}
          className="border-border p-0"
        />
      )}
    </TableRow>
  );
};

const StandardTableDataCell = <T extends object>({
  controller,
  cell,
  colIdx,
  visibleCellCount,
  row,
  rowActionCellId,
  rowActionContent,
  rowActionMenuItems,
  isActionMenuOpen,
  tableRowId,
}: {
  controller: StandardTableController<T>;
  cell: ReturnType<StandardTableRowInstance<T>['getVisibleCells']>[number];
  colIdx: number;
  visibleCellCount: number;
  row: T;
  rowActionCellId: string | undefined;
  rowActionContent: ReactNode;
  rowActionMenuItems: ReactNode;
  isActionMenuOpen: boolean;
  tableRowId: string;
}) => {
  const {
    t,
    colsById,
    isRowActionColumn,
    shouldAnchorTrailingActionColumn,
    getColumnMinWidth,
    setOpenActionMenuRowId,
  } = controller;
  const colId = cell.column.id;
  const col = colsById.get(colId);
  if (!col) return null;
  const isActionColumn = isRowActionColumn(col);
  const isStickyRightColumn = col.sticky === 'right' || isActionColumn;
  const isFirstColumn = colIdx === 0;
  const isLastColumn = colIdx === visibleCellCount - 1;
  const effectiveAlign = col.align ?? (isFirstColumn ? 'left' : isLastColumn ? 'right' : undefined);
  const minColumnWidth = getColumnMinWidth(col);
  const colWidth = Math.max(cell.column.getSize(), minColumnWidth);
  const stickyBorderClass = isStickyRightColumn && !isActionColumn ? 'border-l border-border' : '';
  const stickyHoverClass = isStickyRightColumn && !isActionColumn ? 'group-hover:bg-muted/50' : '';
  const rawValue = cell.getValue() as T[keyof T] | string | number | boolean | null | undefined;
  const cellContent =
    isActionColumn && cell.id === rowActionCellId
      ? rowActionContent
      : col.cell
        ? col.cell({ getValue: () => rawValue, row, value: rawValue })
        : flexRender(cell.column.columnDef.cell, cell.getContext());
  const actionMenuItems = isActionColumn ? rowActionMenuItems : null;

  return (
    <Fragment>
      {shouldAnchorTrailingActionColumn && isActionColumn && (
        <TableCell
          aria-hidden="true"
          style={{ width: 'auto', minWidth: 0 }}
          className="border-border p-0"
        />
      )}
      <TableCell
        onDoubleClick={(e) => {
          e.stopPropagation();
          col.onCellDoubleClick?.(row);
        }}
        style={{ width: colWidth, minWidth: minColumnWidth }}
        className={`${isLastColumn ? 'pl-3 pr-2' : 'px-3'} py-2 whitespace-nowrap ${
          !isActionColumn
            ? 'standard-table-value-cell max-w-0 overflow-hidden text-ellipsis font-normal'
            : ''
        } ${
          isStickyRightColumn
            ? 'w-auto text-right'
            : `align-middle ${
                effectiveAlign === 'right'
                  ? 'text-right'
                  : effectiveAlign === 'center'
                    ? 'text-center'
                    : ''
              }`
        } ${
          isStickyRightColumn
            ? `sticky right-0 z-20 bg-background transition-colors ${stickyBorderClass} ${stickyHoverClass}`
            : ''
        } ${col.className || ''}`}
      >
        {isActionColumn ? (
          actionMenuItems ? (
            <DropdownMenu
              open={isActionMenuOpen}
              onOpenChange={(open) => setOpenActionMenuRowId(open ? tableRowId : null)}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('table.rowActions')}
                  onClick={(event) => event.stopPropagation()}
                  className="rounded-lg"
                >
                  <i className="fa-solid fa-ellipsis text-[10px]" aria-hidden="true"></i>
                </Button>
              </DropdownMenuTrigger>
              {isActionMenuOpen && (
                <DropdownMenuContent
                  align="end"
                  data-standard-table-action-menu="true"
                  className={ACTION_MENU_CONTENT_CLASSNAME}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <div className={ACTION_MENU_ITEMS_CLASSNAME}>{actionMenuItems}</div>
                </DropdownMenuContent>
              )}
            </DropdownMenu>
          ) : null
        ) : (
          cellContent
        )}
      </TableCell>
    </Fragment>
  );
};

const StandardTableFooter = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const { externalFooter, data, columns, footerClassName, renderInternalFooter } = controller;
  if (!(externalFooter || (data && columns))) return null;

  return (
    <div
      className={`py-1 ${footerClassName ?? 'flex justify-between items-center flex-wrap gap-4'}`}
    >
      {data && columns ? renderInternalFooter() : externalFooter}
    </div>
  );
};

const StandardTableModals = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const { data, columns, isServerBacked, pasteModalOpen } = controller;

  return (
    <>
      {data && columns && <StandardTableCustomViewModal controller={controller} />}
      {isServerBacked && <StandardTableShareViewModal controller={controller} />}
      {data && columns && pasteModalOpen && <StandardTablePasteViewModal controller={controller} />}
    </>
  );
};

const StandardTableCustomViewModal = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const { modalState, setModalState, saveView, modalColumns, hiddenColIds } = controller;

  return (
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
      onSave={(view) => {
        void saveView(view);
      }}
      columns={modalColumns}
      initialHiddenColIds={hiddenColIds}
      editingView={modalState?.kind === 'edit' ? modalState.view : undefined}
    />
  );
};

const StandardTableShareViewModal = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const { shareModalView, setShareModalView } = controller;

  return (
    <ShareViewModal
      isOpen={shareModalView !== null}
      onClose={() => setShareModalView(null)}
      viewId={shareModalView?.id ?? ''}
      viewName={shareModalView?.name ?? ''}
    />
  );
};

const StandardTablePasteViewModal = <T extends object>({
  controller,
}: {
  controller: StandardTableController<T>;
}) => {
  const {
    t,
    pasteModalOpen,
    closePasteModal,
    pasteError,
    pasteText,
    setPasteText,
    setPasteError,
    submitPasteImport,
  } = controller;

  return (
    <Modal isOpen={pasteModalOpen} onClose={closePasteModal} ariaLabel={null}>
      <ModalContent size="md">
        <ModalHeader>
          <ModalTitle>
            <i className="fa-solid fa-file-import text-primary"></i>
            {t('table.pasteViewTitle')}
          </ModalTitle>
          <ModalCloseButton onClick={closePasteModal} />
        </ModalHeader>
        <ModalBody className="space-y-3">
          <ModalDescription>{t('table.pasteViewDescription')}</ModalDescription>
          <Field data-invalid={Boolean(pasteError)}>
            <FieldLabel htmlFor="custom-view-import-payload" className="sr-only">
              {t('table.pasteViewTitle')}
            </FieldLabel>
            <Textarea
              id="custom-view-import-payload"
              value={pasteText}
              onChange={(e) => {
                setPasteText(e.target.value);
                if (pasteError) setPasteError(null);
              }}
              placeholder={t('table.pasteViewPlaceholder')}
              rows={6}
              aria-invalid={Boolean(pasteError)}
              className="resize-y font-mono text-xs"
            />
            {pasteError && (
              <FieldError role="alert" className="text-xs">
                {pasteError}
              </FieldError>
            )}
          </Field>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={closePasteModal}>
            {t('table.cancel')}
          </Button>
          <Button
            type="button"
            onClick={submitPasteImport}
            disabled={pasteText.trim().length === 0}
          >
            {t('table.importView')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default StandardTable;
