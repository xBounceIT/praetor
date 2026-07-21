import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from './ModalLayout';
import { VersionHistoryDialogChromeContext } from './VersionHistoryDialogChrome';

/** Above the shared document Modal default (60), below DeleteConfirmModal (70). */
const VERSION_HISTORY_DIALOG_Z_INDEX = 65;

interface VersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * Dialog open state for secondary save-version history.
 * Closing always clears preview and ignores late `getVersion` results so the parent form
 * cannot stay read-only without a visible exit after the dialog is dismissed.
 */
export function useVersionHistoryDialogOpen(onClearVersionPreview: () => void) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      openRef.current = next;
      if (!next) {
        onClearVersionPreview();
      }
    },
    [onClearVersionPreview],
  );

  const bindPreview = useCallback(<T,>(onPreview: (value: T) => void) => {
    return (value: T) => {
      if (!openRef.current) return;
      onPreview(value);
    };
  }, []);

  return { open, onOpenChange, setOpen, bindPreview } as const;
}

/** Modal shell for secondary version history opened from the inline revisions section. */
export function VersionHistoryDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: VersionHistoryDialogProps) {
  const [rowCount, setRowCount] = useState(0);
  const close = () => onOpenChange(false);

  const chromeContext = useMemo(() => ({ setRowCount }), []);

  return (
    <VersionHistoryDialogChromeContext.Provider value={chromeContext}>
      <Modal isOpen={open} onClose={close} ariaLabel={null} zIndex={VERSION_HISTORY_DIALOG_Z_INDEX}>
        <ModalContent size="md" className="max-h-[85vh]">
          <ModalHeader className="items-center gap-3 py-3.5">
            <div className="min-w-0 flex-1 space-y-0.5 pr-2">
              <ModalTitle className="gap-2.5 text-base leading-snug">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <i className="fa-solid fa-clock-rotate-left text-sm" aria-hidden="true"></i>
                </span>
                {title}
              </ModalTitle>
              {description ? (
                <ModalDescription className="text-xs leading-relaxed">
                  {description}
                </ModalDescription>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                {rowCount}
              </span>
              <ModalCloseButton onClick={close} />
            </div>
          </ModalHeader>
          <ModalBody className="min-h-0 flex-1 px-0 py-0">{children}</ModalBody>
        </ModalContent>
      </Modal>
    </VersionHistoryDialogChromeContext.Provider>
  );
}
