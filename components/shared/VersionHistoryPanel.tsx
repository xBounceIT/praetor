import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatInsertDateTime } from '@/utils/date';

export interface VersionHistoryPanelRow {
  id: string;
  createdAt: number;
  reason: 'update' | 'restore';
}

interface VersionHistoryPanelLabels {
  title: string;
  empty: string;
  reasonRestore: string;
  reasonUpdate: string;
  backToCurrent: string;
  restoreButton: string;
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
}

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
}: VersionHistoryPanelProps<Row>) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(
        'hidden max-h-[90vh] flex-shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-lg transition-[width] duration-200 ease-in-out motion-reduce:transition-none animate-in fade-in slide-in-from-right 2xl:flex',
        isOpen ? 'w-72 delay-0' : 'w-12 delay-200 motion-reduce:delay-0',
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label={labels.title}
              className="h-12 w-full shrink-0 justify-start gap-0 overflow-hidden rounded-none border-b border-border bg-muted/30 p-0 hover:bg-muted/60 data-[state=closed]:border-b-0"
            >
              <span className="flex size-12 shrink-0 items-center justify-center gap-1">
                <i
                  className={cn(
                    'fa-solid text-[10px] text-muted-foreground',
                    isOpen ? 'fa-chevron-left' : 'fa-chevron-right',
                  )}
                  aria-hidden="true"
                ></i>
                <i className="fa-solid fa-clock-rotate-left text-primary" aria-hidden="true"></i>
              </span>
              <span className="min-w-0 flex-1 whitespace-nowrap text-left text-sm font-semibold text-foreground">
                {labels.title}
              </span>
              <span className="mr-4 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {rows.length}
              </span>
            </Button>
          </CollapsibleTrigger>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={8}>
          {labels.title}
        </TooltipContent>
      </Tooltip>
      <CollapsibleContent
        forceMount
        aria-hidden={!isOpen}
        inert={!isOpen}
        className="version-history-content min-h-0"
      >
        <div className="version-history-viewport">
          <div className="min-h-0 overflow-hidden">
            <div className="flex max-h-[calc(90vh-3rem)] min-h-0 flex-col">
              <div className="flex-1 overflow-y-auto">
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
                  <div className="p-6 text-center text-xs leading-relaxed text-muted-foreground">
                    {labels.empty}
                  </div>
                )}
                {!isLoading && !error && rows.length > 0 && (
                  <ul className="divide-y divide-border">
                    {rows.map((row) => {
                      const selected = row.id === selectedVersionId;
                      return (
                        <li key={row.id}>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onSelect(row)}
                            className={cn(
                              'h-auto w-full flex-col items-start justify-start gap-1 rounded-none px-4 py-3 text-left',
                              selected && 'border-l-4 border-primary bg-primary/5 pl-3',
                            )}
                          >
                            <span className="text-xs font-semibold text-foreground">
                              {formatInsertDateTime(row.createdAt, locale)}
                            </span>
                            <span
                              className={cn(
                                'text-[9px] font-black uppercase tracking-wider',
                                row.reason === 'restore'
                                  ? 'text-amber-600'
                                  : 'text-muted-foreground',
                              )}
                            >
                              {row.reason === 'restore'
                                ? labels.reasonRestore
                                : labels.reasonUpdate}
                            </span>
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {selectedVersionId && (
                <div className="space-y-2 border-t border-border bg-muted/30 p-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onClearPreview}
                    className="w-full"
                  >
                    <i className="fa-solid fa-arrow-left" aria-hidden="true"></i>
                    {labels.backToCurrent}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={Boolean(disabled) || Boolean(restoreInFlight)}
                    onClick={onRestore}
                    className="w-full"
                  >
                    <i className="fa-solid fa-rotate-left" aria-hidden="true"></i>
                    {labels.restoreButton}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
