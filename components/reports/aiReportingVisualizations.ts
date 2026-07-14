export const AI_REPORTING_MAX_VISUALIZATIONS = 3;
export const AI_REPORTING_MAX_VISUALIZATION_POINTS = 50;
export const AI_REPORTING_MAX_VISUALIZATION_SERIES = 5;

const MAX_PIE_POINTS = 10;
const MAX_VISUALIZATION_BLOCK_CHARS = 20_000;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const VISUALIZATION_START_PATTERN = /^```praetor-visualization\s*$/i;
const VISUALIZATION_END_PATTERN = /^```\s*$/;
const VISUALIZATION_FENCE_PREFIX = '```praetor-visualization';
const VISUALIZATION_KEYS = new Set([
  'version',
  'type',
  'title',
  'description',
  'xKey',
  'xLabel',
  'orientation',
  'stacked',
  'series',
  'data',
]);
const SERIES_KEYS = new Set(['key', 'label', 'format', 'currency', 'decimals', 'unit']);

export type AiReportingVisualizationType = 'area' | 'bar' | 'donut' | 'line' | 'pie';
export type AiReportingVisualizationFormat = 'currency' | 'number' | 'percent';

export interface AiReportingVisualizationSeries {
  key: string;
  label: string;
  format: AiReportingVisualizationFormat;
  currency?: string;
  decimals?: number;
  unit?: string;
}

export type AiReportingVisualizationDatum = Record<string, number | string>;

export interface AiReportingVisualization {
  version: 1;
  type: AiReportingVisualizationType;
  title: string;
  description?: string;
  xKey: string;
  xLabel?: string;
  orientation?: 'horizontal' | 'vertical';
  stacked?: boolean;
  series: AiReportingVisualizationSeries[];
  data: AiReportingVisualizationDatum[];
}

export interface AiReportingVisualizationParseResult {
  markdown: string;
  visualizations: AiReportingVisualization[];
  invalidVisualizationCount: number;
  hasPendingVisualization: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowedKeys: Set<string>) =>
  Object.keys(value).every((key) => allowedKeys.has(key));

const boundedString = (value: unknown, maxLength: number, required = false) => {
  if (typeof value !== 'string') return required ? null : undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return required ? null : undefined;
  return normalized;
};

const optionalBoundedString = (value: unknown, maxLength: number) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length <= maxLength ? normalized : null;
};

const parseSeries = (value: unknown): AiReportingVisualizationSeries[] | null => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > AI_REPORTING_MAX_VISUALIZATION_SERIES
  ) {
    return null;
  }

  const series: AiReportingVisualizationSeries[] = [];
  const keys = new Set<string>();
  for (const rawSeries of value) {
    if (!isRecord(rawSeries) || !hasOnlyKeys(rawSeries, SERIES_KEYS)) return null;
    const key = boundedString(rawSeries.key, 32, true);
    const label = boundedString(rawSeries.label, 60, true);
    if (!key || !KEY_PATTERN.test(key) || !label || keys.has(key)) return null;

    const format = rawSeries.format;
    if (format !== 'number' && format !== 'currency' && format !== 'percent') return null;

    const currency = optionalBoundedString(rawSeries.currency, 3);
    if (currency === null) return null;
    if (format === 'currency' && (!currency || !CURRENCY_PATTERN.test(currency))) return null;
    if (format !== 'currency' && rawSeries.currency !== undefined) return null;

    const decimals = rawSeries.decimals;
    if (
      decimals !== undefined &&
      (!Number.isInteger(decimals) || Number(decimals) < 0 || Number(decimals) > 4)
    ) {
      return null;
    }

    const unit = optionalBoundedString(rawSeries.unit, 20);
    if (unit === null) return null;
    keys.add(key);
    series.push({
      key,
      label,
      format,
      ...(currency ? { currency } : {}),
      ...(decimals !== undefined ? { decimals: Number(decimals) } : {}),
      ...(unit ? { unit } : {}),
    });
  }

  return series;
};

export const validateAiReportingVisualization = (
  value: unknown,
): AiReportingVisualization | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, VISUALIZATION_KEYS) || value.version !== 1) {
    return null;
  }
  if (!['area', 'bar', 'donut', 'line', 'pie'].includes(String(value.type))) return null;

  const type = value.type as AiReportingVisualizationType;
  const title = boundedString(value.title, 120, true);
  const description = optionalBoundedString(value.description, 300);
  const xKey = boundedString(value.xKey, 32, true);
  const xLabel = optionalBoundedString(value.xLabel, 60);
  const series = parseSeries(value.series);
  if (
    !title ||
    description === null ||
    !xKey ||
    xLabel === null ||
    !KEY_PATTERN.test(xKey) ||
    !series ||
    series.some((item) => item.key === xKey)
  ) {
    return null;
  }

  const isCircular = type === 'pie' || type === 'donut';
  if (isCircular && series.length !== 1) return null;

  const pointLimit = isCircular ? MAX_PIE_POINTS : AI_REPORTING_MAX_VISUALIZATION_POINTS;
  if (!Array.isArray(value.data) || value.data.length === 0 || value.data.length > pointLimit) {
    return null;
  }

  const data: AiReportingVisualizationDatum[] = [];
  const datumKeys = new Set([xKey, ...series.map((item) => item.key)]);
  let circularTotal = 0;
  for (const rawDatum of value.data) {
    if (!isRecord(rawDatum) || !hasOnlyKeys(rawDatum, datumKeys)) return null;
    const rawCategory = rawDatum[xKey];
    const category =
      typeof rawCategory === 'string'
        ? (boundedString(rawCategory, 80, true) ?? null)
        : typeof rawCategory === 'number' && Number.isFinite(rawCategory)
          ? rawCategory
          : null;
    if (category === null) return null;

    const datum: AiReportingVisualizationDatum = { [xKey]: category };
    for (const item of series) {
      const numericValue = rawDatum[item.key];
      if (typeof numericValue !== 'number' || !Number.isFinite(numericValue)) return null;
      if (item.format === 'percent' && (numericValue < 0 || numericValue > 100)) return null;
      if (isCircular) {
        if (numericValue < 0) return null;
        circularTotal += numericValue;
      }
      datum[item.key] = numericValue;
    }
    data.push(datum);
  }

  const orientation = value.orientation;
  if (orientation !== undefined && orientation !== 'horizontal' && orientation !== 'vertical') {
    return null;
  }
  if (orientation !== undefined && type !== 'bar') return null;
  const stacked = value.stacked;
  if (stacked !== undefined && typeof stacked !== 'boolean') return null;
  if (stacked !== undefined && type !== 'bar' && type !== 'area') return null;

  if (isCircular && circularTotal <= 0) return null;

  return {
    version: 1,
    type,
    title,
    ...(description ? { description } : {}),
    xKey,
    ...(xLabel ? { xLabel } : {}),
    ...(type === 'bar' && orientation ? { orientation } : {}),
    ...((type === 'bar' || type === 'area') && stacked !== undefined ? { stacked } : {}),
    series,
    data,
  };
};

export const parseAiReportingVisualizations = (
  content: string,
): AiReportingVisualizationParseResult => {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const markdownLines: string[] = [];
  const visualizations: AiReportingVisualization[] = [];
  let invalidVisualizationCount = 0;
  let hasPendingVisualization = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!VISUALIZATION_START_PATTERN.test(line.trim())) {
      const possibleFence = line.trim().toLowerCase();
      if (
        index === lines.length - 1 &&
        possibleFence.startsWith('```p') &&
        VISUALIZATION_FENCE_PREFIX.startsWith(possibleFence)
      ) {
        hasPendingVisualization = true;
        break;
      }
      markdownLines.push(line);
      continue;
    }

    const jsonLines: string[] = [];
    let closingIndex = index + 1;
    while (
      closingIndex < lines.length &&
      !VISUALIZATION_END_PATTERN.test(lines[closingIndex].trim())
    ) {
      jsonLines.push(lines[closingIndex]);
      closingIndex += 1;
    }

    if (closingIndex >= lines.length) {
      hasPendingVisualization = true;
      break;
    }

    index = closingIndex;
    if (markdownLines[markdownLines.length - 1]?.trim() === '' && lines[index + 1]?.trim() === '') {
      index += 1;
    }
    const rawJson = jsonLines.join('\n').trim();
    if (!rawJson || rawJson.length > MAX_VISUALIZATION_BLOCK_CHARS) {
      invalidVisualizationCount += 1;
      continue;
    }

    try {
      const visualization = validateAiReportingVisualization(JSON.parse(rawJson));
      if (visualization && visualizations.length < AI_REPORTING_MAX_VISUALIZATIONS) {
        visualizations.push(visualization);
      } else {
        invalidVisualizationCount += 1;
      }
    } catch {
      invalidVisualizationCount += 1;
    }
  }

  return {
    markdown: markdownLines.join('\n').trim(),
    visualizations,
    invalidVisualizationCount,
    hasPendingVisualization,
  };
};

const escapeMarkdownCell = (value: number | string) =>
  String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export const aiReportingVisualizationToMarkdown = (visualization: AiReportingVisualization) => {
  const headers = [
    visualization.xLabel || visualization.xKey,
    ...visualization.series.map((item) => item.label),
  ];
  const separator = headers.map(() => '---');
  const rows = visualization.data.map((datum) => [
    datum[visualization.xKey],
    ...visualization.series.map((item) => datum[item.key]),
  ]);
  const toRow = (values: Array<number | string>) =>
    `| ${values.map(escapeMarkdownCell).join(' | ')} |`;

  return [
    `### ${visualization.title}`,
    ...(visualization.description ? [visualization.description] : []),
    toRow(headers),
    toRow(separator),
    ...rows.map(toRow),
  ].join('\n');
};

export const getAiReportingAssistantCopyText = (parsed: AiReportingVisualizationParseResult) => {
  return [parsed.markdown, ...parsed.visualizations.map(aiReportingVisualizationToMarkdown)]
    .filter(Boolean)
    .join('\n\n');
};
