import { describe, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

describe('EmployeeAssignmentsModal assignment workspace', () => {
  test('uses shadcn theme tokens and paginates each assignment list', async () => {
    const source = await readComponentSource('HR/EmployeeAssignmentsModal.tsx');

    expectSourceContainsAll(source, [
      'const ASSIGNMENTS_PAGE_SIZE = 7',
      'items.slice(firstItemIndex, firstItemIndex + ASSIGNMENTS_PAGE_SIZE)',
      '<Checkbox',
      '<Pagination',
      "'border-primary/40 bg-primary/5 text-foreground shadow-xs'",
      "t('hr:workforce.selectedCount', { count })",
      'rounded-lg border border-border bg-background shadow-xl',
      'bg-muted/30',
      'border-b border-border',
      "case 'setPage':",
      'pages: { ...EMPTY_ASSIGNMENT_PAGES }',
    ]);
    expectSourceOmitsAll(source, [
      'bg-white rounded-xl shadow-2xl',
      'bg-zinc-900/50',
      "'bg-zinc-50 border-zinc-300 shadow-sm'",
      "'bg-white border-zinc-200 hover:border-zinc-300'",
      'border-t border-zinc-200',
      'peer-checked:bg-praetor',
    ]);
  });
});
