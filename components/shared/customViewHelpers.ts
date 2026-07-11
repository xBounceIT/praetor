export type SortState = { colId: string; px: 'asc' | 'desc'; legacyColId?: string } | null;
export type FilterState = Record<string, string[]>;

export type CustomView = {
  id: string;
  name: string;
  hiddenColIds: string[];
  columnOrder: string[];
  sortState: SortState;
  filterState: FilterState;
};

export type LegacyFilterColumnAlias = {
  columnId: string;
  mapValue?: (value: string, legacyColumnId: string) => string | null | undefined;
};

export type ViewApplicationColumnAliases = {
  hiddenColumnAliases?: ReadonlyMap<string, readonly string[]>;
  sortColumnAliases?: ReadonlyMap<string, string>;
  filterColumnAliases?: ReadonlyMap<string, readonly LegacyFilterColumnAlias[]>;
};

const LEGACY_FILTER_VALUE_PREFIX = '__praetor_legacy_filter__:';

export const encodeLegacyFilterValue = (legacyColumnId: string, value: string) =>
  `${LEGACY_FILTER_VALUE_PREFIX}${encodeURIComponent(legacyColumnId)}:${encodeURIComponent(value)}`;

export const decodeLegacyFilterValue = (
  value: string,
): { legacyColumnId: string; value: string } | null => {
  if (!value.startsWith(LEGACY_FILTER_VALUE_PREFIX)) return null;
  const payload = value.slice(LEGACY_FILTER_VALUE_PREFIX.length);
  const separatorIndex = payload.indexOf(':');
  if (separatorIndex === -1) return null;
  try {
    return {
      legacyColumnId: decodeURIComponent(payload.slice(0, separatorIndex)),
      value: decodeURIComponent(payload.slice(separatorIndex + 1)),
    };
  } catch {
    return null;
  }
};

// Cap on imported clipboard payload size: keeps a malicious/accidental huge
// payload from being JSON-parsed and persisted to localStorage.
export const IMPORT_PAYLOAD_MAX_BYTES = 100_000;

// `crypto.randomUUID()` is gated to secure contexts (HTTPS / localhost), so it
// throws on plain-HTTP LAN IPs. Fall back to `getRandomValues` (available in
// non-secure contexts) and finally to `Math.random()`. Used only as a local
// table-state key, no security guarantees needed beyond uniqueness.
export const generateViewId = (): string => {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      try {
        return crypto.randomUUID();
      } catch {}
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }
  return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const isValidImportedView = (
  v: unknown,
): v is {
  name: string;
  hiddenColIds: string[];
  columnOrder?: string[];
  sortState?: unknown;
  filterState?: unknown;
} => {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.trim() === '') return false;
  if (!Array.isArray(obj.hiddenColIds)) return false;
  if (!obj.hiddenColIds.every((id) => typeof id === 'string')) return false;
  if (
    obj.columnOrder !== undefined &&
    (!Array.isArray(obj.columnOrder) || !obj.columnOrder.every((id) => typeof id === 'string'))
  ) {
    return false;
  }
  return true;
};

export const isValidStoredView = (
  v: unknown,
): v is {
  id: string;
  name: string;
  hiddenColIds: string[];
  columnOrder?: string[];
  sortState?: unknown;
  filterState?: unknown;
} => {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id === '') return false;
  if (typeof obj.name !== 'string' || obj.name.trim() === '') return false;
  if (!Array.isArray(obj.hiddenColIds)) return false;
  if (!obj.hiddenColIds.every((id) => typeof id === 'string')) return false;
  if (
    obj.columnOrder !== undefined &&
    (!Array.isArray(obj.columnOrder) || !obj.columnOrder.every((id) => typeof id === 'string'))
  ) {
    return false;
  }
  return true;
};

export const parseColumnOrder = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

export const normalizeColumnOrder = (
  raw: unknown,
  validColumnIds: ReadonlySet<string>,
): string[] => {
  const result = parseColumnOrder(raw).filter((id) => validColumnIds.has(id));
  const seen = new Set(result);
  for (const id of validColumnIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

export const parseSortState = (raw: unknown): SortState => {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.colId !== 'string') return null;
  if (o.px !== 'asc' && o.px !== 'desc') return null;
  const sortState: NonNullable<SortState> = { colId: o.colId, px: o.px };
  if (typeof o.legacyColId === 'string' && o.legacyColId !== '') {
    sortState.legacyColId = o.legacyColId;
  }
  return sortState;
};

export const filterStatesEqual = (a: FilterState, b: FilterState): boolean => {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    const va = a[k];
    const vb = b[k];
    if (!vb || va.length !== vb.length) return false;
    for (let i = 0; i < va.length; i++) {
      if (va[i] !== vb[i]) return false;
    }
  }
  return true;
};

// Empty arrays are dropped to match the in-memory shape: `handleFilter`
// deletes the key when no values are selected, so persisted/imported views
// shouldn't reintroduce `{ col: [] }` entries that would later make
// `filterStatesEqual` falsely report dirty state on parent re-renders.
export const parseFilterState = (raw: unknown): FilterState => {
  if (!raw || typeof raw !== 'object') return {};
  const result: FilterState = {};
  Object.entries(raw as Record<string, unknown>).forEach(([k, v]) => {
    if (Array.isArray(v) && v.length > 0 && v.every((item) => typeof item === 'string')) {
      result[k] = v;
    }
  });
  return result;
};

export const parseStoredViews = (raw: string | null): CustomView[] => {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const views: CustomView[] = [];
  for (const value of parsed) {
    if (!isValidStoredView(value)) continue;
    views.push({
      id: value.id,
      name: value.name,
      hiddenColIds: value.hiddenColIds,
      columnOrder: parseColumnOrder(value.columnOrder),
      sortState: parseSortState(value.sortState),
      filterState: parseFilterState(value.filterState),
    });
  }
  return views;
};

// `gearColIds` gates hidden-column toggles (only gear-visible columns can be
// hidden); `allColIds` gates sort/filter, which can target statically-hidden
// filter-only columns too; `reorderableColIds` can further exclude pinned
// columns while defaulting to the gear columns for existing callers.
export const computeViewApplication = (
  view: CustomView,
  gearColIds: ReadonlySet<string>,
  allColIds: ReadonlySet<string>,
  columnAliases?: ViewApplicationColumnAliases,
  reorderableColIds: ReadonlySet<string> = gearColIds,
): {
  hiddenColIds: Set<string>;
  columnOrder: string[];
  sortState: SortState;
  filterState: FilterState;
} => {
  const hiddenColIds = new Set<string>();
  for (const id of view.hiddenColIds) {
    if (gearColIds.has(id)) {
      hiddenColIds.add(id);
      continue;
    }
    for (const mappedId of columnAliases?.hiddenColumnAliases?.get(id) ?? []) {
      if (gearColIds.has(mappedId)) hiddenColIds.add(mappedId);
    }
  }

  let sortState: SortState = null;
  if (view.sortState) {
    const isCurrentSortColumn = allColIds.has(view.sortState.colId);
    const mappedSortColId = isCurrentSortColumn
      ? view.sortState.colId
      : columnAliases?.sortColumnAliases?.get(view.sortState.colId);
    if (mappedSortColId && allColIds.has(mappedSortColId)) {
      const nextSortState = { ...view.sortState, colId: mappedSortColId };
      if (!isCurrentSortColumn && !nextSortState.legacyColId) {
        nextSortState.legacyColId = view.sortState.colId;
      }
      sortState = nextSortState;
    }
  }

  const filterState: FilterState = {};
  Object.entries(view.filterState ?? {}).forEach(([k, v]) => {
    if (allColIds.has(k)) {
      filterState[k] = v;
      return;
    }
    for (const alias of columnAliases?.filterColumnAliases?.get(k) ?? []) {
      if (!allColIds.has(alias.columnId)) continue;
      const mappedValues = v
        .map((value) => (alias.mapValue ? alias.mapValue(value, k) : value))
        .filter((value): value is string => typeof value === 'string');
      if (mappedValues.length === 0) continue;
      const existingValues = filterState[alias.columnId] ?? [];
      const existingValueSet = new Set(existingValues);
      for (const mappedValue of mappedValues) {
        const legacyValue = encodeLegacyFilterValue(k, mappedValue);
        if (existingValueSet.has(legacyValue)) continue;
        existingValueSet.add(legacyValue);
        existingValues.push(legacyValue);
      }
      filterState[alias.columnId] = existingValues;
    }
  });
  return {
    hiddenColIds,
    columnOrder: normalizeColumnOrder(view.columnOrder, reorderableColIds),
    sortState,
    filterState,
  };
};

export type DropPosition = 'before' | 'after';

export const getDirectionalDropPosition = (
  columnOrder: string[],
  draggingColumnId: string,
  targetColumnId: string,
): DropPosition =>
  columnOrder.indexOf(draggingColumnId) < columnOrder.indexOf(targetColumnId) ? 'after' : 'before';

export const reorderRelative = <T>(
  arr: T[],
  fromIdx: number,
  toIdx: number,
  position: DropPosition,
): T[] => {
  if (fromIdx === toIdx) return arr;
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= arr.length || toIdx >= arr.length) return arr;
  const next = [...arr];
  const [moved] = next.splice(fromIdx, 1);
  const adjustedTargetIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
  const insertIdx = adjustedTargetIdx + (position === 'after' ? 1 : 0);
  next.splice(insertIdx, 0, moved);
  if (next.every((value, index) => value === arr[index])) return arr;
  return next;
};

// Drop above the target. After splice removes the source, a forward move's
// target index has shifted down by one, so subtract - this matches the
// border-t indicator's "drop above" semantics for both upward and downward
// drags. Returns the same reference when the move is a no-op (same index, or
// out-of-bounds), so callers can short-circuit re-renders.
export const reorderDropAbove = <T>(arr: T[], fromIdx: number, toIdx: number): T[] => {
  if (fromIdx === toIdx) return arr;
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= arr.length || toIdx >= arr.length) return arr;
  const next = [...arr];
  const [moved] = next.splice(fromIdx, 1);
  const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
  next.splice(insertIdx, 0, moved);
  return next;
};

// Single-step neighbor swap used by the keyboard reorder (ArrowUp / ArrowDown).
// Returns the same reference when the move is a no-op (out of bounds), so
// callers can short-circuit re-renders.
export const moveByDelta = <T>(arr: T[], idx: number, delta: number): T[] => {
  const target = idx + delta;
  if (idx === -1 || target < 0 || target >= arr.length) return arr;
  const next = [...arr];
  const [moved] = next.splice(idx, 1);
  next.splice(target, 0, moved);
  return next;
};
