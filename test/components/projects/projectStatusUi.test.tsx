import { describe, expect, test } from 'bun:test';

import {
  getProjectStatusBadgeType,
  getProjectStatusIcon,
  PROJECT_STATUS_ICON_CLASS_NAME,
  translateProjectStatusOptions,
} from '../../../components/projects/projectStatusUi';
import type { ProjectStatus } from '../../../types';
import { render } from '../../helpers/render';

const STATUS_ICON_CASES = [
  ['da_fare', 'lucide-square', true],
  ['in_corso', 'lucide-play', true],
  ['in_pausa', 'lucide-pause', true],
  ['terminato', 'lucide-check', false],
  ['perpetuo', 'lucide-infinity', false],
] as const satisfies ReadonlyArray<readonly [ProjectStatus, string, boolean]>;

describe('project status media icons', () => {
  test.each(
    STATUS_ICON_CASES,
  )('%s uses %s in translated select options', (status, iconClass, filled) => {
    const options = translateProjectStatusOptions(
      (key) => `label:${key.slice(key.lastIndexOf('.') + 1)}`,
    );
    const option = options.find(({ id }) => id === status);
    const { container } = render(option?.icon);
    const svg = container.querySelector('svg');

    expect(option?.name).toBe(`label:${status}`);
    expect(svg).toHaveClass(iconClass);
    expect(svg).toHaveClass(...PROJECT_STATUS_ICON_CLASS_NAME.split(' '));
    expect(svg?.getAttribute('fill')).toBe(filled ? 'currentColor' : 'none');
  });

  test('tooltip icons use the same glyph, size, and fill as select options', () => {
    const options = translateProjectStatusOptions((key) => key);
    for (const status of ['da_fare', 'in_corso', 'in_pausa', 'terminato', 'perpetuo'] as const) {
      const optionIcon = options.find(({ id }) => id === status)?.icon;
      const { container: selectContainer } = render(optionIcon);
      const { container: tooltipContainer } = render(
        getProjectStatusIcon(status, `mt-0.5 ${PROJECT_STATUS_ICON_CLASS_NAME}`),
      );
      const selectSvg = selectContainer.querySelector('svg');
      const tooltipSvg = tooltipContainer.querySelector('svg');
      const lucideClass = (className: string | null | undefined) =>
        className?.split(/\s+/).find((c) => c.startsWith('lucide-'));

      expect(selectSvg).toHaveClass(...PROJECT_STATUS_ICON_CLASS_NAME.split(' '));
      expect(tooltipSvg).toHaveClass(...PROJECT_STATUS_ICON_CLASS_NAME.split(' '));
      expect(tooltipSvg?.getAttribute('fill')).toBe(selectSvg?.getAttribute('fill'));
      expect(lucideClass(tooltipSvg?.getAttribute('class'))).toBe(
        lucideClass(selectSvg?.getAttribute('class')),
      );
    }
  });

  test('legacy projects without a status use the in-progress play icon', () => {
    const { container } = render(getProjectStatusIcon(undefined));

    expect(container.querySelector('svg')).toHaveClass('lucide-play');
  });

  test('perpetuo uses the active badge type', () => {
    expect(getProjectStatusBadgeType('perpetuo')).toBe('active');
  });
});
