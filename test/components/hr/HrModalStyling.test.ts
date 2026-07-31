import { describe, test } from 'bun:test';
import {
  expectSourceContainsAll,
  expectSourceOmitsAll,
  readComponentSource,
} from '../modalStylingTestUtils';

const EMPLOYEE_VIEW_SOURCES = [
  ['internal employees', 'HR/InternalEmployeesView.tsx'],
  ['external employees', 'HR/ExternalEmployeesView.tsx'],
] as const;

describe('HR employee modal styling', () => {
  test('shared employee editor uses shadcn layout and primitives', async () => {
    const source = await readComponentSource('HR/EmployeeEditorModal.tsx');

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      "import EmployeeHrFields from './EmployeeHrFields';",
      "from './employeeHrProfile';",
      '<ModalContent size="2xl"',
      '<ModalHeader>',
      '<ModalBody className="space-y-6">',
      '<EmployeeHrFields',
      '<ModalFooter>',
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl shadow-2xl']);
  });

  test.each(
    EMPLOYEE_VIEW_SOURCES,
  )('%s view uses the shared editor and delete confirmation', async (_name, path) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      "import EmployeeEditorModal from './EmployeeEditorModal';",
      '<EmployeeEditorModal',
      '<DeleteConfirmModal',
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl shadow-2xl']);
  });

  test('shared HR profile fields use shadcn form primitives', async () => {
    const source = await readComponentSource('HR/EmployeeHrFields.tsx');

    expectSourceContainsAll(source, [
      "import { Field, FieldError, FieldLabel } from '@/components/ui/field';",
      "import { Input } from '@/components/ui/input';",
      'import {',
      'Select,',
      "import { Textarea } from '@/components/ui/textarea';",
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl shadow-2xl']);
  });

  test.each(
    EMPLOYEE_VIEW_SOURCES,
  )('%s table contact columns preserve legacy view aliases', async (_name, path) => {
    const source = await readComponentSource(path);

    expectSourceContainsAll(source, [
      "accessorKey: 'email'",
      "accessorKey: 'phone'",
      'legacyHiddenColumnIds: [LEGACY_CONTACT_COLUMN_ID]',
      'legacySortColumnIds: [LEGACY_CONTACT_COLUMN_ID]',
      'legacyFilterColumnIds: [LEGACY_CONTACT_COLUMN_ID]',
      'legacySortAccessorFn: getEmployeeContactValue',
      'legacyFilterAccessorFn: getEmployeeContactValue',
      'mapLegacyFilterValue: mapLegacyContactFilterValue',
      "id: 'roleTitle'",
      "id: 'hrStatus'",
    ]);
    expectSourceOmitsAll(source, [
      "id: 'contact'",
      "accessorFn: (row) => [row.email, row.phone].filter(Boolean).join(' ')",
      'hidden: true',
    ]);
  });
});

describe('HR competence center modal styling', () => {
  test('create, edit, and manager dialogs use shared shadcn layout and primitives', async () => {
    const source = await readComponentSource('WorkUnitsView.tsx');

    expectSourceContainsAll(source, [
      "import { Button } from '@/components/ui/button';",
      "import { Field, FieldError, FieldLabel } from '@/components/ui/field';",
      "import { Input } from '@/components/ui/input';",
      "import { Textarea } from '@/components/ui/textarea';",
      '<ModalContent size="lg">',
      '<ModalHeader>',
      '<ModalBody className="space-y-5">',
      '<ModalFooter>',
      'id="work-unit-manager-assignments"',
      '<ModalContent size="sm">',
    ]);
    expectSourceOmitsAll(source, ['rounded-2xl shadow-2xl']);
  });
});
