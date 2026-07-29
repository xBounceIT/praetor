import type { ToastClassnames, ToasterProps } from 'sonner';
import type { ResolvedTheme } from '@/utils/theme';

export const resolveSonnerTheme = (
  resolvedTheme: ResolvedTheme,
  theme?: ToasterProps['theme'],
): ToasterProps['theme'] => theme ?? (resolvedTheme === 'dark' ? 'dark' : 'light');

export const appToasterProps = {
  richColors: true,
  closeButton: true,
  position: 'top-center',
} satisfies Pick<ToasterProps, 'richColors' | 'closeButton' | 'position'>;

export const resolveOfferCreatedToastAction = <T>(
  canViewClientOffers: boolean,
  action: T,
): T | undefined => (canViewClientOffers ? action : undefined);

const toastLayout = 'rounded-lg! pr-12! shadow-lg';
const closeButtonLayout =
  'top-2! right-2! left-auto! size-6! transform-none! rounded-md! border-0! bg-transparent! focus-visible:ring-[3px] [&_svg]:size-4!';

const buildVariantClassNames = ({
  surface,
  description,
  icon,
  actionButton,
  closeTone,
}: {
  surface: string;
  description: string;
  icon: string;
  actionButton: string;
  closeTone: string;
}): ToastClassnames => ({
  toast: `${toastLayout} ${surface}`,
  description,
  icon,
  actionButton,
  closeButton: `${closeButtonLayout} ${closeTone}`,
});

/** Primary-themed success toast — same look as quote→offer conversion. */
export const appSuccessToastClassNames = buildVariantClassNames({
  surface: 'border-primary! bg-primary! text-primary-foreground!',
  description: 'text-primary-foreground/70!',
  icon: 'text-primary-foreground!',
  actionButton:
    'rounded-md! bg-primary-foreground! text-primary! hover:bg-primary-foreground/90! focus-visible:ring-[3px] focus-visible:ring-primary-foreground/50',
  closeTone:
    'text-primary-foreground! hover:bg-primary-foreground/10! focus-visible:ring-primary-foreground/50',
});

export const appErrorToastClassNames = buildVariantClassNames({
  surface: 'border-destructive! bg-destructive! text-destructive-foreground!',
  description: 'text-destructive-foreground/70!',
  icon: 'text-destructive-foreground!',
  actionButton:
    'rounded-md! bg-destructive-foreground! text-destructive! hover:bg-destructive-foreground/90! focus-visible:ring-[3px] focus-visible:ring-destructive-foreground/50',
  closeTone:
    'text-destructive-foreground! hover:bg-destructive-foreground/10! focus-visible:ring-destructive-foreground/50',
});

export const appWarningToastClassNames = buildVariantClassNames({
  surface: 'border-amber-600! bg-amber-600! text-white! dark:border-amber-500! dark:bg-amber-500!',
  description: 'text-white/70!',
  icon: 'text-white!',
  actionButton:
    'rounded-md! bg-white! text-amber-700! hover:bg-white/90! focus-visible:ring-[3px] focus-visible:ring-white/50',
  closeTone: 'text-white! hover:bg-white/10! focus-visible:ring-white/50',
});

/** Alias kept for offer-created call sites; identical to `appSuccessToastClassNames`. */
export const offerCreatedToastClassNames = appSuccessToastClassNames;

const TOAST_CLASSNAME_KEYS = [
  'toast',
  'title',
  'description',
  'actionButton',
  'cancelButton',
  'closeButton',
  'error',
  'success',
  'warning',
  'info',
  'loading',
  'content',
  'icon',
] as const satisfies ReadonlyArray<keyof ToastClassnames>;

export const mergeToastClassNames = (
  base: ToastClassnames,
  override?: ToastClassnames,
): ToastClassnames => {
  if (!override) return base;
  const merged: ToastClassnames = { ...base };
  for (const key of TOAST_CLASSNAME_KEYS) {
    if (!override[key]) continue;
    merged[key] = [base[key], override[key]].filter(Boolean).join(' ');
  }
  return merged;
};
