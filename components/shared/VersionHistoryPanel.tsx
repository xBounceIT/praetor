import { Button } from '@/components/ui/button';
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
  return (
    <div className="hidden max-h-[90vh] w-72 flex-shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-lg animate-in fade-in slide-in-from-right duration-200 2xl:flex">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <i className="fa-solid fa-clock-rotate-left text-primary" aria-hidden="true"></i>
          {labels.title}
        </h4>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {rows.length}
        </span>
      </div>
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
                        row.reason === 'restore' ? 'text-amber-600' : 'text-muted-foreground',
                      )}
                    >
                      {row.reason === 'restore' ? labels.reasonRestore : labels.reasonUpdate}
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
  );
}
