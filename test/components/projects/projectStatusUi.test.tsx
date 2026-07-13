import { describe, expect, test } from 'bun:test';

import {
  getProjectStatusIcon,
  translateProjectStatusOptions,
} from '../../../components/projects/projectStatusUi';
import type { ProjectStatus } from '../../../types';
import { render } from '../../helpers/render';

const STATUS_ICON_CASES = [
  ['da_fare', 'lucide-square'],
  ['in_corso', 'lucide-play'],
  ['in_pausa', 'lucide-pause'],
  ['terminato', 'lucide-check'],
] as const satisfies ReadonlyArray<readonly [ProjectStatus, string]>;

describe('project status media icons', () => {
  test.each(STATUS_ICON_CASES)('%s uses %s in translated select options', (status, iconClass) => {
    const options = translateProjectStatusOptions(
      (key) => `label:${key.slice(key.lastIndexOf('.') + 1)}`,
    );
    const option = options.find(({ id }) => id === status);
    const { container } = render(option?.icon);

    expect(option?.name).toBe(`label:${status}`);
    expect(container.querySelector('svg')).toHaveClass(iconClass);
  });

  test('legacy projects without a status use the in-progress play icon', () => {
    const { container } = render(getProjectStatusIcon(undefined));

    expect(container.querySelector('svg')).toHaveClass('lucide-play');
  });
});
