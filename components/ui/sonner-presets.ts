import type { ToastClassnames } from 'sonner';

export const offerCreatedToastClassNames = {
  toast: 'rounded-lg! border-primary! bg-primary! pr-12! text-primary-foreground! shadow-lg',
  description: 'text-primary-foreground/70!',
  icon: 'text-primary-foreground!',
  actionButton:
    'rounded-md! bg-primary-foreground! text-primary! hover:bg-primary-foreground/90! focus-visible:ring-[3px] focus-visible:ring-primary-foreground/50',
  closeButton:
    'top-2! right-2! left-auto! size-6! transform-none! rounded-md! border-0! bg-transparent! text-primary-foreground! hover:bg-primary-foreground/10! focus-visible:ring-[3px] focus-visible:ring-primary-foreground/50 [&_svg]:size-4!',
} satisfies ToastClassnames;
