import type React from 'react';
import { useCallback, useReducer } from 'react';
import type { User } from '../../types';
import {
  createEmployeeHrForm,
  createEmptyEmployeeHrForm,
  type EmployeeHrFormData,
} from './employeeHrProfile';

type EmployeeViewState = {
  isModalOpen: boolean;
  editingEmployee: User | null;
  managingEmployee: User | null;
  isDeleteConfirmOpen: boolean;
  employeeToDelete: User | null;
  errors: Record<string, string>;
  isSubmitting: boolean;
  formData: EmployeeHrFormData;
};

type EmployeeViewAction =
  | { type: 'openAdd' }
  | { type: 'openEdit'; employee: User }
  | { type: 'closeModal' }
  | { type: 'setManagingEmployee'; employee: User | null }
  | { type: 'confirmDelete'; employee: User }
  | { type: 'deleteSuccess' }
  | { type: 'setErrors'; errors: Record<string, string> }
  | { type: 'submitStart' }
  | { type: 'submitDone' }
  | { type: 'submitSuccess' }
  | { type: 'setFormData'; update: React.SetStateAction<EmployeeHrFormData> };

const createEmployeeViewState = (): EmployeeViewState => ({
  isModalOpen: false,
  editingEmployee: null,
  managingEmployee: null,
  isDeleteConfirmOpen: false,
  employeeToDelete: null,
  errors: {},
  isSubmitting: false,
  formData: createEmptyEmployeeHrForm(),
});

const resolveFormDataUpdate = (
  update: React.SetStateAction<EmployeeHrFormData>,
  current: EmployeeHrFormData,
): EmployeeHrFormData => (typeof update === 'function' ? update(current) : update);

const employeeViewReducer = (
  state: EmployeeViewState,
  action: EmployeeViewAction,
): EmployeeViewState => {
  switch (action.type) {
    case 'openAdd':
      return {
        ...state,
        isModalOpen: true,
        editingEmployee: null,
        formData: createEmptyEmployeeHrForm(),
        errors: {},
      };
    case 'openEdit':
      return {
        ...state,
        isModalOpen: true,
        editingEmployee: action.employee,
        formData: createEmployeeHrForm(action.employee),
        errors: {},
      };
    case 'closeModal':
      return { ...state, isModalOpen: false };
    case 'setManagingEmployee':
      return { ...state, managingEmployee: action.employee };
    case 'confirmDelete':
      return { ...state, employeeToDelete: action.employee, isDeleteConfirmOpen: true };
    case 'deleteSuccess':
      return { ...state, employeeToDelete: null, isDeleteConfirmOpen: false };
    case 'setErrors':
      return { ...state, errors: action.errors };
    case 'submitStart':
      return { ...state, isSubmitting: true };
    case 'submitDone':
      return { ...state, isSubmitting: false };
    case 'submitSuccess':
      return { ...state, isModalOpen: false };
    case 'setFormData':
      return { ...state, formData: resolveFormDataUpdate(action.update, state.formData) };
    default:
      return state;
  }
};

export const useEmployeeViewState = () => {
  const [state, dispatch] = useReducer(employeeViewReducer, undefined, createEmployeeViewState);

  const setFormData = useCallback<React.Dispatch<React.SetStateAction<EmployeeHrFormData>>>(
    (update) => dispatch({ type: 'setFormData', update }),
    [],
  );

  return {
    state,
    setFormData,
    openAddEmployeeModal: useCallback(() => dispatch({ type: 'openAdd' }), []),
    openEditEmployeeModal: useCallback(
      (employee: User) => dispatch({ type: 'openEdit', employee }),
      [],
    ),
    closeEmployeeModal: useCallback(() => dispatch({ type: 'closeModal' }), []),
    setManagingEmployee: useCallback(
      (employee: User | null) => dispatch({ type: 'setManagingEmployee', employee }),
      [],
    ),
    confirmEmployeeDelete: useCallback(
      (employee: User) => dispatch({ type: 'confirmDelete', employee }),
      [],
    ),
    completeEmployeeDelete: useCallback(() => dispatch({ type: 'deleteSuccess' }), []),
    setEmployeeErrors: useCallback(
      (errors: Record<string, string>) => dispatch({ type: 'setErrors', errors }),
      [],
    ),
    startEmployeeSubmit: useCallback(() => dispatch({ type: 'submitStart' }), []),
    finishEmployeeSubmit: useCallback(() => dispatch({ type: 'submitDone' }), []),
    completeEmployeeSubmit: useCallback(() => dispatch({ type: 'submitSuccess' }), []),
  };
};
