export type UnitType = 'hours' | 'days' | 'unit';

export const normalizeUnitType = (value: unknown): UnitType => {
  if (value === 'days') return 'days';
  if (value === 'unit') return 'unit';
  return 'hours';
};
