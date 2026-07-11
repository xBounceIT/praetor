import { describe, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

describe('CRM modal styling', () => {
  test('suppliers modal uses shared shadcn layout and form primitives', async () => {
    const [source, contactsSource] = await Promise.all([
      readComponentSource('CRM/SuppliersView.tsx'),
      readComponentSource('CRM/SupplierContactsSection.tsx'),
    ]);

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      "import { Field, FieldError, FieldLabel } from '@/components/ui/field';",
      "import { Input } from '@/components/ui/input';",
      '<ModalContent size="2xl"',
      '<ModalBody className="flex-1 space-y-8">',
      '<DeleteConfirmModal',
    ]);
    expectSourceContainsAll(contactsSource, [
      "import { Field, FieldError, FieldLabel } from '@/components/ui/field';",
      "import { Input } from '@/components/ui/input';",
      "import { Textarea } from '@/components/ui/textarea';",
    ]);
    expectSourceOmitsAll(`${source}\n${contactsSource}`, ['<textarea']);
  });

  test('clients modal uses shared shadcn shell and delete confirmation', async () => {
    const source = await readComponentSource('CRM/ClientsView.tsx');

    expectSourceContainsAll(source, [
      "import { Input } from '@/components/ui/input';",
      "import { Textarea } from '@/components/ui/textarea';",
      '<ModalContent size="6xl"',
      '<ModalContent size="2xl"',
      '<ModalBody className="flex-1 space-y-8">',
      '<DeleteConfirmModal',
    ]);
  });
});
