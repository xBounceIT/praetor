import { describe, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

describe('InternalListingView modal styling', () => {
  test('product modal uses shared shadcn layout and primitives', async () => {
    const source = await readComponentSource('catalog/InternalListingView.tsx');

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      "import { FieldLabel, RequiredMark } from '@/components/ui/field';",
      "import { Input } from '@/components/ui/input';",
      "import { Textarea } from '@/components/ui/textarea';",
      '<ModalContent size="2xl" className="max-h-[90vh]">',
      '<ModalContent size="2xl">',
      '<ModalBody className="flex-1 space-y-8">',
      '<ModalBody className="max-h-[60vh] space-y-4">',
      '<DeleteConfirmModal',
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl shadow-2xl']);
  });

  test('product modal manage actions align with their field labels', async () => {
    const source = await readComponentSource('catalog/InternalListingView.tsx');

    expectSourceContainsAll(source, [
      'className="flex min-h-6 items-center justify-between gap-2"',
      'size="xs"',
      'onClick={handleOpenManageTypes}',
      'onClick={handleOpenManageCategories}',
      'onClick={handleOpenManageSubcategories}',
    ]);
    expectSourceOmitsAll(source, ['items-end justify-between ml-1 min-h-5']);
  });
});
