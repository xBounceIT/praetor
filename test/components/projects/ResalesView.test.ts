import { describe, expect, test } from 'bun:test';

const readSource = async () => {
  return Bun.file(new URL('../../../components/projects/ResalesView.tsx', import.meta.url)).text();
};

describe('ResalesView wiring', () => {
  test('declares the expected economic-only resales props surface', async () => {
    const source = await readSource();
    expect(source).toContain('export interface ResalesViewProps');
    for (const field of [
      'resales: Resale[]',
      'categories: ResaleCategory[]',
      'orderOptions: ResaleOrderOption[]',
      'permissions: string[]',
      'currency: string',
      'onAddResale:',
      'onDeleteResale:',
      'onAddActivity:',
      'onUpdateActivity:',
      'onDeleteActivity:',
      'onCreateCategory:',
      'onUpdateCategory:',
      'onDeleteCategory:',
    ]) {
      expect(source).toContain(field);
    }
  });

  test('filters supplier orders from the selected client order option', async () => {
    const source = await readSource();
    expect(source).toMatch(
      /orderOptions\.find\([\s\S]*option\.clientOrderId === resaleForm\.clientOrderId/,
    );
    expect(source).toMatch(/selectedOrderOption\?\.supplierOrders\.map\(\(order\) =>/);
  });

  test('renders all requested resale activity columns', async () => {
    const source = await readSource();
    for (const key of [
      'activityName',
      'billing',
      'category',
      'cost',
      'revenue',
      'released',
      'dueDate',
      'notes',
    ]) {
      expect(source).toContain(`resales.columns.${key}`);
    }
  });

  test('shows supplier cost variance without blocking save', async () => {
    const source = await readSource();
    expect(source).toContain('selectedResale.costVariance');
    expect(source).toContain('resales.' + 'varianceHint');
    expect(source).toContain('Math.abs(selectedResale.costVariance) > 0.009');
  });
});
