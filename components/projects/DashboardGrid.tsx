import type React from 'react';
import {
  Children,
  isValidElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  bottom,
  DASHBOARD_COLS,
  type DashboardLayout,
  type DashboardWidgetDef,
  type DashboardWidgetState,
  moveWidgetTo,
  resizeWidgetTo,
  sortByRowCol,
  visibleLayout,
} from './dashboardLayout';

// A single placeable card, declared as a child of <DashboardGrid>: its stable
// id, the title shown in the edit header, and the rendered content (a KPI /
// chart / timeline card). It's a marker — DashboardGrid reads its props and
// positions the content; rendering one on its own just shows the content.
export interface DashboardItemProps {
  id: string;
  title: string;
  children: ReactNode;
}

export const DashboardItem: React.FC<DashboardItemProps> = ({ children }) => <>{children}</>;

interface ResolvedItem {
  id: string;
  title: string;
  node: ReactNode;
}

export interface DashboardGridProps {
  layout: DashboardLayout;
  defs: readonly DashboardWidgetDef[];
  editing: boolean;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onToggleHidden: (id: string) => void;
  // <DashboardItem id title> children, in any order (conditionals are fine —
  // falsy children are skipped).
  children: ReactNode;
  rowHeight?: number;
  margin?: number;
}

const DEFAULT_ROW_HEIGHT = 64;
const DEFAULT_MARGIN = 16;
// Below this container width the free-form grid is unusable, so we stack the
// cards in a single column (drag/resize disabled — the model is preserved).
const SINGLE_COLUMN_BREAKPOINT = 640;

type DragMode = 'move' | 'resize-e' | 'resize-s' | 'resize-se';

interface DragState {
  id: string;
  mode: DragMode;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  origin: DashboardWidgetState;
  preview: DashboardLayout;
  dxPx: number;
  dyPx: number;
  // The snapped grid delta the current `preview` was built for, so a pointer
  // move within the same cell can skip recomputing the (compacted) preview.
  snapCols: number;
  snapRows: number;
}

const DashboardGrid: React.FC<DashboardGridProps> = ({
  layout,
  defs,
  editing,
  onMove,
  onResize,
  onToggleHidden,
  children,
  rowHeight = DEFAULT_ROW_HEIGHT,
  margin = DEFAULT_MARGIN,
}) => {
  const { t } = useTranslation(['projects']);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  // Latest drag, readable from the window listeners so a fast pointerup commits
  // the most recent preview rather than the closure's stale one.
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  // Resolve the <DashboardItem> children into a flat id→content list.
  const items = useMemo<ResolvedItem[]>(() => {
    const out: ResolvedItem[] = [];
    Children.forEach(children, (child) => {
      if (!isValidElement(child)) return;
      const props = child.props as Partial<DashboardItemProps>;
      if (typeof props.id !== 'string') return;
      out.push({ id: props.id, title: props.title ?? props.id, node: props.children });
    });
    return out;
  }, [children]);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const defsById = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);

  // Callback ref so measurement re-binds when the mounted root changes — the
  // grid and single-column branches return different elements, so a plain
  // mount-once effect would keep observing a detached node across the
  // responsive breakpoint and freeze the width.
  const setContainerEl = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    // Ignore a notification that was already queued for an element we've since
    // swapped away from (the detached node measures 0 and would flicker us).
    const ro = new ResizeObserver(() => {
      if (containerRef.current === el) setWidth(el.clientWidth);
    });
    ro.observe(el);
    observerRef.current = ro;
  }, []);

  const cols = DASHBOARD_COLS;
  const singleColumn = width > 0 && width < SINGLE_COLUMN_BREAKPOINT;
  const colWidth = width > 0 ? Math.max(0, (width - margin * (cols + 1)) / cols) : 0;
  const unitX = colWidth + margin;
  const unitY = rowHeight + margin;

  // The window listeners read the live layout / grid units / callbacks from here
  // so they stay correct without re-subscribing on every pointer move.
  const gridRef = useRef({ layout, unitX, unitY, defsById, onMove, onResize });
  gridRef.current = { layout, unitX, unitY, defsById, onMove, onResize };

  const rectStyle = (s: DashboardWidgetState): React.CSSProperties => ({
    position: 'absolute',
    left: margin + s.x * unitX,
    top: margin + s.y * unitY,
    width: s.w * colWidth + (s.w - 1) * margin,
    height: s.h * rowHeight + (s.h - 1) * margin,
  });

  // What to actually place: while editing show every widget (hidden ones become
  // placeholders); outside editing drop hidden widgets and float the rest up.
  // Memoized so the (compacting) `visibleLayout` doesn't re-run on unrelated
  // re-renders (width measurement, parent state, i18n) outside edit mode.
  const placed = useMemo(
    () => (editing ? (drag ? drag.preview : layout) : visibleLayout(layout)),
    [editing, drag, layout],
  );
  const placedById = useMemo(() => new Map(placed.map((w) => [w.id, w])), [placed]);
  const containerHeight = margin + bottom(placed) * unitY;

  // ---- pointer drag / resize -------------------------------------------------

  const beginDrag = (e: React.PointerEvent, id: string, mode: DragMode) => {
    // Ignore a second pointer while one gesture is already in flight (a second
    // finger / button would orphan the first pointer's capture and state).
    if (!editing || singleColumn || e.button !== 0 || dragRef.current) return;
    const origin = layout.find((w) => w.id === id);
    if (!origin) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      containerRef.current?.setPointerCapture?.(e.pointerId);
    } catch {
      // Capture is best-effort; the window listeners drive the gesture either way.
    }
    setDrag({
      id,
      mode,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origin: { ...origin },
      preview: layout,
      dxPx: 0,
      dyPx: 0,
      snapCols: 0,
      snapRows: 0,
    });
  };

  // Subscribe to the window once per gesture (not per pointer move). The
  // handlers read live state from refs, so the committed geometry is always the
  // latest preview even though this effect doesn't re-run on every move.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const { layout: curLayout, unitX: ux, unitY: uy, defsById: curDefs } = gridRef.current;
      const dxPx = e.clientX - d.startClientX;
      const dyPx = e.clientY - d.startClientY;
      const dCols = ux > 0 ? Math.round(dxPx / ux) : 0;
      const dRows = uy > 0 ? Math.round(dyPx / uy) : 0;
      // Within the same snapped cell the layout doesn't change, so skip the
      // compaction pass. A move still needs the pixel offset for the dragged
      // card's cursor-follow; a resize has no translate, so it needs nothing.
      if (dCols === d.snapCols && dRows === d.snapRows) {
        if (d.mode === 'move') {
          setDrag((prev) =>
            prev && (prev.dxPx !== dxPx || prev.dyPx !== dyPx) ? { ...prev, dxPx, dyPx } : prev,
          );
        }
        return;
      }
      let preview: DashboardLayout;
      if (d.mode === 'move') {
        preview = moveWidgetTo(curLayout, d.id, d.origin.x + dCols, d.origin.y + dRows);
      } else {
        const def = curDefs.get(d.id);
        const dw = d.mode === 'resize-s' ? 0 : dCols;
        const dh = d.mode === 'resize-e' ? 0 : dRows;
        preview = resizeWidgetTo(
          curLayout,
          d.id,
          d.origin.w + dw,
          d.origin.h + dh,
          def?.minW ?? 1,
          def?.minH ?? 1,
        );
      }
      setDrag((prev) =>
        prev ? { ...prev, preview, dxPx, dyPx, snapCols: dCols, snapRows: dRows } : prev,
      );
    };
    const finish = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      try {
        // The captured element may have been swapped (e.g. crossing the
        // single-column breakpoint mid-drag); releasing on the wrong node throws.
        containerRef.current?.releasePointerCapture?.(e.pointerId);
      } catch {
        // Already released (or never captured here) — the gesture still commits.
      }
      const { onMove: commitMove, onResize: commitResize } = gridRef.current;
      const item = d.preview.find((w) => w.id === d.id);
      if (item) {
        if (d.mode === 'move') {
          if (item.x !== d.origin.x || item.y !== d.origin.y) commitMove(d.id, item.x, item.y);
        } else if (item.w !== d.origin.w || item.h !== d.origin.h) {
          commitResize(d.id, item.w, item.h);
        }
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [dragging]);

  // If edit mode ends mid-gesture, drop the drag so the read-only render never
  // shows a translated card or a stray snap overlay.
  useEffect(() => {
    if (!editing) setDrag(null);
  }, [editing]);

  // Keyboard parity: arrows move, shift+arrows resize, by one grid cell.
  const onItemKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (!editing) return;
    const s = layout.find((w) => w.id === id);
    if (!s) return;
    const step = (dx: number, dy: number) => {
      e.preventDefault();
      onMove(id, s.x + dx, s.y + dy);
    };
    const size = (dw: number, dh: number) => {
      e.preventDefault();
      onResize(id, s.w + dw, s.h + dh);
    };
    switch (e.key) {
      case 'ArrowLeft':
        e.shiftKey ? size(-1, 0) : step(-1, 0);
        break;
      case 'ArrowRight':
        e.shiftKey ? size(1, 0) : step(1, 0);
        break;
      case 'ArrowUp':
        e.shiftKey ? size(0, -1) : step(0, -1);
        break;
      case 'ArrowDown':
        e.shiftKey ? size(0, 1) : step(0, 1);
        break;
    }
  };

  // ---- single-column fallback ------------------------------------------------

  if (singleColumn) {
    const stacked = sortByRowCol(editing ? layout : visibleLayout(layout));
    return (
      <div ref={setContainerEl} className="w-full space-y-4">
        {editing && (
          <p className="text-xs text-muted-foreground">
            {t('projects:detail.dashboard.editOnLargerScreen')}
          </p>
        )}
        {stacked.map((state) => {
          const item = itemsById.get(state.id);
          if (!item) return null;
          if (!editing && state.hidden) return null;
          return (
            <div key={state.id}>
              {editing && (
                <div className="mb-1 flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-muted/40 px-2 py-1.5">
                  <span className="mr-auto truncate text-xs font-medium" title={item.title}>
                    {item.title}
                  </span>
                  <HideButton
                    hidden={state.hidden}
                    title={item.title}
                    onToggle={() => onToggleHidden(state.id)}
                    t={t}
                  />
                </div>
              )}
              {state.hidden ? (
                <HiddenPlaceholder
                  title={item.title}
                  onUnhide={() => onToggleHidden(state.id)}
                  t={t}
                />
              ) : (
                <div className="overflow-hidden">{item.node}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ---- free-form grid --------------------------------------------------------

  return (
    <div
      ref={setContainerEl}
      className="relative w-full"
      style={{
        height: width > 0 ? containerHeight : undefined,
        minHeight: width > 0 ? undefined : 240,
      }}
    >
      {/* Snap target while moving a card. */}
      {drag?.mode === 'move' &&
        (() => {
          const target = drag.preview.find((w) => w.id === drag.id);
          if (!target) return null;
          return (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-0 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 transition-all"
              style={rectStyle(target)}
            />
          );
        })()}

      {items.map((item) => {
        const state = placedById.get(item.id);
        if (!state) return null;

        const isActive = drag?.id === item.id;
        const isMoving = isActive && drag?.mode === 'move';
        // A moving card follows the cursor pixel-for-pixel (no transition); every
        // other card — including a card being *resized* — animates to its snapped
        // slot/size so resizing eases between grid steps instead of jumping.
        const style: React.CSSProperties = isMoving
          ? {
              ...rectStyle(drag.origin),
              transform: `translate(${drag.dxPx}px, ${drag.dyPx}px)`,
              zIndex: 30,
            }
          : { ...rectStyle(state), zIndex: isActive ? 20 : undefined };

        if (!editing) {
          return (
            <div key={item.id} className="overflow-hidden" style={style}>
              <div className="h-full overflow-hidden">{item.node}</div>
            </div>
          );
        }

        return (
          <div
            key={item.id}
            className={cn('flex flex-col', !isMoving && 'transition-all')}
            style={style}
          >
            <div
              className={cn(
                'flex h-full flex-col overflow-hidden rounded-xl ring-2',
                isActive ? 'ring-primary' : 'ring-primary/30',
              )}
            >
              {/* Header bar: a wide drag handle plus the hide control. They are
                  sibling buttons (a button can't legally nest another). */}
              <div className="flex shrink-0 items-center gap-1 border-b border-dashed border-primary/40 bg-muted/50 px-1.5 py-1">
                <button
                  type="button"
                  aria-label={t('projects:detail.dashboard.dragHandle', { name: item.title })}
                  onPointerDown={(e) => beginDrag(e, item.id, 'move')}
                  onKeyDown={(e) => onItemKeyDown(e, item.id)}
                  className="flex min-w-0 flex-1 cursor-move touch-none items-center gap-2 text-left"
                >
                  <i
                    className="fa-solid fa-up-down-left-right text-xs text-muted-foreground"
                    aria-hidden="true"
                  ></i>
                  <span className="truncate text-xs font-medium text-foreground" title={item.title}>
                    {item.title}
                  </span>
                </button>
                <HideButton
                  hidden={state.hidden}
                  title={item.title}
                  onToggle={() => onToggleHidden(item.id)}
                  t={t}
                />
              </div>

              {state.hidden ? (
                <HiddenPlaceholder
                  title={item.title}
                  onUnhide={() => onToggleHidden(item.id)}
                  t={t}
                />
              ) : (
                <div className="pointer-events-none relative flex-1 select-none overflow-hidden">
                  {item.node}
                </div>
              )}
            </div>

            {/* Resize handles — pointer-only (keyboard resize is Shift+arrows on
                the header), so they're kept out of the tab order. */}
            {!state.hidden && (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('projects:detail.dashboard.resizeWidth', { name: item.title })}
                  onPointerDown={(e) => beginDrag(e, item.id, 'resize-e')}
                  className="absolute top-9 bottom-4 right-0 w-1.5 cursor-ew-resize touch-none rounded-full hover:bg-primary/40"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('projects:detail.dashboard.resizeHeight', { name: item.title })}
                  onPointerDown={(e) => beginDrag(e, item.id, 'resize-s')}
                  className="absolute bottom-0 left-4 right-4 h-1.5 cursor-ns-resize touch-none rounded-full hover:bg-primary/40"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('projects:detail.dashboard.resize', { name: item.title })}
                  onPointerDown={(e) => beginDrag(e, item.id, 'resize-se')}
                  className="absolute right-0.5 bottom-0.5 flex size-4 cursor-nwse-resize touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground"
                >
                  <i
                    className="fa-solid fa-up-right-and-down-left-from-center text-[9px]"
                    aria-hidden="true"
                  ></i>
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};

type TFn = (key: string, opts?: Record<string, unknown>) => string;

const HideButton: React.FC<{
  hidden: boolean;
  title: string;
  onToggle: () => void;
  t: TFn;
}> = ({ hidden, title, onToggle, t }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon-sm"
    aria-label={
      hidden
        ? t('projects:detail.dashboard.showWidget', { name: title })
        : t('projects:detail.dashboard.hideWidget', { name: title })
    }
    title={hidden ? t('projects:detail.dashboard.show') : t('projects:detail.dashboard.hide')}
    // Don't let a click on the hide button start a header drag.
    onPointerDown={(e) => e.stopPropagation()}
    onClick={onToggle}
  >
    <i className={`fa-solid ${hidden ? 'fa-eye' : 'fa-eye-slash'} text-xs`} aria-hidden="true"></i>
  </Button>
);

const HiddenPlaceholder: React.FC<{ title: string; onUnhide: () => void; t: TFn }> = ({
  title,
  onUnhide,
  t,
}) => (
  <button
    type="button"
    onClick={onUnhide}
    className="flex h-full min-h-[88px] w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-muted-foreground/30 text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
  >
    <i className="fa-solid fa-eye-slash" aria-hidden="true"></i>
    <span className="px-2 text-center text-xs font-medium">{title}</span>
    <span className="text-[11px]">{t('projects:detail.dashboard.show')}</span>
  </button>
);

export default DashboardGrid;
