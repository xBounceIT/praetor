/**
 * Shared appearance + interaction-state classes for input-shaped controls: base sizing,
 * border, background, focus ring, and the disabled / aria-invalid treatments. Reused by
 * the `Input` component and by input-like Popover triggers (e.g. the date picker) so they
 * can't drift apart. Excludes `<input>`-only utilities (selection / file / placeholder)
 * that non-input triggers don't need.
 */
export const inputBaseClassName =
  'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40';
