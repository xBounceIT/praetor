import type React from 'react';
import { Children, cloneElement, isValidElement, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useResolvedShadcnTheme } from '@/components/ui/use-shadcn-theme';
import { ModalThemeContext } from './ModalThemeContext';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode | (() => React.ReactNode);
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
  const resolvedTheme = useResolvedShadcnTheme();
  // Resolve children inline rather than memoizing: if `children` is a render
  // prop that itself calls hooks, wrapping the call in `useMemo` would invoke
  // those hooks outside the normal render phase and break the rules of hooks.
  // Identity churn here is fine - children always re-render with the modal.
  const normalizedChildren = !isOpen
    ? null
    : Children.map(
        typeof children === 'function' ? children() : children,
        renderWithShadcnFormPrimitives,
      );

  const cancelPendingFocus = useCallback(() => {
    focusRunIdRef.current += 1;
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      cancelPendingFocus();
      document.body.style.overflow = '';
    };
  }, [isOpen, cancelPendingFocus]);

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

  const handleBackdropClick = () => {
    if (closeOnBackdrop) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        ref={contentRef}
        showCloseButton={false}
        overlayClassName={backdropClass}
        overlayProps={{ onClick: handleBackdropClick }}
        overlayStyle={{ zIndex }}
        aria-modal="true"
        aria-describedby={undefined}
        className="shadcn-theme-bridge fixed inset-0 top-0 left-0 z-auto flex h-dvh w-dvw max-w-none translate-x-0 translate-y-0 items-center justify-center gap-0 rounded-none border-0 bg-transparent p-4 text-foreground shadow-none duration-0 outline-none pointer-events-none [&>*]:pointer-events-auto sm:max-w-none"
        style={{ zIndex: zIndex + 1 }}
        tabIndex={-1}
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
        <ModalThemeContext.Provider value={resolvedTheme}>
          {ariaLabel ? <DialogTitle className="sr-only">{ariaLabel}</DialogTitle> : null}
          {normalizedChildren}
        </ModalThemeContext.Provider>
      </DialogContent>
    </Dialog>
  );
};

export default Modal;
