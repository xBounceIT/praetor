import type React from 'react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ResponsibleUserOption } from '../../types';
import DateField from '../shared/DateField';
import SelectControl, { type Option } from '../shared/SelectControl';
import EmployeeHourlyCostPeriodsTable from './EmployeeHourlyCostPeriodsTable';
import {
  CONTRACT_TYPE_OPTIONS,
  EMPLOYMENT_STATUS_OPTIONS,
  type EmployeeHourlyCostPeriodDraft,
  type EmployeeHrFormData,
  WORK_LOCATION_OPTIONS,
} from './employeeHrProfile';

const NONE_SELECT_VALUE = '__none__';
const EMPTY_RESPONSIBLE_USER_OPTIONS: ResponsibleUserOption[] = [];

type EmployeeHrFieldsProps = {
  prefix: string;
  formData: EmployeeHrFormData;
  errors: Record<string, string>;
  setFormData: React.Dispatch<React.SetStateAction<EmployeeHrFormData>>;
  currency: string;
  hourlyCostPeriods: EmployeeHourlyCostPeriodDraft[];
  setHourlyCostPeriods: React.Dispatch<React.SetStateAction<EmployeeHourlyCostPeriodDraft[]>>;
  isHourlyCostPeriodsLoading: boolean;
  hourlyCostPeriodsLoadError: string | null;
  canViewCosts: boolean;
  canUpdateCosts: boolean;
  identityReadOnly: boolean;
  canEditHrDetails?: boolean;
  canEditFullName?: boolean;
  departmentValue?: string;
  responsibleUserOptions?: ResponsibleUserOption[];
  currentEmployeeId?: string | null;
};

type SelectFieldProps<T extends string> = {
  id: string;
  label: string;
  value: T | '';
  options: readonly T[];
  optionPrefix: string;
  onChange: (value: T | '') => void;
  disabled?: boolean;
};

const EmployeeSelectField = <T extends string>({
  id,
  label,
  value,
  options,
  optionPrefix,
  onChange,
  disabled = false,
}: SelectFieldProps<T>) => {
  const { t } = useTranslation(['hr']);

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value || NONE_SELECT_VALUE}
        disabled={disabled}
        onValueChange={(nextValue) =>
          onChange(nextValue === NONE_SELECT_VALUE ? '' : (nextValue as T))
        }
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_SELECT_VALUE}>{t('employeeProfile.notSet')}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {t(`${optionPrefix}.${option}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
};

const buildResponsibleOptions = (
  responsibleUserOptions: ResponsibleUserOption[],
  currentEmployeeId: string | null,
  responsibleUserId: string,
  responsibleUserName: string,
  notSetLabel: string,
): Option[] => {
  const options: Option[] = [];
  for (const option of responsibleUserOptions) {
    if (option.id === currentEmployeeId) continue;
    options.push({
      id: option.id,
      name: option.username ? `${option.name} (${option.username})` : option.name,
    });
  }

  if (responsibleUserId && !options.some((option) => option.id === responsibleUserId)) {
    options.unshift({
      id: responsibleUserId,
      name: responsibleUserName || responsibleUserId,
    });
  }

  return [{ id: '', name: notSetLabel }, ...options];
};

const useResponsibleSelect = ({
  currentEmployeeId,
  formData,
  notSetLabel,
  responsibleUserOptions,
  setFormData,
}: {
  currentEmployeeId: string | null;
  formData: EmployeeHrFormData;
  notSetLabel: string;
  responsibleUserOptions: ResponsibleUserOption[];
  setFormData: React.Dispatch<React.SetStateAction<EmployeeHrFormData>>;
}) => {
  const responsibleOptions = useMemo(
    () =>
      buildResponsibleOptions(
        responsibleUserOptions,
        currentEmployeeId,
        formData.responsibleUserId,
        formData.responsibleUserName,
        notSetLabel,
      ),
    [
      currentEmployeeId,
      formData.responsibleUserId,
      formData.responsibleUserName,
      notSetLabel,
      responsibleUserOptions,
    ],
  );

  const handleResponsibleChange = useCallback(
    (value: string | string[]) => {
      const responsibleUserId = Array.isArray(value) ? '' : value;
      const selected = responsibleUserOptions.find((option) => option.id === responsibleUserId);
      setFormData((prev) => ({
        ...prev,
        responsibleUserId,
        responsibleUserName: selected?.name || '',
      }));
    },
    [responsibleUserOptions, setFormData],
  );

  return { handleResponsibleChange, responsibleOptions };
};

const EmployeeHrFields: React.FC<EmployeeHrFieldsProps> = ({
  prefix,
  formData,
  errors,
  setFormData,
  currency,
  hourlyCostPeriods,
  setHourlyCostPeriods,
  isHourlyCostPeriodsLoading,
  hourlyCostPeriodsLoadError,
  canViewCosts,
  canUpdateCosts,
  identityReadOnly,
  canEditHrDetails = true,
  canEditFullName = canEditHrDetails,
  departmentValue,
  responsibleUserOptions = EMPTY_RESPONSIBLE_USER_OPTIONS,
  currentEmployeeId = null,
}) => {
  const { t } = useTranslation(['hr', 'common']);
  const notSetLabel = t('employeeProfile.notSet');

  const setField = <K extends keyof EmployeeHrFormData>(field: K, value: EmployeeHrFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const { handleResponsibleChange, responsibleOptions } = useResponsibleSelect({
    currentEmployeeId,
    formData,
    notSetLabel,
    responsibleUserOptions,
    setFormData,
  });

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t('employeeProfile.contactSection')}
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor={`${prefix}-name`} required>
              {t('common:labels.fullName')}
            </FieldLabel>
            <Input
              id={`${prefix}-name`}
              type="text"
              value={formData.name}
              onChange={(e) => setField('name', e.target.value)}
              aria-invalid={Boolean(errors.name)}
              placeholder={t('common:labels.fullName')}
              disabled={identityReadOnly || !canEditFullName}
            />
            <FieldError className="text-xs">{errors.name}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${prefix}-firstName`}>
              {t('employeeProfile.firstName')}
            </FieldLabel>
            <Input
              id={`${prefix}-firstName`}
              type="text"
              value={formData.firstName}
              onChange={(e) => setField('firstName', e.target.value)}
              placeholder={t('employeeProfile.firstName')}
              disabled={identityReadOnly || !canEditHrDetails}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${prefix}-lastName`}>{t('employeeProfile.lastName')}</FieldLabel>
            <Input
              id={`${prefix}-lastName`}
              type="text"
              value={formData.lastName}
              onChange={(e) => setField('lastName', e.target.value)}
              placeholder={t('employeeProfile.lastName')}
              disabled={identityReadOnly || !canEditHrDetails}
            />
          </Field>

          <Field data-invalid={Boolean(errors.email)}>
            <FieldLabel htmlFor={`${prefix}-email`}>{t('employeeProfile.email')}</FieldLabel>
            <Input
              id={`${prefix}-email`}
              type="email"
              value={formData.email}
              onChange={(e) => setField('email', e.target.value)}
              aria-invalid={Boolean(errors.email)}
              placeholder="name@example.com"
              disabled={identityReadOnly || !canEditHrDetails}
            />
            <FieldError className="text-xs">{errors.email}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${prefix}-phone`}>{t('employeeProfile.phone')}</FieldLabel>
            <Input
              id={`${prefix}-phone`}
              type="tel"
              value={formData.phone}
              onChange={(e) => setField('phone', e.target.value)}
              disabled={!canEditHrDetails}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t('employeeProfile.employmentSection')}
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          <Field>
            <FieldLabel htmlFor={`${prefix}-job-title`}>{t('employeeProfile.jobTitle')}</FieldLabel>
            <Input
              id={`${prefix}-job-title`}
              value={formData.jobTitle}
              onChange={(e) => setField('jobTitle', e.target.value)}
              disabled={!canEditHrDetails}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${prefix}-department`}>
              {t('employeeProfile.department')}
            </FieldLabel>
            <output
              id={`${prefix}-department`}
              className="flex min-h-9 cursor-default items-center rounded-md border border-dashed border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
            >
              {(departmentValue ?? formData.department) || notSetLabel}
            </output>
          </Field>

          <SelectControl
            id={`${prefix}-responsible`}
            label={t('employeeProfile.responsible')}
            options={responsibleOptions}
            value={formData.responsibleUserId}
            onChange={handleResponsibleChange}
            searchable
            placeholder={notSetLabel}
            displayValueIsPlaceholder={!formData.responsibleUserId}
            disabled={!canEditHrDetails}
          />

          <Field>
            <FieldLabel htmlFor={`${prefix}-employee-code`}>
              {t('employeeProfile.employeeCode')}
            </FieldLabel>
            <Input
              id={`${prefix}-employee-code`}
              value={formData.employeeCode}
              onChange={(e) => setField('employeeCode', e.target.value)}
              disabled={!canEditHrDetails}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${prefix}-hire-date`}>{t('employeeProfile.hireDate')}</FieldLabel>
            <DateField
              id={`${prefix}-hire-date`}
              value={formData.hireDate}
              onChange={(value) => setField('hireDate', value)}
              disabled={!canEditHrDetails}
            />
          </Field>

          <Field data-invalid={Boolean(errors.terminationDate)}>
            <FieldLabel htmlFor={`${prefix}-termination-date`}>
              {t('employeeProfile.terminationDate')}
            </FieldLabel>
            <DateField
              id={`${prefix}-termination-date`}
              value={formData.terminationDate}
              onChange={(value) => setField('terminationDate', value)}
              aria-invalid={Boolean(errors.terminationDate)}
              disabled={!canEditHrDetails}
            />
            <FieldError className="text-xs">{errors.terminationDate}</FieldError>
          </Field>

          <EmployeeSelectField
            id={`${prefix}-contract-type`}
            label={t('employeeProfile.contractType')}
            value={formData.contractType}
            options={CONTRACT_TYPE_OPTIONS}
            optionPrefix="employeeProfile.contractTypes"
            onChange={(value) => setField('contractType', value)}
            disabled={!canEditHrDetails}
          />

          <EmployeeSelectField
            id={`${prefix}-employment-status`}
            label={t('employeeProfile.employmentStatus')}
            value={formData.employmentStatus}
            options={EMPLOYMENT_STATUS_OPTIONS}
            optionPrefix="employeeProfile.employmentStatuses"
            onChange={(value) => setField('employmentStatus', value)}
            disabled={!canEditHrDetails}
          />

          <EmployeeSelectField
            id={`${prefix}-work-location`}
            label={t('employeeProfile.workLocation')}
            value={formData.workLocation}
            options={WORK_LOCATION_OPTIONS}
            optionPrefix="employeeProfile.workLocations"
            onChange={(value) => setField('workLocation', value)}
            disabled={!canEditHrDetails}
          />
        </div>
      </section>

      {canViewCosts && (
        <EmployeeHourlyCostPeriodsTable
          periods={hourlyCostPeriods}
          onChange={setHourlyCostPeriods}
          errors={errors}
          currency={currency}
          canUpdate={canUpdateCosts}
          isLoading={isHourlyCostPeriodsLoading}
          loadError={hourlyCostPeriodsLoadError}
        />
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t('employeeProfile.emergencySection')}
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${prefix}-emergency-name`}>
              {t('employeeProfile.emergencyContactName')}
            </FieldLabel>
            <Input
              id={`${prefix}-emergency-name`}
              value={formData.emergencyContactName}
              onChange={(e) => setField('emergencyContactName', e.target.value)}
              disabled={!canEditHrDetails}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${prefix}-emergency-phone`}>
              {t('employeeProfile.emergencyContactPhone')}
            </FieldLabel>
            <Input
              id={`${prefix}-emergency-phone`}
              type="tel"
              value={formData.emergencyContactPhone}
              onChange={(e) => setField('emergencyContactPhone', e.target.value)}
              disabled={!canEditHrDetails}
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor={`${prefix}-address`}>{t('employeeProfile.address')}</FieldLabel>
          <Input
            id={`${prefix}-address`}
            value={formData.address}
            onChange={(e) => setField('address', e.target.value)}
            disabled={!canEditHrDetails}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={`${prefix}-notes`}>{t('employeeProfile.notes')}</FieldLabel>
          <Textarea
            id={`${prefix}-notes`}
            value={formData.notes}
            onChange={(e) => setField('notes', e.target.value)}
            rows={3}
            disabled={!canEditHrDetails}
          />
        </Field>
      </section>
    </div>
  );
};

export default EmployeeHrFields;
