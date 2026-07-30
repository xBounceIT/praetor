import type React from 'react';
import { Button } from '@/components/ui/button';
import type { ResponsibleUserOption, User } from '../../types';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import EmployeeHrFields from './EmployeeHrFields';
import type { EmployeeHourlyCostPeriodDraft, EmployeeHrFormData } from './employeeHrProfile';

interface EmployeeEditorModalProps {
  copy: {
    title: string;
    cancel: string;
    save: string;
  };
  model: {
    isOpen: boolean;
    editingEmployee: User | null;
    formData: EmployeeHrFormData;
    errors: Record<string, string>;
    hourlyCostPeriods: EmployeeHourlyCostPeriodDraft[];
    hourlyCostStatus: {
      loading: boolean;
      error: string | null;
    };
    departmentValue: string;
    responsibleUserOptions: ResponsibleUserOption[];
    currency: string;
    isSubmitting: boolean;
  };
  access: {
    showSave: boolean;
    editCosts: boolean;
    viewCosts: boolean;
    updateCosts: boolean;
    identityReadOnly: boolean;
    editHrDetails: boolean;
    editFullName?: boolean;
  };
  actions: {
    close: () => void;
    submit: (event: React.FormEvent) => void;
    setFormData: React.Dispatch<React.SetStateAction<EmployeeHrFormData>>;
    setHourlyCostPeriods: React.Dispatch<React.SetStateAction<EmployeeHourlyCostPeriodDraft[]>>;
  };
  prefix: string;
}

const EmployeeEditorModal: React.FC<EmployeeEditorModalProps> = ({
  copy,
  model,
  access,
  actions,
  prefix,
}) => {
  const {
    currency,
    departmentValue,
    editingEmployee,
    errors,
    formData,
    hourlyCostPeriods,
    hourlyCostStatus,
    isOpen,
    isSubmitting,
    responsibleUserOptions,
  } = model;
  const isSaveDisabled =
    isSubmitting ||
    (access.editCosts && (hourlyCostStatus.loading || Boolean(hourlyCostStatus.error)));

  return (
    <Modal isOpen={isOpen} onClose={actions.close}>
      <ModalContent size="2xl">
        <form onSubmit={actions.submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <ModalHeader>
            <ModalTitle className="gap-3">
              <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                <i
                  className={`fa-solid ${editingEmployee ? 'fa-pen-to-square' : 'fa-plus'}`}
                  aria-hidden="true"
                />
              </span>
              {copy.title}
            </ModalTitle>
            <ModalCloseButton onClick={actions.close} />
          </ModalHeader>

          <ModalBody className="space-y-6">
            {errors.submit && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {errors.submit}
              </div>
            )}

            <EmployeeHrFields
              prefix={prefix}
              formData={formData}
              errors={errors}
              setFormData={actions.setFormData}
              currency={currency}
              hourlyCostPeriods={hourlyCostPeriods}
              setHourlyCostPeriods={actions.setHourlyCostPeriods}
              hourlyCostStatus={hourlyCostStatus}
              access={{
                viewCosts: access.viewCosts,
                updateCosts: access.updateCosts,
                identityReadOnly: access.identityReadOnly,
                editHrDetails: access.editHrDetails,
                editFullName: access.editFullName,
              }}
              departmentValue={departmentValue}
              responsibleUserOptions={responsibleUserOptions}
              currentEmployeeId={editingEmployee?.id ?? null}
            />
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={actions.close}>
              {copy.cancel}
            </Button>
            {access.showSave && (
              <Button type="submit" disabled={isSaveDisabled}>
                {isSubmitting ? (
                  <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                ) : (
                  copy.save
                )}
              </Button>
            )}
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

export default EmployeeEditorModal;
