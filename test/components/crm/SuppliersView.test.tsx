import { describe, expect, test } from 'bun:test';

const readSource = () =>
  Bun.file(new URL('../../../components/CRM/SuppliersView.tsx', import.meta.url)).text();

describe('<SuppliersView /> delete loading state', () => {
  test('handleDelete guards against concurrent deletes and exposes loading to DeleteConfirmModal', async () => {
    const source = await readSource();

    // The component owns the loading state.
    expect(source).toContain('const [isDeleting, setIsDeleting] = useState(false);');

    // handleDelete must short-circuit while a delete is already in flight.
    expect(source).toContain('if (!supplierToDelete || isDeleting) return;');
    expect(source).toContain('setIsDeleting(true);');
    // The state is cleared after the parent promise settles (success OR failure).
    expect(source).toContain('.finally(() => {');
    expect(source).toContain('setIsDeleting(false);');

    // DeleteConfirmModal receives the loading prop.
    expect(source).toContain('loading={isDeleting}');
  });
});
