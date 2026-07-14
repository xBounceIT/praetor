import { describe, expect, test } from 'bun:test';
import {
  AI_REPORTING_MAX_VISUALIZATION_POINTS,
  getAiReportingAssistantCopyText,
  parseAiReportingVisualizations,
  validateAiReportingVisualization,
} from '@/components/reports/aiReportingVisualizations';

const FENCE = String.fromCharCode(96).repeat(3);

const visualization = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  type: 'bar',
  title: 'Monthly revenue',
  description: 'Revenue compared with the previous year.',
  xKey: 'month',
  xLabel: 'Month',
  series: [
    { key: 'current', label: 'Current year', format: 'currency', currency: 'EUR' },
    { key: 'previous', label: 'Previous year', format: 'currency', currency: 'EUR' },
  ],
  data: [
    { month: 'Jan', current: 1200, previous: 900 },
    { month: 'Feb', current: 1500, previous: 1100 },
  ],
  ...overrides,
});

const fenced = (value: unknown) =>
  [FENCE + 'praetor-visualization', JSON.stringify(value), FENCE].join('\n');

describe('AI Reporting visualization protocol', () => {
  test('extracts a validated visualization while preserving surrounding Markdown', () => {
    const parsed = parseAiReportingVisualizations(
      ['Revenue increased.', fenced(visualization()), 'The strongest month was February.'].join(
        '\n\n',
      ),
    );

    expect(parsed.markdown).toBe(
      ['Revenue increased.', 'The strongest month was February.'].join('\n\n'),
    );
    expect(parsed.visualizations).toHaveLength(1);
    expect(parsed.visualizations[0]).toMatchObject({
      type: 'bar',
      title: 'Monthly revenue',
      xKey: 'month',
    });
    expect(parsed.invalidVisualizationCount).toBe(0);
    expect(parsed.hasPendingVisualization).toBe(false);
  });

  test('rejects unsupported fields, invalid numeric values, and oversized datasets', () => {
    expect(validateAiReportingVisualization(visualization({ color: '#fff' }))).toBeNull();
    expect(validateAiReportingVisualization(visualization({ description: 123 }))).toBeNull();
    expect(
      validateAiReportingVisualization(
        visualization({ series: [{ key: 'current', label: 'Current year' }] }),
      ),
    ).toBeNull();
    expect(
      validateAiReportingVisualization(
        visualization({
          series: [{ key: 'current', label: 'Current year', format: 'number', unit: 12 }],
        }),
      ),
    ).toBeNull();
    expect(
      validateAiReportingVisualization(
        visualization({ data: [{ month: 'Jan', current: '<script>', previous: 900 }] }),
      ),
    ).toBeNull();
    expect(
      validateAiReportingVisualization(
        visualization({
          data: Array.from({ length: AI_REPORTING_MAX_VISUALIZATION_POINTS + 1 }, (_, index) => ({
            month: String(index),
            current: index,
            previous: index,
          })),
        }),
      ),
    ).toBeNull();
  });

  test('enforces chart-specific fields and bounded composition values', () => {
    const percentSeries = [{ key: 'share', label: 'Share', format: 'percent' }];
    expect(
      validateAiReportingVisualization(visualization({ type: 'line', orientation: 'horizontal' })),
    ).toBeNull();
    expect(
      validateAiReportingVisualization(
        visualization({ type: 'pie', stacked: false, series: percentSeries }),
      ),
    ).toBeNull();
    expect(
      validateAiReportingVisualization(
        visualization({
          type: 'donut',
          series: percentSeries,
          data: [{ month: 'Direct', share: 101 }],
        }),
      ),
    ).toBeNull();
    expect(
      validateAiReportingVisualization(
        visualization({
          type: 'pie',
          series: [{ key: 'value', label: 'Value', format: 'number' }],
          data: [{ month: 'Direct', value: -1 }],
        }),
      ),
    ).toBeNull();
  });

  test('hides complete and partial visualization fences until streaming finishes', () => {
    const pendingBlock = parseAiReportingVisualizations(
      ['Intro', FENCE + 'praetor-visualization', '{"version":1'].join('\n'),
    );
    const pendingFence = parseAiReportingVisualizations(
      ['Intro', FENCE + 'praetor-vis'].join('\n'),
    );

    expect(pendingBlock.markdown).toBe('Intro');
    expect(pendingBlock.hasPendingVisualization).toBe(true);
    expect(pendingFence.markdown).toBe('Intro');
    expect(pendingFence.hasPendingVisualization).toBe(true);
  });

  test('limits one response to three visualizations and reports the remainder', () => {
    const parsed = parseAiReportingVisualizations(
      Array.from({ length: 4 }, (_, index) =>
        fenced(visualization({ title: 'Chart ' + String(index + 1) })),
      ).join('\n'),
    );

    expect(parsed.visualizations).toHaveLength(3);
    expect(parsed.invalidVisualizationCount).toBe(1);
  });

  test('copies visualizations as readable Markdown tables instead of raw tool JSON', () => {
    const parsed = parseAiReportingVisualizations(
      ['Summary', fenced(visualization())].join('\n\n'),
    );
    const copyText = getAiReportingAssistantCopyText(parsed);

    expect(copyText).toContain('### Monthly revenue');
    expect(copyText).toContain('Revenue compared with the previous year.');
    expect(copyText).toContain('| Month | Current year | Previous year |');
    expect(copyText).toContain('| Jan | 1200 | 900 |');
    expect(copyText).not.toContain('praetor-visualization');
    expect(copyText).not.toContain('"series"');
  });
});
