import { Dialog as DialogPrimitive } from 'radix-ui';
import type React from 'react';
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  ariaLabel?: string | null;
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

const TEXT_LIKE_INPUT_TYPES = new Set([
  '',
  'date',
  'datetime-local',
  'email',
  'month',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'time',
  'url',
  'week',
]);

const isTextLikeInput = (props: React.ComponentProps<'input'>) =>
  TEXT_LIKE_INPUT_TYPES.has(String(props.type ?? '').toLowerCase());

const renderWithShadcnFormPrimitives = (node: React.ReactNode): React.ReactNode => {
  if (!isValidElement(node)) return node;

  const props = node.props as { children?: React.ReactNode };
  const children =
    props.children === undefined
      ? props.children
      : Children.map(props.children, renderWithShadcnFormPrimitives);
  const nextProps = children === props.children ? undefined : { children };

  if (node.type === 'button' && !(node.props as React.ComponentProps<'button'>).className) {
    return <Button {...(node.props as React.ComponentProps<'button'>)}>{children}</Button>;
  }

  if (node.type === 'input' && isTextLikeInput(node.props as React.ComponentProps<'input'>)) {
    return <Input {...(node.props as React.ComponentProps<'input'>)} />;
  }

  if (node.type === 'textarea') {
    return <Textarea {...(node.props as React.ComponentProps<'textarea'>)}>{children}</Textarea>;
  }

  if (node.type === 'label' && (node.props as React.ComponentProps<'label'>).htmlFor) {
    return <FieldLabel {...(node.props as React.ComponentProps<'label'>)}>{children}</FieldLabel>;
  }

  return nextProps ? cloneElement(node, nextProps) : node;
};

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  ariaLabel = 'Dialog',
  zIndex = 60,
  closeOnBackdrop = true,
  closeOnEsc = true,
  backdropClass = 'bg-black/60 backdrop-blur-sm',
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const focusRunIdRef = useRef(0);
  const normalizedChildren = useMemo(
    () => (isOpen ? Children.map(children, renderWithShadcnFormPrimitives) : null),
    [children, isOpen],
  );

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
          {ariaLabel ? <DialogTitle className="sr-only">{ariaLabel}</DialogTitle> : null}
          {normalizedChildren}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};

export default Modal;
