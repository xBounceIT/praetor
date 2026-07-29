import { type ExternalToast, type ToastClassnames, toast } from 'sonner';
import {
  appErrorToastClassNames,
  appSuccessToastClassNames,
  appWarningToastClassNames,
  mergeToastClassNames,
} from '@/components/ui/sonner-presets';

const withClassNames = (base: ToastClassnames, options?: ExternalToast): ExternalToast => ({
  ...options,
  classNames: mergeToastClassNames(base, options?.classNames),
});

export const toastError = (message: string, options?: ExternalToast) =>
  toast.error(message, withClassNames(appErrorToastClassNames, options));

export const toastSuccess = (message: string, options?: ExternalToast) =>
  toast.success(message, withClassNames(appSuccessToastClassNames, options));

export const toastWarning = (message: string, options?: ExternalToast) =>
  toast.warning(message, withClassNames(appWarningToastClassNames, options));
