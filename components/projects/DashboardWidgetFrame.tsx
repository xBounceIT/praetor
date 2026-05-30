import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DashboardWidgetSpan, DashboardWidgetState } from './dashboardLayout';

export interface DashboardWidgetFrameProps {
  title: string;
  // Optional so a missing slot (an id that isn't in the layout — i.e. a
  // registry/JSX drift) degrades to rendering nothing rather than crashing the
  // whole detail page on a `state.hidden` deref.
  state: DashboardWidgetState | undefined;
  editing: boolean;
  // Position within the layout — drives the CSS `order` so reordering the
  // layout array visually reorders the grid items without moving them in the
  // DOM (keeps tab order stable).
  index: number;
  count: number;
  onMove: (delta: number) => void;
  onToggleHidden: () => void;
  onSetSpan: (span: DashboardWidgetSpan) => void;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<{
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}> = ({ icon, label, onClick, disabled, active }) => (
  <Button
    type="button"
    variant={active ? 'secondary' : 'outline'}
    size="icon-sm"
    aria-label={label}
    aria-pressed={active}
    title={label}
    disabled={disabled}
    onClick={onClick}
  >
    <i className={`fa-solid ${icon}`} aria-hidden="true"></i>
  </Button>
);

// Wraps a single dashboard visualization. Owns the grid placement (order +
// column span) and, while editing, renders the move / resize / hide controls
// above the card. Outside edit mode it is a transparent passthrough that only
// applies the order + span, and renders nothing at all when the widget is
// hidden (so the slot collapses).
const DashboardWidgetFrame: React.FC<DashboardWidgetFrameProps> = ({
  title,
  state,
  editing,
  index,
  count,
  onMove,
  onToggleHidden,
  onSetSpan,
  children,
}) => {
  const { t } = useTranslation(['projects']);

  // A missing slot (id not present in the layout) renders nothing rather than
  // dereferencing undefined — keeps a registry/JSX mismatch from white-screening
  // the page.
  if (!state) return null;
  // Hidden widgets vanish entirely outside edit mode — the grid slot collapses.
  if (!editing && state.hidden) return null;

  const isFull = state.span === 2;
  const spanClass = isFull ? 'lg:col-span-2' : '';

  if (!editing) {
    return (
      <div className={cn('relative min-w-0', spanClass)} style={{ order: index }}>
        {children}
      </div>
    );
  }

  return (
    <div className={cn('relative flex min-w-0 flex-col gap-2', spanClass)} style={{ order: index }}>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-muted/40 px-2 py-1.5">
        <i
          className="fa-solid fa-up-down-left-right text-xs text-muted-foreground"
          aria-hidden="true"
        ></i>
        <span className="mr-auto truncate text-xs font-medium text-foreground" title={title}>
          {title}
        </span>
        <div className="flex items-center gap-1">
          <ToolbarButton
            icon="fa-arrow-left"
            label={t('projects:detail.dashboard.moveUp')}
            onClick={() => onMove(-1)}
            disabled={index === 0}
          />
          <ToolbarButton
            icon="fa-arrow-right"
            label={t('projects:detail.dashboard.moveDown')}
            onClick={() => onMove(1)}
            disabled={index === count - 1}
          />
          <ToolbarButton
            icon={isFull ? 'fa-compress' : 'fa-expand'}
            label={
              isFull
                ? t('projects:detail.dashboard.collapse')
                : t('projects:detail.dashboard.expand')
            }
            active={isFull}
            onClick={() => onSetSpan(isFull ? 1 : 2)}
          />
          <ToolbarButton
            icon={state.hidden ? 'fa-eye' : 'fa-eye-slash'}
            label={
              state.hidden
                ? t('projects:detail.dashboard.show')
                : t('projects:detail.dashboard.hide')
            }
            active={state.hidden}
            onClick={onToggleHidden}
          />
        </div>
      </div>

      {state.hidden ? (
        <button
          type="button"
          onClick={onToggleHidden}
          className="flex h-[120px] w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-muted-foreground/30 text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
        >
          <i className="fa-solid fa-eye-slash" aria-hidden="true"></i>
          <span className="text-xs font-medium">{t('projects:detail.dashboard.hiddenLabel')}</span>
          <span className="text-[11px]">{t('projects:detail.dashboard.show')}</span>
        </button>
      ) : (
        // Disable chart interactions while arranging so hovering a chart doesn't
        // fight the layout controls; the ring marks the card as editable.
        <div className="pointer-events-none select-none rounded-xl ring-2 ring-primary/30">
          {children}
        </div>
      )}
    </div>
  );
};

export default DashboardWidgetFrame;
