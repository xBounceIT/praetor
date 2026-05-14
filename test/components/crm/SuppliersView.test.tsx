import { describe, test } from 'bun:test';
import { expectSourceContainsAll, readComponentSource } from '../modalStylingTestUtils';

describe('SuppliersView CRUD failure surfacing', () => {
  test('handleSubmit/handleDelete/handleStatusUpdate await + try/catch + toast', async () => {
    const source = await readComponentSource('CRM/SuppliersView.tsx');

    expectSourceContainsAll(source, [
      "import { toastError } from '../../utils/toast';",
      'const handleSubmit = async (e: React.FormEvent)',
      'await onUpdateSupplier(editingSupplier.id, payload);',
      'await onAddSupplier(payload);',
      'const handleDelete = async () =>',
      'await onDeleteSupplier(supplierToDelete.id);',
      'const handleStatusUpdate = useCallback(',
      'await onUpdateSupplier(id, updates);',
      "t('crm:suppliers.failedToSave')",
      "t('crm:suppliers.failedToDelete')",
      "t('crm:suppliers.failedToUpdateStatus')",
      'void handleStatusUpdate(row.id, { isDisabled: !row.isDisabled });',
    ]);
  });
});
