import type React from 'react';
import { useCallback, useReducer } from 'react';
import type { HourlyCostPeriod, User } from '../../types';
import {
  createEmployeeHrForm,
  createEmptyEmployeeHrForm,
  createHourlyCostPeriodDrafts,
  createInitialHourlyCostPeriods,
  type EmployeeHourlyCostPeriodDraft,
  type EmployeeHrFormData,
} from './employeeHrProfile';

type EmployeeViewState = {
  isModalOpen: boolean;
  editingEmployee: User | null;
  managingEmployee: User | null;
  isDeleteConfirmOpen: boolean;
  employeeToDelete: User | null;
  isDeleting: boolean;
  deleteError: string | null;
  errors: Record<string, string>;
  isSubmitting: boolean;
  formData: EmployeeHrFormData;
  hourlyCostPeriods: EmployeeHourlyCostPeriodDraft[];
  isHourlyCostPeriodsLoading: boolean;
  hourlyCostPeriodsLoadingUserId: string | null;
  hourlyCostPeriodsLoadError: string | null;
};

type EmployeeViewAction =
  | { type: 'openAdd' }
  | { type: 'openEdit'; employee: User }
  | { type: 'closeModal' }
  | { type: 'setManagingEmployee'; employee: User | null }
  | { type: 'confirmDelete'; employee: User }
  | { type: 'deleteStart' }
  | { type: 'deleteFail'; error: string }
  | { type: 'deleteSuccess' }
  | { type: 'setErrors'; errors: Record<string, string> }
  | { type: 'submitStart' }
  | { type: 'submitDone' }
  | { type: 'submitSuccess' }
  | { type: 'setFormData'; update: React.SetStateAction<EmployeeHrFormData> }
  | { type: 'hourlyCostPeriodsLoadStart'; userId: string }
  | { type: 'hourlyCostPeriodsLoadSuccess'; userId: string; periods: HourlyCostPeriod[] }
  | { type: 'hourlyCostPeriodsLoadError'; userId: string; error: string }
  | {
      type: 'setHourlyCostPeriods';
      update: React.SetStateAction<EmployeeHourlyCostPeriodDraft[]>;
    };

const createEmployeeViewState = (): EmployeeViewState => ({
  isModalOpen: false,
  editingEmployee: null,
  managingEmployee: null,
  isDeleteConfirmOpen: false,
  employeeToDelete: null,
  isDeleting: false,
  deleteError: null,
  errors: {},
  isSubmitting: false,
  formData: createEmptyEmployeeHrForm(),
  hourlyCostPeriods: createInitialHourlyCostPeriods(),
  isHourlyCostPeriodsLoading: false,
  hourlyCostPeriodsLoadError: null,
  hourlyCostPeriodsLoadingUserId: null,
});

const resolveFormDataUpdate = (
  update: React.SetStateAction<EmployeeHrFormData>,
  current: EmployeeHrFormData,
): EmployeeHrFormData => (typeof update === 'function' ? update(current) : update);

const resolveHourlyCostPeriodsUpdate = (
  update: React.SetStateAction<EmployeeHourlyCostPeriodDraft[]>,
  current: EmployeeHourlyCostPeriodDraft[],
): EmployeeHourlyCostPeriodDraft[] => (typeof update === 'function' ? update(current) : update);

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
        hourlyCostPeriods: createInitialHourlyCostPeriods(),
        isHourlyCostPeriodsLoading: false,
        hourlyCostPeriodsLoadError: null,
        errors: {},
        hourlyCostPeriodsLoadingUserId: null,
      };
    case 'openEdit':
      return {
        ...state,
        isModalOpen: true,
        editingEmployee: action.employee,
        formData: createEmployeeHrForm(action.employee),
        hourlyCostPeriods: createInitialHourlyCostPeriods(action.employee.costPerHour ?? ''),
        isHourlyCostPeriodsLoading: false,
        hourlyCostPeriodsLoadError: null,
        errors: {},
        hourlyCostPeriodsLoadingUserId: null,
      };
    case 'closeModal':
      return {
        ...state,
        isModalOpen: false,
        isHourlyCostPeriodsLoading: false,
        hourlyCostPeriodsLoadingUserId: null,
      };
    case 'setManagingEmployee':
      return { ...state, managingEmployee: action.employee };
    case 'confirmDelete':
      return {
        ...state,
        employeeToDelete: action.employee,
        isDeleteConfirmOpen: true,
        isDeleting: false,
        deleteError: null,
      };
    case 'deleteStart':
      return { ...state, isDeleting: true, deleteError: null };
    case 'deleteFail':
      return { ...state, isDeleting: false, deleteError: action.error };
    case 'deleteSuccess':
      return {
        ...state,
        employeeToDelete: null,
        isDeleteConfirmOpen: false,
        isDeleting: false,
        deleteError: null,
      };
    case 'setErrors':
      return { ...state, errors: action.errors };
    case 'submitStart':
      return { ...state, isSubmitting: true };
    case 'submitDone':
      return { ...state, isSubmitting: false };
    case 'submitSuccess':
      return {
        ...state,
        isModalOpen: false,
        isHourlyCostPeriodsLoading: false,
        hourlyCostPeriodsLoadingUserId: null,
      };
    case 'setFormData':
      return { ...state, formData: resolveFormDataUpdate(action.update, state.formData) };
    case 'hourlyCostPeriodsLoadStart':
      if (!state.isModalOpen || state.editingEmployee?.id !== action.userId) return state;
      return {
        ...state,
        isHourlyCostPeriodsLoading: true,
        hourlyCostPeriodsLoadingUserId: action.userId,
        hourlyCostPeriodsLoadError: null,
      };
    case 'hourlyCostPeriodsLoadSuccess':
      if (state.hourlyCostPeriodsLoadingUserId !== action.userId) return state;
      return {
        ...state,
        hourlyCostPeriods: createHourlyCostPeriodDrafts(action.periods),
        isHourlyCostPeriodsLoading: false,
        hourlyCostPeriodsLoadingUserId: null,
        hourlyCostPeriodsLoadError: null,
      };
    case 'hourlyCostPeriodsLoadError':
      if (state.hourlyCostPeriodsLoadingUserId !== action.userId) return state;
      return {
        ...state,
        isHourlyCostPeriodsLoading: false,
        hourlyCostPeriodsLoadingUserId: null,
        hourlyCostPeriodsLoadError: action.error,
      };
    case 'setHourlyCostPeriods':
      return {
        ...state,
        hourlyCostPeriods: resolveHourlyCostPeriodsUpdate(action.update, state.hourlyCostPeriods),
      };
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
  const setHourlyCostPeriods = useCallback<
    React.Dispatch<React.SetStateAction<EmployeeHourlyCostPeriodDraft[]>>
  >((update) => dispatch({ type: 'setHourlyCostPeriods', update }), []);

  return {
    state,
    setFormData,
    setHourlyCostPeriods,
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
    startEmployeeDelete: useCallback(() => dispatch({ type: 'deleteStart' }), []),
    failEmployeeDelete: useCallback((error: string) => dispatch({ type: 'deleteFail', error }), []),
    completeEmployeeDelete: useCallback(() => dispatch({ type: 'deleteSuccess' }), []),
    setEmployeeErrors: useCallback(
      (errors: Record<string, string>) => dispatch({ type: 'setErrors', errors }),
      [],
    ),
    startEmployeeSubmit: useCallback(() => dispatch({ type: 'submitStart' }), []),
    finishEmployeeSubmit: useCallback(() => dispatch({ type: 'submitDone' }), []),
    completeEmployeeSubmit: useCallback(() => dispatch({ type: 'submitSuccess' }), []),
    startHourlyCostPeriodsLoad: useCallback(
      (userId: string) => dispatch({ type: 'hourlyCostPeriodsLoadStart', userId }),
      [],
    ),
    completeHourlyCostPeriodsLoad: useCallback(
      (userId: string, periods: HourlyCostPeriod[]) =>
        dispatch({ type: 'hourlyCostPeriodsLoadSuccess', userId, periods }),
      [],
    ),
    failHourlyCostPeriodsLoad: useCallback(
      (userId: string, error: string) =>
        dispatch({ type: 'hourlyCostPeriodsLoadError', userId, error }),
      [],
    ),
  };
};
