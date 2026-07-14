import { describe, expect, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

describe('<AiReportingView /> shadcn workspace', () => {
  test('uses the native shadcn input-group container without fieldset layout offsets', async () => {
    const source = await readComponentSource('ui/input-group.tsx');

    expectSourceContainsAll(source, ["React.ComponentProps<'div'>", '<div', 'role="group"']);
    expectSourceOmitsAll(source, ["React.ComponentProps<'fieldset'>", '<fieldset']);
  });

  test('uses the responsive two-panel layout and semantic theme tokens', async () => {
    const source = await readComponentSource('reports/AiReportingView.tsx');

    expect(source).toBeTruthy();
    expectSourceContainsAll(source, [
      'md:grid-cols-[17rem_minmax(0,1fr)]',
      'h-[calc(100dvh-140px)]',
      '<ScrollArea',
      '<Sheet',
      '<InputGroup',
      '<InputGroupTextarea',
      '<Textarea',
      '<DeleteConfirmModal',
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
      'onConfirmDeleteSession={confirmDeleteSession}',
      'onRenameSession={handleRenameSession}',
      'absolute inset-y-1 right-1',
      'pr-20',
      '<Pencil',
      '<Paperclip',
      '<Mic',
      'variant="destructive"',
      'onConfirm={() => void handleArchiveSession()}',
    ]);
  });

  test('keeps the composer compact, auto-growing, and floating over the conversation', async () => {
    const source = await readComponentSource('reports/AiReportingView.tsx');

    expectSourceContainsAll(source, [
      'data-slot="ai-reporting-composer"',
      'absolute inset-x-0 bottom-0',
      'rows={1}',
      'field-sizing-content',
      "draft ? 'max-h-40' : 'max-h-12'",
      'backdrop-blur-xl',
      'mb-2 flex justify-center',
      'pointer-events-auto relative rounded-full',
      'pb-28',
      'min-h-14 items-center',
      'self-center py-0 pr-1 pl-5',
      'self-center gap-1 py-0 pr-5 pl-1',
      'px-2 py-3',
    ]);
    expectSourceOmitsAll(source, [
      'min-h-36 flex-col',
      'absolute bottom-28',
      'border-t border-border bg-background px-4 py-4',
      'AiReportingDeleteDialog',
      'self-end',
      'pt-4 pb-2',
    ]);
  });

  test('renders validated AI tool output with shadcn chart and data-table primitives', async () => {
    const viewSource = await readComponentSource('reports/AiReportingView.tsx');
    const visualizationSource = await readComponentSource('reports/AiReportingVisualization.tsx');

    expectSourceContainsAll(viewSource, [
      'parseAiReportingVisualizations',
      '<AiReportingVisualization',
      '<AiReportingVisualizationPending',
      'getAiReportingAssistantCopyText',
    ]);
    expectSourceContainsAll(visualizationSource, [
      '<ChartContainer',
      '<ChartTooltipContent',
      '<ChartLegendContent',
      '<Collapsible',
      '<Table',
      'var(--chart-1)',
      'bg-card',
      'text-foreground',
    ]);
    expectSourceOmitsAll(visualizationSource, [
      '<button',
      '<table',
      '<svg',
      'bg-white',
      'text-zinc',
      'border-zinc',
      '#fff',
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
