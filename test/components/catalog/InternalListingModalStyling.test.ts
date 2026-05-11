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
      "import { FieldLabel } from '@/components/ui/field';",
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
});
