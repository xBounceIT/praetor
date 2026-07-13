import { describe, expect, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

describe('<AiReportingView /> dark-mode error banner (issue #768 follow-up)', () => {
  test('the chat error banner avoids light-only red classes', async () => {
    const source = await readComponentSource('reports/AiReportingView.tsx');
    // The AI chat error banner uses translucent red plus an explicit dark-mode text color so it
    // reads correctly on the dark themed surface, matching the amber warning banners from #768.
    expect(source).toBeTruthy();
    expectSourceContainsAll(source, ['border-red-500/30', 'bg-red-500/10', 'dark:text-red-300']);
    // The old light-only banner border (a pale red slab in dark mode) is gone. The icon circles
    // use bg-red-100 and the hover affordances use hover:bg-red-50, so border-red-200 was unique
    // to the message banner here.
    expectSourceOmitsAll(source, ['border-red-200']);
  });
});

describe('<AiReportingView /> async cleanup', () => {
  test('aborts streaming work and invalidates pending loads on unmount', async () => {
    const source = await readComponentSource('reports/AiReportingView.tsx');

    expectSourceContainsAll(source, [
      'loadTokenRef.current += 1',
      'sendRunIdRef.current += 1',
      'abortRef.current?.abort()',
    ]);
  });
});
