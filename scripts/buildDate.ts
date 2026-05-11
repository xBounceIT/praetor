// Format a date as YYYYMMDD. Used by Vite to stamp builds with the wall-clock
// date at config-evaluation time. Exposed as a module so it can be unit-tested.
export const formatBuildDate = (date: Date): string => {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

export const getBuildDate = (): string => formatBuildDate(new Date());
