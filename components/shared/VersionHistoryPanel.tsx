import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatInsertDateTime } from '@/utils/date';
import { filterVersionHistoryRows } from '@/utils/versionHistoryFilter';

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

/** Approximate row height used to cap the visible list at three rows. */
const INLINE_ROW_REM = 3.25;
const INLINE_ROW_MIN_HEIGHT = `${INLINE_ROW_REM}rem`;
/** Keep as a full static string so Tailwind can detect the utility. */
const INLINE_LIST_MAX_CLASS = 'max-h-[calc(3*3.25rem)]';

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredRows = useMemo(
    () =>
      filterVersionHistoryRows(rows, searchQuery, locale, {
        reasonRestore: labels.reasonRestore,
        reasonUpdate: labels.reasonUpdate,
      }),
    [rows, searchQuery, locale, labels.reasonRestore, labels.reasonUpdate],
  );

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const toggleSearch = () => {
    if (searchOpen) {
      setSearchOpen(false);
      setSearchQuery('');
      return;
    }
    setSearchOpen(true);
  };

  const currentRowId = rows[0]?.id ?? null;
  const radioValue = selectedVersionId ?? currentRowId ?? '';

  const handleRadioChange = (value: string) => {
    if (currentRowId && value === currentRowId) {
      if (selectedVersionId) onClearPreview();
      return;
    }
    const row = filteredRows.find((candidate) => candidate.id === value);
    if (row) onSelect(row);
  };

  const listMaxClass = layout === 'dialog' ? 'max-h-[min(24rem,50vh)]' : INLINE_LIST_MAX_CLASS;
  const isDialog = layout === 'dialog';

  return (
    <section
      className={cn(
        'flex w-full flex-col overflow-hidden text-foreground',
        isDialog ? 'bg-transparent' : 'rounded-lg border border-border bg-background',
        className,
      )}
      aria-label={labels.title}
    >
      <div
        className={cn(
          'flex items-center gap-2 border-b border-border bg-muted/30',
          isDialog ? 'px-6 py-3' : 'px-4 py-2.5',
        )}
      >
        {!isDialog ? (
          <span
            className={cn(
              'truncate text-[11px] font-semibold tracking-wider text-muted-foreground uppercase transition-[flex-grow,opacity,max-width] duration-200 ease-out',
              searchOpen
                ? 'max-w-0 flex-none overflow-hidden opacity-0'
                : 'min-w-0 max-w-full flex-1 opacity-100',
            )}
          >
            {labels.title}
          </span>
        ) : null}

        <div
          className={cn(
            'overflow-hidden transition-[flex-grow,opacity,max-width] duration-200 ease-out',
            searchOpen
              ? 'min-w-0 max-w-full flex-1 opacity-100'
              : 'pointer-events-none max-w-0 flex-none opacity-0',
            isDialog && !searchOpen && 'hidden',
            isDialog && searchOpen && 'block',
          )}
        >
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={labels.searchPlaceholder}
            aria-label={labels.searchAriaLabel}
            tabIndex={searchOpen ? 0 : -1}
            className="h-8 text-xs"
          />
        </div>

        {isDialog && !searchOpen ? <div className="min-w-0 flex-1" /> : null}

        {/* Dialog layout already surfaces this copy in VersionHistoryDialog; keep the
            icon only inline so dialog autofocus cannot open the tooltip on mount. */}
        {labels.infoTooltip && !isDialog && !searchOpen ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 shrink-0 text-muted-foreground"
                aria-label={labels.infoTooltip}
              >
                <i className="fa-solid fa-circle-info text-xs" aria-hidden="true"></i>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs">
              {labels.infoTooltip}
            </TooltipContent>
          </Tooltip>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            'size-7 shrink-0 text-muted-foreground',
            searchOpen && 'bg-muted text-foreground',
          )}
          aria-label={labels.searchAriaLabel}
          aria-pressed={searchOpen}
          onClick={toggleSearch}
        >
          <i
            className={cn(
              'text-xs',
              searchOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-magnifying-glass',
            )}
            aria-hidden="true"
          ></i>
        </Button>

        {!searchOpen ? (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
            {rows.length}
          </span>
        ) : null}
      </div>

      <div className={cn('min-h-0 overflow-y-auto', isDialog && 'px-4', listMaxClass)}>
        {isLoading && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            <i className="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
          </div>
        )}
        {error && !isLoading && (
          <div className="m-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="p-4 text-center text-xs leading-relaxed text-muted-foreground">
            {labels.empty}
          </div>
        )}
        {!isLoading && !error && rows.length > 0 && filteredRows.length === 0 && (
          <div className="p-4 text-center text-xs leading-relaxed text-muted-foreground">
            {labels.noResults}
          </div>
        )}
        {!isLoading && !error && filteredRows.length > 0 && (
          <RadioGroup
            value={radioValue}
            onValueChange={handleRadioChange}
            className={cn('gap-0 py-1', isDialog ? 'px-2' : 'px-3')}
          >
            {filteredRows.map((row) => {
              const selected = row.id === selectedVersionId;
              const isCurrent = rows[0]?.id === row.id;
              const reasonLabel =
                row.reason === 'restore' ? labels.reasonRestore : labels.reasonUpdate;
              const timestamp = formatInsertDateTime(row.createdAt, locale);
              const optionLabel = row.revisionCode ?? timestamp;

              return (
                <label
                  key={row.id}
                  htmlFor={`history-row-${row.id}`}
                  className={cn(
                    'mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/40 sm:gap-3',
                    selected && 'border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15',
                    !selected && 'border border-transparent',
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
    </section>
  );
}
