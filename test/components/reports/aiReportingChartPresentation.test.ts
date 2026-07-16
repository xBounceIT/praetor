import { describe, expect, test } from 'bun:test';
import {
  getBarPointColor,
  getCircularTooltipLabel,
} from '@/components/reports/aiReportingChartPresentation';

describe('AI reporting chart presentation', () => {
  test('assigns a unique theme-derived color to every supported single-series bar point', () => {
    const colors = Array.from({ length: 50 }, (_, index) => getBarPointColor(index));

    expect(new Set(colors).size).toBe(50);
    expect(colors.every((color) => color.includes('var(--chart-'))).toBe(true);
  });

  test('takes a circular tooltip label from the hovered datum payload', () => {
    expect(getCircularTooltipLabel({ status: 'paid', amount: 6303 }, 'status')).toBe('paid');
    expect(getCircularTooltipLabel({ status: 'overdue', amount: 10_020 }, 'status')).toBe(
      'overdue',
    );
    expect(getCircularTooltipLabel({ quarter: 3, amount: 4200 }, 'quarter')).toBe('3');
  });

  test('rejects missing or non-scalar circular tooltip labels', () => {
    expect(getCircularTooltipLabel({ amount: 6303 }, 'status')).toBeNull();
    expect(getCircularTooltipLabel({ status: { label: 'paid' } }, 'status')).toBeNull();
  });
});
