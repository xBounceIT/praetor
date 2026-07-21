import type { ReactNode } from 'react';
import Modal from './Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from './ModalLayout';

/** Above the shared document Modal default (60), below DeleteConfirmModal (70). */
const VERSION_HISTORY_DIALOG_Z_INDEX = 65;

interface VersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/** Modal shell for secondary version history opened from the inline revisions section. */
export function VersionHistoryDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: VersionHistoryDialogProps) {
  const close = () => onOpenChange(false);

  return (
    <Modal isOpen={open} onClose={close} ariaLabel={null} zIndex={VERSION_HISTORY_DIALOG_Z_INDEX}>
      <ModalContent size="md" className="max-h-[85vh]">
        <ModalHeader>
          <div className="min-w-0 flex-1 space-y-1">
            <ModalTitle className="gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                <i className="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
              </span>
              {title}
            </ModalTitle>
            {description ? <ModalDescription>{description}</ModalDescription> : null}
          </div>
          <ModalCloseButton onClick={close} />
        </ModalHeader>
        <ModalBody className="min-h-0 flex-1 px-0 py-0">{children}</ModalBody>
      </ModalContent>
    </Modal>
  );
}
