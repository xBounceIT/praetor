/**
 * z-index for a modal that opens on top of another modal (e.g. a "manage
 * options" dialog launched from inside a form dialog).
 *
 * `Modal` renders its content at `zIndex + 1`. A nested modal must sit above its
 * parent — a default modal's content is at `60 + 1 = 61` — yet stay below the
 * floating overlay tier (`z-[70]`, shared by select/popover/tooltip/
 * dropdown-menu/context-menu in `components/ui/*`). A value of 65 puts content
 * at 66: above the parent (61), below the dropdown tier (70). Going to or above
 * 69 (content >= 70) makes dropdowns opened inside the modal render behind it,
 * so they appear to do nothing.
 */
export const NESTED_MODAL_Z_INDEX = 65;
