import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getInitials } from '@/utils/initials';

export interface ViewOwnerAvatarProps {
  ownerName: string;
  className?: string;
}

/**
 * Compact circular avatar (owner initials) shown on shared view rows in place of a
 * "Shared by {owner}" text label. The full owner name surfaces on hover via tooltip,
 * mirroring how user avatars are shown elsewhere in the app. The accessible name is
 * kept as "Shared by {owner}" so screen readers retain the sharing context.
 */
const ViewOwnerAvatar: React.FC<ViewOwnerAvatarProps> = ({ ownerName, className }) => {
  const { t } = useTranslation('common');
  const label = t('views.sharedBy', { owner: ownerName });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold uppercase leading-none text-muted-foreground',
            className,
          )}
        >
          <span aria-hidden="true">{getInitials(ownerName)}</span>
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
};

export default ViewOwnerAvatar;
