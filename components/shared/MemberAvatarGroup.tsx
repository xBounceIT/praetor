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

// `ring-2 ring-background` is applied directly on each avatar rather than relying on
// AvatarGroup's `*:data-[slot=avatar]` ring selector: wrapping the Avatar in a Radix
// `TooltipTrigger asChild` merges the trigger's `data-slot="tooltip-trigger"` onto the
// avatar element, so the group's avatar-scoped selector would no longer match it.
const avatarClassName = 'size-7 ring-2 ring-background';
// AvatarFallback already provides `bg-muted text-muted-foreground`; only the smaller
// initials size and weight are additive here.
const fallbackClassName = 'text-[10px] font-medium';
const overflowBadgeClassName =
  'relative flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background';

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
