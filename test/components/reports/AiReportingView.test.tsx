import { describe, expect, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

describe('<AiReportingView /> shadcn workspace', () => {
  test('uses the responsive two-panel layout and semantic theme tokens', async () => {
    const source = await readComponentSource('reports/AiReportingView.tsx');

    expect(source).toBeTruthy();
    expectSourceContainsAll(source, [
      'md:grid-cols-[17rem_minmax(0,1fr)]',
      '<ScrollArea',
      '<Sheet',
      '<Textarea',
      '<Dialog',
      'bg-background',
      'border-border',
    ]);
    expectSourceOmitsAll(source, [
      '<button',
      '<textarea',
      'linear-gradient',
      'rgb(249 250 251)',
      'bg-white',
      'text-zinc',
      'bg-zinc',
      'border-zinc',
      'SelectControl',
      'StatusBadge',
    ]);
  });

  test('keeps the mobile history drawer and destructive confirmation wired', async () => {
    const source = await readComponentSource('reports/AiReportingView.tsx');

    expectSourceContainsAll(source, [
      'open={isHistoryOpen}',
      'onOpenHistory={() => setIsHistoryOpen(true)}',
      'onSelectSession={handleSelectSession}',
      'variant="destructive"',
      'onArchive={() => void handleArchiveSession()}',
    ]);
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
