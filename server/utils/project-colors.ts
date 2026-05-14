export const PROJECT_COLOR_PALETTE = [
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#d946ef',
  '#64748b',
] as const;

export const normalizeProjectColor = (color: string): string => {
  const normalized = color.trim().toLowerCase();
  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(normalized);
  if (!shortHex) return normalized;
  return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`;
};

const hueToRgb = (p: number, q: number, t: number): number => {
  let nextT = t;
  if (nextT < 0) nextT += 1;
  if (nextT > 1) nextT -= 1;
  if (nextT < 1 / 6) return p + (q - p) * 6 * nextT;
  if (nextT < 1 / 2) return q;
  if (nextT < 2 / 3) return p + (q - p) * (2 / 3 - nextT) * 6;
  return p;
};

const hslToHex = (hue: number, saturation: number, lightness: number): string => {
  const h = hue / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const rgb = [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
  return `#${rgb
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

const generatedProjectColor = (index: number): string => {
  const hue = (index * 137.508) % 360;
  return hslToHex(hue, 64, 48);
};

export const pickAvailableProjectColor = (usedColors: readonly string[]): string => {
  const used = new Set(usedColors.map(normalizeProjectColor));
  for (const color of PROJECT_COLOR_PALETTE) {
    if (!used.has(color)) return color;
  }

  for (let index = 0; index < 4096; index++) {
    const color = generatedProjectColor(index);
    if (!used.has(color)) return color;
  }

  throw new Error('Unable to allocate a unique project color');
};
