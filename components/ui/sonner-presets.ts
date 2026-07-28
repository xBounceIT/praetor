import type { ToastClassnames } from 'sonner';

export const neutralSuccessToastClassNames = {
  toast: 'rounded-md! border-border! bg-popover! text-popover-foreground! shadow-lg',
  description: 'text-muted-foreground!',
  icon: 'text-primary!',
  actionButton:
    'rounded-md! bg-primary! text-primary-foreground! hover:bg-primary/90! focus-visible:ring-[3px] focus-visible:ring-ring/50',
  closeButton:
    'top-0.5! right-1! left-auto! size-5! transform-none! rounded-md! border-0! bg-transparent! text-muted-foreground! hover:bg-accent! hover:text-accent-foreground! focus-visible:ring-[3px] focus-visible:ring-ring/50',
} satisfies ToastClassnames;
