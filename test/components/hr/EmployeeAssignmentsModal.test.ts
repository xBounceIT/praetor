import { describe, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

describe('EmployeeAssignmentsModal dark-mode chrome', () => {
  test('modal chrome uses theme tokens, not white/zinc slabs', async () => {
    const source = await readComponentSource('HR/EmployeeAssignmentsModal.tsx');

    // Panel, header/footer bars, sticky column headers, and the assignment cards adapt to the
    // theme instead of rendering as white/zinc slabs on the dark surface (mirrors the
    // UserManagement role-assignment modal, PR #800).
    expectSourceContainsAll(source, [
      'bg-card rounded-xl shadow-2xl',
      'bg-muted/50',
      'border-b border-border',
      "'bg-accent border-border shadow-sm'",
    ]);
    expectSourceOmitsAll(source, [
      'bg-white rounded-xl shadow-2xl',
      "'bg-zinc-50 border-zinc-300 shadow-sm'",
      "'bg-white border-zinc-200 hover:border-zinc-300'",
      'border-t border-zinc-200',
    ]);
  });
});
