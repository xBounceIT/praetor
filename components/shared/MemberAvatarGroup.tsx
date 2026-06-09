import type React from 'react';
import { Avatar, AvatarFallback, AvatarGroup } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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

// Initials from a display name: first letter of the first and last word, or the first
// two letters of a single-word name. Mirrors the avatar abbreviations used elsewhere in
// the app (ViewOwnerAvatar, the project dashboard team-size avatars).
const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const initials =
    parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return initials.toUpperCase();
};

const avatarClassName = 'size-7';
const fallbackClassName = 'bg-muted text-[10px] font-medium text-muted-foreground';

/**
 * Overlapping row of member initials with the full name on hover (per-badge tooltip).
 * When there are more members than `max`, the remainder collapses into a `+N` badge whose
 * tooltip lists every member, so the complete membership is visible without opening the
 * card. Renders nothing for an empty member list. Issue #761.
 */
const MemberAvatarGroup: React.FC<MemberAvatarGroupProps> = ({ members, max = 5, className }) => {
  if (members.length === 0) return null;

  const visible = members.slice(0, max);
  const overflowCount = members.length - visible.length;

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
      {overflowCount > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              aria-label={members.map((member) => member.name).join(', ')}
              className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background"
            >
              +{overflowCount}
            </span>
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
