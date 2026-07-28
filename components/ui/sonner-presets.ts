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

export const offerCreatedToastClassNames = {
  toast: 'rounded-lg! border-primary! bg-primary! pr-12! text-primary-foreground! shadow-lg',
  description: 'text-primary-foreground/70!',
  icon: 'text-primary-foreground!',
  actionButton:
    'rounded-md! bg-primary-foreground! text-primary! hover:bg-primary-foreground/90! focus-visible:ring-[3px] focus-visible:ring-primary-foreground/50',
  closeButton:
    'top-2! right-2! left-auto! size-6! transform-none! rounded-md! border-0! bg-transparent! text-primary-foreground! hover:bg-primary-foreground/10! focus-visible:ring-[3px] focus-visible:ring-primary-foreground/50 [&_svg]:size-4!',
} satisfies ToastClassnames;
