export const LEGACY_CONTACT_COLUMN_ID = 'contact';

type EmployeeContactFields = {
  email?: string | null;
  phone?: string | null;
};

export const getEmployeeContactValue = (employee: EmployeeContactFields) =>
  [employee.email, employee.phone].filter(Boolean).join(' ');

export const mapLegacyContactFilterValue = (value: string) => {
  const trimmed = value.trim();
  return trimmed;
};
