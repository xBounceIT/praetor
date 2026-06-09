import type React from 'react';
import { Avatar, AvatarFallback, AvatarGroup } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getInitials } from '@/utils/initials';

export interface MemberAvatarGroupMember {
  id: string;
  name: string;
}

export interface MemberAvatarGroupProps {
  members: MemberAvatarGroupMember[];
  /** How many initials to show inline before collapsing the rest into a `+N` badge. */
  max?: number;
  className?: string;
}

// `border-2 border-card` matches the card surface, so the overlapping avatars read as clean
// cut-outs (same treatment as the project dashboard team avatars). `ring-background` paints
// the page background instead, which is darker than the card in dark mode and shows up as a
// black ring. The separator is applied directly on each avatar rather than via AvatarGroup's
// `*:data-[slot=avatar]` selector, which the `TooltipTrigger asChild` data-slot merge defeats.
const avatarClassName = 'size-7 border-2 border-card';
// AvatarFallback already provides `bg-muted text-muted-foreground`; only the smaller
// initials size and weight are additive here.
const fallbackClassName = 'text-[10px] font-medium';
const overflowBadgeClassName =
  'relative flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-medium text-muted-foreground';

/**
 * Overlapping row of member initials with the full name on hover (per-badge tooltip).
 * When there are more members than `max`, the remainder collapses into a `+N` badge that
 * is keyboard-focusable and whose tooltip lists the whole membership, so the complete set
 * is reachable without opening the card. Renders nothing for an empty member list. Issue #761.
 */
const MemberAvatarGroup: React.FC<MemberAvatarGroupProps> = ({ members, max = 5, className }) => {
  if (members.length === 0) return null;

  const visible = members.slice(0, max);
  const overflow = members.slice(max);

  return (
    <AvatarGroup className={className}>
      {visible.map((member) => (
        <Tooltip key={member.id}>
          <TooltipTrigger asChild>
            <Avatar role="img" aria-label={member.name} className={avatarClassName}>
              <AvatarFallback className={fallbackClassName}>
                {getInitials(member.name)}
              </AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent>{member.name}</TooltipContent>
        </Tooltip>
      ))}
      {overflow.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A real button so the full-roster tooltip is reachable by keyboard focus;
                labelled with only the hidden members so screen readers don't re-announce
                the visible ones. */}
            <button
              type="button"
              aria-label={overflow.map((member) => member.name).join(', ')}
              className={overflowBadgeClassName}
            >
              +{overflow.length}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <ul className="space-y-0.5 text-left">
              {members.map((member) => (
                <li key={member.id}>{member.name}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      )}
    </AvatarGroup>
  );
};

export default MemberAvatarGroup;
