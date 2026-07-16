const BASE_CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

export const CHART_COLORS = [
  ...BASE_CHART_COLORS,
  ...BASE_CHART_COLORS.map((color) => `color-mix(in oklch, ${color} 65%, var(--background))`),
] as const;

// Distribute later points between adjacent theme colors. The generated strings stay
// unique for all 50 points accepted by an AI-reporting Cartesian visualization.
const BAR_COLOR_MIX_PERCENTAGES = [50, 75, 25, 88, 63, 38, 13, 94, 6] as const;

export const getBarPointColor = (index: number) => {
  const normalizedIndex = Math.max(0, Math.floor(index));
  const baseIndex = normalizedIndex % BASE_CHART_COLORS.length;
  const variant = Math.floor(normalizedIndex / BASE_CHART_COLORS.length);
  if (variant === 0) return BASE_CHART_COLORS[baseIndex];

  const mixPercentage = BAR_COLOR_MIX_PERCENTAGES[(variant - 1) % BAR_COLOR_MIX_PERCENTAGES.length];
  const nextColor = BASE_CHART_COLORS[(baseIndex + 1) % BASE_CHART_COLORS.length];
  return `color-mix(in oklch, ${BASE_CHART_COLORS[baseIndex]} ${mixPercentage}%, ${nextColor})`;
};

export const getCircularTooltipLabel = (payload: unknown, categoryKey: string) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[categoryKey];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
};
