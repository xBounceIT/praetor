import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  zIndex?: number;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  backdropClass?: string;
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  zIndex = 60,
  closeOnBackdrop = true,
  closeOnEsc = true,
  backdropClass = 'bg-black/60 backdrop-blur-sm',
}) => {
  const handleEscKey = useCallback(
    (e: KeyboardEvent) => {
      if (closeOnEsc && e.key === 'Escape') {
        onClose();
      }
    },
    [onClose, closeOnEsc],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscKey);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscKey]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && e.target === e.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 ${backdropClass}`}
      style={{ zIndex }}
      onClick={handleBackdropClick}
    >
      {children}
    </div>,
    document.body,
  );
};

export default Modal;
