import { describe, expect, test } from 'bun:test';

const readTasksViewSource = () =>
  Bun.file(new URL('../../../components/projects/TasksView.tsx', import.meta.url)).text();

const readTaskFormModalSource = () =>
  Bun.file(new URL('../../../components/projects/TaskFormModal.tsx', import.meta.url)).text();

describe('TasksView', () => {
  describe('modal styling', () => {
    test('the shared TaskFormModal uses shadcn modal layout and form primitives', async () => {
      const source = await readTaskFormModalSource();

      expect(source).toContain("import { Button } from '@/components/ui/button';");
      expect(source).toContain("import { Field, FieldLabel } from '@/components/ui/field';");
      expect(source).toContain("import { Input } from '@/components/ui/input';");
      expect(source).toContain("import { Textarea } from '@/components/ui/textarea';");
      expect(source).toContain('<ModalContent size="2xl">');
      expect(source).toContain('<ModalHeader>');
      expect(source).toContain('<ModalBody className="space-y-6">');
      expect(source).toContain('<ModalFooter className="sm:justify-between">');
      expect(source).toContain('<div className="grid gap-4 md:grid-cols-2">');
      expect(source).toContain('<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">');
      expect(source).toContain('<FieldLabel htmlFor="task-name" required>');
      expect(source).toContain('<FieldLabel htmlFor="task-description">');
      expect(source).toContain('<FieldLabel htmlFor="task-duration">');
      expect(source).toContain('<FieldLabel htmlFor="task-total-revenue">');
      expect(source).toContain('<FieldLabel htmlFor="task-notes">');
      expect(source).toContain("field: 'duration'");
      expect(source).toContain('formatTaskNumber(totalEffort)');
      expect(source).toContain('formatTaskNumber(totalRevenue, 2)');
      expect(source).toContain('<output');
      expect(source).toContain('<Input');
      expect(source).toContain('<Textarea');
      expect(source).toContain('id="task-notes"');
      expect(source).toContain('variant="outline"');
      expect(source).toContain('variant="ghost"');
      expect(source).not.toContain('bg-white rounded-2xl');
      expect(source).not.toContain('shadow-lg transform active:scale-95');
      expect(source).not.toContain('shadow-white/20');
    });

    test('TasksView renders the shared TaskFormModal', async () => {
      const source = await readTasksViewSource();

      expect(source).toContain("from './TaskFormModal'");
      expect(source).toContain('TaskFormModal');
      expect(source).toContain('<TaskFormModal');
    });
  });

  describe('pagination', () => {
    test('delegates rows per page to StandardTable', async () => {
      const source = await readTasksViewSource();

      expect(source).toContain('data={tasks}');
      expect(source).toContain('defaultRowsPerPage={5}');
      expect(source).not.toContain('paginatedTasks');
      expect(source).not.toContain('praetor_tasks_rowsPerPage');
      expect(source).not.toContain('handleRowsPerPageChange');
    });
  });

  describe('assignment modal user list (issue #720)', () => {
    test('uses the dedicated assignment update permission for task membership changes', async () => {
      const source = await readTasksViewSource();

      expect(source).toMatch(
        /const canManageAssignments = hasScopedActionPermission\(\s*permissions,\s*'projects\.assignments',\s*'update',\s*\);/,
      );
      expect(source).toMatch(
        /const openAssignments = useCallback\(\s*\(taskId: string\) => \{\s*if \(!canManageAssignments\) return;/,
      );
      expect(source).toMatch(
        /\{canManageAssignments && \(\s*<Tooltip>[\s\S]*?onOpenAssignments\(row\.id\)/,
      );
      expect(source).toContain('disabled={!canManageAssignments}');
    });

    test('filters top managers, admin-only, and disabled users out of the assignable list', async () => {
      const source = await readTasksViewSource();

      // Mirrors ProjectsView: top managers must not appear as removable members, otherwise a
      // top manager can toggle themselves off an activity.
      expect(source).toMatch(
        /const assignableUsers = users\.filter\(\s*\(u\) =>\s*!u\.hasTopManagerRole && !u\.isAdminOnly && !u\.isDisabled,?\s*\);/,
      );
    });

    test('passes the filtered list (not the raw users prop) to UserAssignmentModal', async () => {
      const source = await readTasksViewSource();

      expect(source).toContain('users={assignableUsers}');
      expect(source).not.toContain('users={users}');
    });
  });
});
