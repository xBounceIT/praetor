import { describe, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

describe('HR employee modal styling', () => {
  test.each([
    ['internal employees', 'HR/InternalEmployeesView.tsx'],
    ['external employees', 'HR/ExternalEmployeesView.tsx'],
  ])('%s modal uses shared shadcn layout and primitives', async (_name, path) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      "import { Field, FieldError, FieldLabel } from '@/components/ui/field';",
      "import { Input } from '@/components/ui/input';",
      '<ModalContent size="md"',
      '<ModalHeader>',
      '<ModalBody className="space-y-4">',
      '<ModalFooter>',
      '<DeleteConfirmModal',
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl shadow-2xl']);
  });
});

describe('HR competence center modal styling', () => {
  test('create/edit dialogs use shared shadcn layout and primitives', async () => {
    const source = await readComponentSource('WorkUnitsView.tsx');

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      "import { Field, FieldError, FieldLabel } from '@/components/ui/field';",
      "import { Input } from '@/components/ui/input';",
      "import { Textarea } from '@/components/ui/textarea';",
      '<ModalContent size="lg">',
      '<ModalHeader>',
      '<ModalBody className="space-y-4">',
      '<ModalFooter>',
      '<ModalContent size="sm">',
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl shadow-2xl']);
  });
});
