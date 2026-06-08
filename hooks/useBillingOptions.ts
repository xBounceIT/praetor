import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BILLING_FREQUENCY_OPTIONS, BILLING_TYPE_OPTIONS } from '../utils/billing';

// Translate the shared billing option arrays once (memoized on `t`) so the t()-mapping isn't
// copy-pasted into every SelectControl consumer. utils/billing.ts stays React-free (it's
// imported by non-React code such as services/api/normalizers.ts), so the hook lives here.
export const useBillingTypeOptions = () => {
  const { t } = useTranslation(['projects']);
  return useMemo(() => BILLING_TYPE_OPTIONS.map((o) => ({ id: o.id, name: t(o.name) })), [t]);
};

export const useBillingFrequencyOptions = () => {
  const { t } = useTranslation(['projects']);
  return useMemo(() => BILLING_FREQUENCY_OPTIONS.map((o) => ({ id: o.id, name: t(o.name) })), [t]);
};
