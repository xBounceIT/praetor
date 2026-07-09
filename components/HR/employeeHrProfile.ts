import type {
  ResponsibleUserOption,
  User,
  UserContractType,
  UserEmploymentStatus,
  UserWorkLocation,
  WorkUnit,
} from '../../types';
import type { StatusType } from '../shared/StatusBadge';

export type EmployeeHrFormData = {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  department: string;
  responsibleUserId: string;
  responsibleUserName: string;
  employeeCode: string;
  hireDate: string;
  terminationDate: string;
  contractType: UserContractType | '';
  employmentStatus: UserEmploymentStatus | '';
  workLocation: UserWorkLocation | '';
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes: string;
  costPerHour: string;
};

export type EmployeeHrSubmitPayload = Partial<User> & { costPerHour?: number };
export type EmployeeCreatePayload = EmployeeHrSubmitPayload & { name: string };

export type EmployeeSectionKey = 'internalEmployees' | 'externalEmployees';

export const CONTRACT_TYPE_OPTIONS: UserContractType[] = [
  'permanent',
  'fixed_term',
  'contractor',
  'internship',
  'consultant',
  'other',
];

export const EMPLOYMENT_STATUS_OPTIONS: UserEmploymentStatus[] = [
  'active',
  'onboarding',
  'on_leave',
  'terminated',
];

export const WORK_LOCATION_OPTIONS: UserWorkLocation[] = [
  'office',
  'remote',
  'hybrid',
  'customer_site',
  'other',
];

export const createEmptyEmployeeHrForm = (): EmployeeHrFormData => ({
  name: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  jobTitle: '',
  department: '',
  responsibleUserId: '',
  responsibleUserName: '',
  employeeCode: '',
  hireDate: '',
  terminationDate: '',
  contractType: '',
  employmentStatus: '',
  workLocation: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  notes: '',
  costPerHour: '',
});

export const createEmployeeHrForm = (employee: User): EmployeeHrFormData => ({
  name: employee.name || '',
  firstName: employee.firstName || '',
  lastName: employee.lastName || '',
  email: employee.email || '',
  phone: employee.phone || '',
  jobTitle: employee.jobTitle || '',
  department: employee.department || '',
  responsibleUserId: employee.responsibleUserId || '',
  responsibleUserName: employee.responsibleUserName || '',
  employeeCode: employee.employeeCode || '',
  hireDate: employee.hireDate || '',
  terminationDate: employee.terminationDate || '',
  contractType: employee.contractType || '',
  employmentStatus: employee.employmentStatus || '',
  workLocation: employee.workLocation || '',
  emergencyContactName: employee.emergencyContactName || '',
  emergencyContactPhone: employee.emergencyContactPhone || '',
  notes: employee.notes || '',
  costPerHour: employee.costPerHour?.toString() || '',
});

const nullableText = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const buildEmployeeHrPayload = (
  formData: EmployeeHrFormData,
  options: { includeIdentity: boolean; includeCost: boolean },
): EmployeeHrSubmitPayload => {
  const payload: EmployeeHrSubmitPayload = {
    phone: nullableText(formData.phone),
    jobTitle: nullableText(formData.jobTitle),
    responsibleUserId: nullableText(formData.responsibleUserId),
    employeeCode: nullableText(formData.employeeCode),
    hireDate: formData.hireDate || null,
    terminationDate: formData.terminationDate || null,
    contractType: formData.contractType || null,
    employmentStatus: formData.employmentStatus || null,
    workLocation: formData.workLocation || null,
    emergencyContactName: nullableText(formData.emergencyContactName),
    emergencyContactPhone: nullableText(formData.emergencyContactPhone),
    notes: nullableText(formData.notes),
  };

  if (options.includeIdentity) {
    payload.name = formData.name.trim();
    payload.firstName = nullableText(formData.firstName);
    payload.lastName = nullableText(formData.lastName);
    payload.email = formData.email.trim();
  }

  if (options.includeCost) {
    payload.costPerHour = formData.costPerHour ? parseFloat(formData.costPerHour) : 0;
  }

  return payload;
};

export const buildEmployeeCreatePayload = (
  formData: EmployeeHrFormData,
  options: { includeCost: boolean; includeHrDetails?: boolean },
): EmployeeCreatePayload => {
  const payload: EmployeeCreatePayload = {
    name: formData.name.trim(),
  };

  if (options.includeHrDetails ?? true) {
    Object.assign(
      payload,
      buildEmployeeHrPayload(formData, {
        includeIdentity: false,
        includeCost: options.includeCost,
      }),
      {
        firstName: nullableText(formData.firstName),
        lastName: nullableText(formData.lastName),
        email: formData.email.trim(),
      },
    );
  } else if (options.includeCost) {
    payload.costPerHour = formData.costPerHour ? parseFloat(formData.costPerHour) : 0;
  }

  return payload;
};

export const getEmployeeDepartmentDisplay = (
  employee: Pick<User, 'id' | 'department'> | null | undefined,
  workUnits: WorkUnit[],
): string => {
  if (!employee) return '';
  const names: string[] = [];
  for (const unit of workUnits) {
    if (unit.isDisabled) continue;
    if (!unit.members?.some((member) => member.id === employee.id)) continue;
    const name = unit.name.trim();
    if (name) names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b));

  if (names.length > 0) return names.join(', ');
  return workUnits.length === 0 ? employee.department || '' : '';
};

export const getResponsibleUserDisplay = (
  employee: Pick<User, 'responsibleUserId' | 'responsibleUserName'>,
  responsibleUserOptions: ResponsibleUserOption[],
): string => {
  const name = employee.responsibleUserName?.trim();
  if (name) return name;
  if (!employee.responsibleUserId) return '';
  return (
    responsibleUserOptions.find((option) => option.id === employee.responsibleUserId)?.name || ''
  );
};

export const getEmployeeHrStatusBadgeType = (
  status: UserEmploymentStatus | null | undefined,
): StatusType => {
  if (status === 'terminated') return 'disabled';
  if (status === 'onboarding' || status === 'on_leave') return 'pending';
  return 'active';
};

const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const validateEmployeeHrForm = (
  formData: EmployeeHrFormData,
  options: {
    identityReadOnly: boolean;
    requiredMessage: string;
    invalidEmailMessage: string;
    dateRangeMessage: string;
  },
): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (!formData.name?.trim()) {
    errors.name = options.requiredMessage;
  }
  if (!options.identityReadOnly && formData.email.trim() && !isValidEmail(formData.email.trim())) {
    errors.email = options.invalidEmailMessage;
  }
  if (
    formData.hireDate &&
    formData.terminationDate &&
    formData.hireDate > formData.terminationDate
  ) {
    errors.terminationDate = options.dateRangeMessage;
  }
  return errors;
};
