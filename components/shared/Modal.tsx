import { Dialog as DialogPrimitive } from 'radix-ui';
import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  zIndex?: number;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  backdropClass?: string;
}

const AUTOFOCUS_SELECTOR = '[data-autofocus]:not([disabled])';

const FOCUSABLE_SELECTOR = [
  AUTOFOCUS_SELECTOR,
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  zIndex = 60,
  closeOnBackdrop = true,
  closeOnEsc = true,
  backdropClass = 'bg-black/60 backdrop-blur-sm',
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const focusRunIdRef = useRef(0);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      focusRunIdRef.current += 1;
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const focusModalContentNow = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;

    const focusTarget =
      content.querySelector<HTMLElement>(AUTOFOCUS_SELECTOR) ??
      content.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      content;
    focusTarget.focus();
  }, []);

  const focusModalContent = useCallback(() => {
    const focusRunId = focusRunIdRef.current + 1;
    focusRunIdRef.current = focusRunId;
    focusModalContentNow();

    queueMicrotask(() => {
      if (focusRunId !== focusRunIdRef.current) return;
      focusModalContentNow();
    });
  }, [focusModalContentNow]);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay className={backdropClass} style={{ zIndex }} />
        <DialogPrimitive.Content
          ref={contentRef}
          aria-label="Dialog"
          aria-modal="true"
          aria-describedby={undefined}
          className="fixed inset-0 flex items-center justify-center p-4 outline-none"
          style={{ zIndex: zIndex + 1 }}
          tabIndex={-1}
          onClick={handleBackdropClick}
          onEscapeKeyDown={(e) => {
            if (!closeOnEsc) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            if (!closeOnBackdrop) {
              e.preventDefault();
            }
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            focusModalContent();
          }}
        >
          <DialogTitle className="sr-only">Dialog</DialogTitle>
          {children}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};

export default Modal;
