import type { ToastClassnames } from 'sonner';

export const neutralSuccessToastClassNames = {
  toast: 'border-border! bg-popover! text-popover-foreground! shadow-lg',
  description: 'text-muted-foreground!',
  icon: 'text-emerald-600! dark:text-emerald-400!',
  actionButton:
    'bg-primary! text-primary-foreground! hover:bg-primary/90! focus-visible:ring-[3px] focus-visible:ring-ring/50',
  closeButton:
    'border-border! bg-background! text-muted-foreground! hover:bg-accent! hover:text-accent-foreground! focus-visible:ring-[3px] focus-visible:ring-ring/50',
} satisfies ToastClassnames;
