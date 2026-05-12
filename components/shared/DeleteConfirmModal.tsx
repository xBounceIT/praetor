import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import { ModalBody, ModalContent, ModalFooter, ModalHeader, ModalTitle } from './ModalLayout';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  isDeleting?: boolean;
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  isDeleting = false,
}) => {
  const { t } = useTranslation('common');
  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={null}>
      {() => (
        <ModalContent size="sm">
          <ModalHeader className="justify-center text-center">
            <div className="space-y-3">
              <div className="size-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto text-destructive">
                <i className="fa-solid fa-triangle-exclamation text-xl"></i>
              </div>
              <ModalTitle className="justify-center">{title}</ModalTitle>
            </div>
          </ModalHeader>
          {description && (
            <ModalBody className="text-center text-sm text-muted-foreground leading-relaxed">
              {description}
            </ModalBody>
          )}
          <ModalFooter className="grid grid-cols-2 sm:flex">
            <Button type="button" variant="outline" onClick={onClose} disabled={isDeleting}>
              {t('buttons.noGoBack')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? t('buttons.saving') : t('buttons.yesDelete')}
            </Button>
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
};

export default DeleteConfirmModal;
