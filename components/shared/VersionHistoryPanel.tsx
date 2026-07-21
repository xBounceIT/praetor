import { Search, XIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { formatInsertDateTime } from '@/utils/date';
import { filterVersionHistoryRows } from '@/utils/versionHistoryFilter';
import FieldTooltip from './FieldTooltip';
import { useVersionHistoryDialogChrome } from './VersionHistoryDialogChrome';

export interface VersionHistoryPanelRow {
  id: string;
  createdAt: number;
  reason: 'update' | 'restore';
  revisionCode?: string;
  createdByUserName?: string | null;
}

interface VersionHistoryPanelLabels {
  title: string;
  empty: string;
  reasonRestore: string;
  reasonUpdate: string;
  backToCurrent: string;
  restoreButton: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
  noResults: string;
  currentBadge: string;
  previewBadge: string;
  infoTooltip?: string;
}

interface VersionHistoryPanelProps<Row extends VersionHistoryPanelRow> {
  rows: Row[];
  selectedVersionId: string | null;
  isLoading: boolean;
  error: string | null;
  locale: string;
  labels: VersionHistoryPanelLabels;
  restoreInFlight?: boolean;
  disabled?: boolean;
  onSelect: (row: Row) => void;
  onClearPreview: () => void;
  onRestore: () => void;
  /** Compact timeline for modal tops; dialog allows a taller scroll area. */
  layout?: 'inline' | 'dialog';
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

/** Approximate row height used to reserve three visible slots in the inline list. */
const INLINE_ROW_REM = 3.75;
const INLINE_ROW_MIN_HEIGHT = `${INLINE_ROW_REM}rem`;
const INLINE_VISIBLE_ROWS = 3;
/** Keep as a full static string so Tailwind can detect the utility.
 * Includes `py-1.5` (0.75rem) so the first/last row hover is not flush with the border. */
const INLINE_LIST_HEIGHT_CLASS = 'h-[calc(3*3.75rem+0.75rem)]';
/** Fixed header height and shared crossfade for the two search states. */
const SEARCH_HEADER_HEIGHT = 'h-8';
const SEARCH_HEADER_FADE = 'transition-opacity duration-200 ease-in-out';

export function VersionHistoryPanel<Row extends VersionHistoryPanelRow>({
  rows,
  selectedVersionId,
  isLoading,
  error,
  locale,
  labels,
  restoreInFlight,
  disabled,
  onSelect,
  onClearPreview,
  onRestore,
  layout = 'inline',
  secondaryAction,
  className,
}: VersionHistoryPanelProps<Row>) {
  const isDialog = layout === 'dialog';
  const dialogChrome = useVersionHistoryDialogChrome();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
  }, []);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const filteredRows = useMemo(() => {
    if (isDialog) return rows;
    return filterVersionHistoryRows(rows, searchQuery, locale, {
      reasonRestore: labels.reasonRestore,
      reasonUpdate: labels.reasonUpdate,
    });
  }, [isDialog, rows, searchQuery, locale, labels.reasonRestore, labels.reasonUpdate]);

  useEffect(() => {
    if (!isDialog || !dialogChrome) return;
    dialogChrome.setRowCount(rows.length);
    return () => dialogChrome.setRowCount(0);
  }, [isDialog, dialogChrome, rows.length]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const handleSearchBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && headerRef.current?.contains(nextTarget)) {
      return;
    }
    closeSearch();
  };

  // Live document is shown when `selectedVersionId` is null — history rows are all
  // restorable snapshots (newest-first). Do not treat rows[0] as an unselectable "live" stand-in.
  const newestRowId = rows[0]?.id ?? null;
  const radioValue = selectedVersionId ?? '';

  const handleRadioChange = (value: string) => {
    const row = filteredRows.find((candidate) => candidate.id === value);
    if (row) onSelect(row);
  };

  const listHeightClass = isDialog ? 'max-h-[min(24rem,50vh)]' : INLINE_LIST_HEIGHT_CLASS;
  const emptySlotCount =
    !isDialog && !isLoading && !error && filteredRows.length > 0
      ? Math.max(0, INLINE_VISIBLE_ROWS - filteredRows.length)
      : 0;

  const emptySlots = Array.from({ length: emptySlotCount }, (_, index) => (
    <div
      key={`history-empty-slot-${index}`}
      data-testid="version-history-empty-slot"
      aria-hidden="true"
      className="border-b border-border/50 last:border-b-0"
      style={{ minHeight: INLINE_ROW_MIN_HEIGHT }}
    />
  ));

  // Two complete header layers crossfade in sync — no grid-column morphing or stacked icons.
  const inlineHeaderRow = (
    <div
      ref={headerRef}
      data-testid="version-history-inline-header"
      data-search-open={searchOpen ? 'true' : 'false'}
      className={cn('relative w-full', SEARCH_HEADER_HEIGHT)}
    >
      <div
        data-testid="version-history-header-resting"
        aria-hidden={searchOpen}
        className={cn(
          'absolute inset-0 flex items-center gap-2',
          SEARCH_HEADER_FADE,
          searchOpen ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
      >
        <h4 className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
          <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <span className="truncate">{labels.title}</span>
          {labels.infoTooltip ? (
            <FieldTooltip description={labels.infoTooltip} icon="info" />
          ) : null}
        </h4>

        <span
          data-testid="version-history-count-badge"
          className="inline-flex shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tracking-wider text-muted-foreground uppercase"
        >
          {rows.length}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-testid="version-history-search-toggle"
          className="size-7 shrink-0 text-muted-foreground"
          aria-label={labels.searchAriaLabel}
          onClick={openSearch}
        >
          <Search data-testid="version-history-search-icon" className="size-4" />
        </Button>
      </div>

      <div
        data-testid="version-history-header-search"
        aria-hidden={!searchOpen}
        className={cn(
          'absolute inset-0 flex items-center gap-2',
          SEARCH_HEADER_FADE,
          searchOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <Input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onBlur={handleSearchBlur}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchAriaLabel}
          tabIndex={searchOpen ? 0 : -1}
          className="h-8 min-w-0 flex-1 text-xs"
        />

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-testid="version-history-close-toggle"
          className="size-7 shrink-0 bg-muted text-foreground"
          aria-label="Close"
          onClick={closeSearch}
        >
          <XIcon data-testid="version-history-close-icon" className="size-4" />
        </Button>
      </div>
    </div>
  );

  const panelBody = (
    <>
      <div
        className={cn('min-h-0 overflow-y-auto', isDialog ? 'px-5 py-1' : 'px-0', listHeightClass)}
      >
        {isLoading && (
          <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
            <i className="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
          </div>
        )}
        {error && !isLoading && (
          <div className="m-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="flex h-full items-center justify-center px-4 py-2 text-center text-xs leading-relaxed text-muted-foreground">
            {labels.empty}
          </div>
        )}
        {!isLoading && !error && rows.length > 0 && filteredRows.length === 0 && (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs leading-relaxed text-muted-foreground">
            {labels.noResults}
          </div>
        )}
        {!isLoading && !error && filteredRows.length > 0 && (
          <RadioGroup
            value={radioValue}
            onValueChange={handleRadioChange}
            className={cn('gap-0', isDialog ? 'px-1.5 py-2' : 'px-1.5 py-1.5')}
          >
            {filteredRows.map((row) => {
              const selected = row.id === selectedVersionId;
              const isCurrent = newestRowId === row.id;
              const reasonLabel =
                row.reason === 'restore' ? labels.reasonRestore : labels.reasonUpdate;
              const timestamp = formatInsertDateTime(row.createdAt, locale);
              const optionLabel = row.revisionCode ?? timestamp;

              return (
                <label
                  key={row.id}
                  htmlFor={`history-row-${row.id}`}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-md border-b border-border/50 last:border-b-0 hover:bg-muted/40 sm:gap-3',
                    isDialog ? 'px-3 py-3' : 'px-2.5 py-2.5',
                    selected && 'border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15',
                  )}
                  style={{ minHeight: INLINE_ROW_MIN_HEIGHT }}
                >
                  {row.revisionCode ? (
                    <span className="shrink-0 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-semibold tracking-wide text-foreground">
                      {row.revisionCode}
                    </span>
                  ) : null}

                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-xs text-muted-foreground">
                      {reasonLabel || optionLabel}
                      {row.createdByUserName ? ` · ${row.createdByUserName}` : ''}
                    </span>
                    {isCurrent ? (
                      <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
                        {labels.currentBadge}
                      </span>
                    ) : selected ? (
                      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-amber-700 uppercase dark:text-amber-400">
                        {labels.previewBadge}
                      </span>
                    ) : null}
                  </span>

                  <span className="hidden shrink-0 text-[11px] whitespace-nowrap text-muted-foreground sm:inline">
                    {timestamp}
                  </span>

                  <RadioGroupItem
                    id={`history-row-${row.id}`}
                    value={row.id}
                    className="shrink-0"
                    aria-label={optionLabel}
                  />
                </label>
              );
            })}
            {emptySlots}
          </RadioGroup>
        )}
      </div>

      {selectedVersionId ? (
        <div
          className={cn(
            'flex flex-col gap-2 border-t border-border bg-muted/30 sm:flex-row',
            isDialog ? 'px-6 py-4' : 'px-4 py-3',
          )}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClearPreview}
            className="flex-1"
          >
            <i className="fa-solid fa-arrow-left" aria-hidden="true"></i>
            {labels.backToCurrent}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={Boolean(disabled) || Boolean(restoreInFlight)}
            onClick={onRestore}
            className="flex-1"
          >
            <i className="fa-solid fa-rotate-left" aria-hidden="true"></i>
            {labels.restoreButton}
          </Button>
        </div>
      ) : null}

      {secondaryAction ? (
        <div className={cn('border-t border-border', isDialog ? 'px-6 py-3' : 'px-3 py-2.5')}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={secondaryAction.onClick}
            className="h-9 w-full justify-start gap-2 text-xs font-medium"
          >
            <i className="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
            {secondaryAction.label}
            <i
              className="fa-solid fa-arrow-up-right-from-square ml-auto text-[10px] text-muted-foreground"
              aria-hidden="true"
            ></i>
          </Button>
        </div>
      ) : null}
    </>
  );

  if (isDialog) {
    return (
      <section
        className={cn(
          'flex w-full flex-col overflow-hidden bg-transparent text-foreground',
          className,
        )}
        aria-label={labels.title}
      >
        {panelBody}
      </section>
    );
  }

  return (
    <div className={cn('flex w-full flex-col space-y-2', className)}>
      {inlineHeaderRow}
      <section
        className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground"
        aria-label={labels.title}
      >
        {panelBody}
      </section>
    </div>
  );
}
