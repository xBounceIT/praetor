import { describe, expect, test } from 'bun:test';

const readSource = () =>
  Bun.file(new URL('../../../components/projects/TasksView.tsx', import.meta.url)).text();

describe('TasksView', () => {
  describe('modal styling', () => {
    test('uses the shared shadcn modal layout and form primitives', async () => {
      const source = await readSource();

      expect(source).toContain("import { Button } from '@/components/ui/button';");
      expect(source).toContain("import { Field, FieldLabel } from '@/components/ui/field';");
      expect(source).toContain("import { Input } from '@/components/ui/input';");
      expect(source).toContain("import { Textarea } from '@/components/ui/textarea';");
      expect(source).toContain('<ModalContent size="lg">');
      expect(source).toContain('<ModalHeader>');
      expect(source).toContain('<ModalBody className="space-y-6">');
      expect(source).toContain('<ModalFooter className="sm:justify-between">');
      expect(source).toContain('<FieldLabel htmlFor="task-name">');
      expect(source).toContain('<FieldLabel htmlFor="task-description">');
      expect(source).toContain('<Input');
      expect(source).toContain('<Textarea');
      expect(source).toContain('variant="outline"');
      expect(source).toContain('variant="ghost"');
      expect(source).not.toContain('bg-white rounded-2xl');
      expect(source).not.toContain('shadow-lg transform active:scale-95');
      expect(source).not.toContain('shadow-white/20');
    });
  });

  describe('pagination', () => {
    test('delegates rows per page to StandardTable', async () => {
      const source = await readSource();

      expect(source).toContain('data={tasks}');
      expect(source).toContain('defaultRowsPerPage={5}');
      expect(source).not.toContain('paginatedTasks');
      expect(source).not.toContain('praetor_tasks_rowsPerPage');
      expect(source).not.toContain('handleRowsPerPageChange');
    });
  });
});
