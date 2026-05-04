export type SortState = { colId: string; px: 'asc' | 'desc' } | null;
export type FilterState = Record<string, string[]>;

export type CustomView = {
  id: string;
  name: string;
  hiddenColIds: string[];
  sortState: SortState;
  filterState: FilterState;
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
): v is { name: string; hiddenColIds: string[]; sortState?: unknown; filterState?: unknown } => {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.trim() === '') return false;
  if (!Array.isArray(obj.hiddenColIds)) return false;
  if (!obj.hiddenColIds.every((id) => typeof id === 'string')) return false;
  return true;
};

export const isValidStoredView = (
  v: unknown,
): v is { id: string; name: string; hiddenColIds: string[] } => {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id === '') return false;
  if (typeof obj.name !== 'string' || obj.name.trim() === '') return false;
  if (!Array.isArray(obj.hiddenColIds)) return false;
  if (!obj.hiddenColIds.every((id) => typeof id === 'string')) return false;
  return true;
};

export const parseSortState = (raw: unknown): SortState => {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.colId !== 'string') return null;
  if (o.px !== 'asc' && o.px !== 'desc') return null;
  return { colId: o.colId, px: o.px };
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

export const parseFilterState = (raw: unknown): FilterState => {
  if (!raw || typeof raw !== 'object') return {};
  const result: FilterState = {};
  Object.entries(raw as Record<string, unknown>).forEach(([k, v]) => {
    if (Array.isArray(v) && v.every((item) => typeof item === 'string')) {
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
  return parsed.filter(isValidStoredView).map((v) => {
    const obj = v as Record<string, unknown>;
    return {
      id: v.id,
      name: v.name,
      hiddenColIds: v.hiddenColIds,
      sortState: parseSortState(obj.sortState),
      filterState: parseFilterState(obj.filterState),
    };
  });
};

// `gearColIds` gates hidden-column toggles (only gear-visible columns can be
// hidden); `allColIds` gates sort/filter, which can target statically-hidden
// filter-only columns too.
export const computeViewApplication = (
  view: CustomView,
  gearColIds: ReadonlySet<string>,
  allColIds: ReadonlySet<string>,
): { hiddenColIds: Set<string>; sortState: SortState; filterState: FilterState } => {
  const hiddenColIds = new Set(view.hiddenColIds.filter((id) => gearColIds.has(id)));
  const sortState = view.sortState && allColIds.has(view.sortState.colId) ? view.sortState : null;
  const filterState: FilterState = {};
  Object.entries(view.filterState ?? {}).forEach(([k, v]) => {
    if (allColIds.has(k)) filterState[k] = v;
  });
  return { hiddenColIds, sortState, filterState };
};

// Drop above the target. After splice removes the source, a forward move's
// target index has shifted down by one, so subtract — this matches the
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
