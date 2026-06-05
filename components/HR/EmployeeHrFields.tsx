import type React from 'react';
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
import DateField from '../shared/DateField';
import {
  CONTRACT_TYPE_OPTIONS,
  EMPLOYMENT_STATUS_OPTIONS,
  type EmployeeHrFormData,
  type EmployeeSectionKey,
  WORK_LOCATION_OPTIONS,
} from './employeeHrProfile';

const NONE_SELECT_VALUE = '__none__';

type EmployeeHrFieldsProps = {
  section: EmployeeSectionKey;
  prefix: string;
  formData: EmployeeHrFormData;
  errors: Record<string, string>;
  setFormData: React.Dispatch<React.SetStateAction<EmployeeHrFormData>>;
  currency: string;
  canViewCosts: boolean;
  canUpdateCosts: boolean;
  identityReadOnly: boolean;
};

type SelectFieldProps<T extends string> = {
  id: string;
  label: string;
  value: T | '';
  options: readonly T[];
  optionPrefix: string;
  onChange: (value: T | '') => void;
};

const EmployeeSelectField = <T extends string>({
  id,
  label,
  value,
  options,
  optionPrefix,
  onChange,
}: SelectFieldProps<T>) => {
  const { t } = useTranslation(['hr']);

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value || NONE_SELECT_VALUE}
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

const EmployeeHrFields: React.FC<EmployeeHrFieldsProps> = ({
  section,
  prefix,
  formData,
  errors,
  setFormData,
  currency,
  canViewCosts,
  canUpdateCosts,
  identityReadOnly,
}) => {
  const { t } = useTranslation(['hr', 'common']);

  const setField = <K extends keyof EmployeeHrFormData>(field: K, value: EmployeeHrFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t('employeeProfile.contactSection')}
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor={`${prefix}-name`} required>
              {t(`${section}.name`)}
            </FieldLabel>
            <Input
              id={`${prefix}-name`}
              type="text"
              value={formData.name}
              onChange={(e) => setField('name', e.target.value)}
              aria-invalid={Boolean(errors.name)}
              placeholder={t(`${section}.name`)}
              disabled={identityReadOnly}
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
              disabled={identityReadOnly}
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
              disabled={identityReadOnly}
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
              disabled={identityReadOnly}
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
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${prefix}-department`}>
              {t('employeeProfile.department')}
            </FieldLabel>
            <Input
              id={`${prefix}-department`}
              value={formData.department}
              onChange={(e) => setField('department', e.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${prefix}-employee-code`}>
              {t('employeeProfile.employeeCode')}
            </FieldLabel>
            <Input
              id={`${prefix}-employee-code`}
              value={formData.employeeCode}
              onChange={(e) => setField('employeeCode', e.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${prefix}-hire-date`}>{t('employeeProfile.hireDate')}</FieldLabel>
            <DateField
              id={`${prefix}-hire-date`}
              value={formData.hireDate}
              onChange={(value) => setField('hireDate', value)}
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
          />

          <EmployeeSelectField
            id={`${prefix}-employment-status`}
            label={t('employeeProfile.employmentStatus')}
            value={formData.employmentStatus}
            options={EMPLOYMENT_STATUS_OPTIONS}
            optionPrefix="employeeProfile.employmentStatuses"
            onChange={(value) => setField('employmentStatus', value)}
          />

          <EmployeeSelectField
            id={`${prefix}-work-location`}
            label={t('employeeProfile.workLocation')}
            value={formData.workLocation}
            options={WORK_LOCATION_OPTIONS}
            optionPrefix="employeeProfile.workLocations"
            onChange={(value) => setField('workLocation', value)}
          />

          {canViewCosts && (
            <Field>
              <FieldLabel htmlFor={`${prefix}-cost`}>{t(`${section}.costPerHour`)}</FieldLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                  {currency}
                </span>
                <Input
                  id={`${prefix}-cost`}
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.costPerHour}
                  onChange={(e) => setField('costPerHour', e.target.value)}
                  className="pl-8"
                  placeholder="0.00"
                  disabled={!canUpdateCosts}
                />
              </div>
            </Field>
          )}
        </div>
      </section>

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
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor={`${prefix}-notes`}>{t('employeeProfile.notes')}</FieldLabel>
          <Textarea
            id={`${prefix}-notes`}
            value={formData.notes}
            onChange={(e) => setField('notes', e.target.value)}
            rows={3}
          />
        </Field>
      </section>
    </div>
  );
};

export default EmployeeHrFields;
