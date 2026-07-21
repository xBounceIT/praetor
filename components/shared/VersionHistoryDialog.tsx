import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Above the shared document Modal default (60), below DeleteConfirmModal (70). */
const VERSION_HISTORY_DIALOG_Z_INDEX = 65;

interface VersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/** Dialog shell for secondary version history opened from the inline revisions section. */
export function VersionHistoryDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: VersionHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-3 sm:max-w-md"
        overlayStyle={{ zIndex: VERSION_HISTORY_DIALOG_Z_INDEX }}
        style={{ zIndex: VERSION_HISTORY_DIALOG_Z_INDEX + 1 }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription className="sr-only">{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{open ? children : null}</div>
      </DialogContent>
    </Dialog>
  );
}
