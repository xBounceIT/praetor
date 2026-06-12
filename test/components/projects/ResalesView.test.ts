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

  test('requires initial resale activities when creating a resale', async () => {
    const source = await readSource();
    expect(source).toContain('activities: [createDraftResaleActivity()]');
    expect(source).toContain('resales.initialActivitiesTitle');
    expect(source).toContain('resales.validation.activitiesRequired');
    expect(source).toContain('activities: activityInputs');
  });

  test('manages resale categories from the header action', async () => {
    const source = await readSource();
    expect(source).toContain('Settings2');
    expect(source).toContain('resales.manageCategories');
    expect(source).toContain('onClick={openCategoryModal}');
    expect(source).toContain('rounded-md border border-border bg-muted/30 p-4');
    expect(source).toContain('flex items-start gap-3');
    expect(source).toContain('className="mt-7"');
  });

  test('keeps create activity rows compact and uses shared date controls', async () => {
    const source = await readSource();
    expect(source).toContain('resales.fields.startDate');
    expect(source).toContain('resales.fields.resaleRevenue');
    expect(source).toContain('resales.fields.resaleCost');
    expect(source).toContain("t('resales." + "addActivity')");
    expect(source).toContain("t('resales." + "boolean.yes')");
    expect(source).toContain("t('resales." + "boolean.no')");
    expect(source).toContain("updateDraftActivity(row._id, 'dueDate', value)");
    expect(source).not.toContain('type="date"');
    expect(source).not.toContain("t('common:buttons.manage')");
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
