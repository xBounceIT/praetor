export const TABLE_CONTROL_BUTTON_CLASSNAME =
  '!h-7 !gap-1.5 !rounded-lg !px-2 !text-sm !leading-[var(--text-sm--line-height)] !font-medium';

// Neutral row-action icon button (view / edit / open-link) used in list-view table rows.
// Semantic actions (delete = destructive red, mark-as-sent = blue) keep their own colors.
export const TABLE_ROW_ACTION_BUTTON_CLASSNAME =
  'rounded-lg p-2 text-muted-foreground transition-all hover:bg-muted hover:text-praetor';

/** Initials avatar in StandardTable name cells. Keep size-6 so row height matches HR employees. */
export const TABLE_ROW_AVATAR_CLASSNAME =
  'size-6 shrink-0 rounded-full flex items-center justify-center font-bold text-xs';
