import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Initials for a shared view's owner, derived from the display name (the view
// DTOs only carry `ownerName`, not avatar initials). First letter of the first
// and last word, or the first two letters of a single word.
const initialsFromName = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

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
          {initialsFromName(ownerName)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
};

export default ViewOwnerAvatar;
