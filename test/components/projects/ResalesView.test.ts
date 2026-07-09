import { describe, expect, mock, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Resale } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';

installI18nMock();

mock.module('../../../services/api/views', () => ({
  viewsApi: {
    list: () => Promise.resolve([]),
    create: () => Promise.reject(new Error('not used')),
    update: () => Promise.reject(new Error('not used')),
    remove: () => Promise.resolve(),
    directory: () => Promise.resolve([]),
    getShares: () => Promise.resolve([]),
    replaceShares: () => Promise.resolve([]),
  },
}));

const ResalesView = (await import('../../../components/projects/ResalesView')).default;

const readSource = async () => {
  return Bun.file(new URL('../../../components/projects/ResalesView.tsx', import.meta.url)).text();
};

const resale: Resale = {
  id: 'resale-1',
  clientOrderId: 'CO-1',
  supplierOrderId: 'SO-1',
  clientName: 'Acme Corp',
  supplierName: 'Northwind Supplies',
  supplierOrderCost: 1200,
  activityCostTotal: 500,
  resaleRevenue: 1500,
  costVariance: 700,
  startDate: '2026-06-01',
  dueDate: '2026-06-30',
  notes: null,
  createdAt: 1780300800000,
  updatedAt: 1780300800000,
  activities: [
    {
      id: 'activity-1',
      resaleId: 'resale-1',
      name: 'License renewal',
      billingFrequency: 'one_time',
      categoryId: 'cat-1',
      categoryName: 'Licenses',
      cost: 500,
      revenue: 1500,
      released: true,
      dueDate: '2026-06-30',
      notes: null,
    },
  ],
};

const renderResalesView = (resales: Resale[] = []) =>
  render(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(ResalesView, {
        resales,
        categories: [{ id: 'cat-1', name: 'Licenses' }],
        orderOptions: [],
        permissions: ['projects.resales.view'],
        currency: 'EUR',
        onAddResale: async () => null,
        onDeleteResale: async () => {},
        onAddActivity: async () => null,
        onUpdateActivity: async () => null,
        onDeleteActivity: async () => null,
        onCreateCategory: async () => null,
        onUpdateCategory: async () => null,
        onDeleteCategory: async () => {},
      }),
    ),
  );

describe('ResalesView wiring', () => {
  test('renders Rivendite and disabled Attività tabs until a resale row is selected', async () => {
    const user = userEvent.setup();
    renderResalesView([resale]);

    expect(screen.getByRole('tab', { name: 'resales.tabs.archive' })).toBeDefined();
    const activitiesTab = screen.getByRole('tab', { name: 'resales.tabs.activities' });
    expect(activitiesTab).toHaveAttribute('disabled');
    expect(screen.getByText('resales.title')).toBeDefined();

    const resaleRow = screen.getByText('CO-1').closest('tr');
    expect(resaleRow).not.toBeNull();
    await user.click(resaleRow as HTMLTableRowElement);

    expect(activitiesTab).not.toHaveAttribute('disabled');
    expect(screen.getByText('License renewal')).toBeDefined();
  });

  test('organizes resales and selected resale activities as internal tabs', async () => {
    const source = await readSource();
    expect(source).toContain('import { Tabs, TabsContent, TabsList, TabsTrigger }');
    expect(source).toContain('ShoppingCart');
    expect(source).toContain('ListChecks');
    expect(source).toContain("type ResalesViewTab = 'archive' | 'activities'");
    expect(source).toContain('activeTab: ResalesViewTab;');
    expect(source).toContain('const [uiState, dispatchUiState] = useReducer(');
    expect(source).toContain('const setActiveTab = useCallback(');
    expect(source).toContain('const handleTabChange = (value: string) => {');
    expect(source).toContain('value="archive"');
    expect(source).toContain('value="activities"');
    expect(source).toContain('<TabsContent value="archive" className="mt-0 space-y-6">');
    expect(source).toContain("controller.t('resales." + "title')");
    expect(source).toContain('disabled={!controller.selectedResale}');
    expect(source).toContain("setActiveTab('activities');");
    expect(source).toContain('resales.selectResaleForActivities');
  });

  test('opens the activities tab after a resale is created', async () => {
    const source = await readSource();

    expect(source).toMatch(
      /if \(created\) \{\s*setSelectedResaleId\(created\.id\);\s*setActiveTab\('activities'\);/,
    );
  });

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
    expect(source).toContain('onClick={controller.openCategoryModal}');
    expect(source).toContain('rounded-md border border-border bg-muted/30 p-4');
    expect(source).toContain('flex items-start gap-3');
    expect(source).toContain('className="mt-7"');
  });

  test('keeps create activity rows compact and uses shared date controls', async () => {
    const source = await readSource();
    expect(source).toContain('resales.fields.startDate');
    expect(source).toContain('resales.fields.resaleRevenue');
    expect(source).toContain('resales.fields.resaleCost');
    expect(source).toContain('resales.validation.startDate');
    expect(source).toContain('resales.validation.dueDate');
    expect(source).toContain("t('resales." + "addActivity')");
    expect(source).toContain("t('resales." + "boolean.yes')");
    expect(source).toContain("t('resales." + "boolean.no')");
    expect(source).toContain("updateDraftActivity(row._id, 'dueDate', value)");
    expect(source).toMatch(/id: 'categoryId'[\s\S]*className="min-w-\[130px\]"/);
    expect(source).toMatch(/id: 'categoryId'[\s\S]*searchable=\{false\}/);
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

  test('shows localized start and end dates in the resales archive', async () => {
    const source = await readSource();
    expect(source).toContain("header: t('resales." + "columns.startDate')");
    expect(source).toContain("header: t('resales." + "columns.endDate')");
    expect(source).toContain("accessorKey: 'startDate'");
    expect(source).toContain("accessorKey: 'dueDate'");
    expect(source).toContain('formatDateOnlyForLocale(row.startDate, i18n.language)');
    expect(source).toContain('formatDateOnlyForLocale(row.dueDate, i18n.language)');
    expect(source).toContain('formatDateOnlyForLocale(String(value), i18n.language)');
  });

  test('shows supplier cost variance without blocking save', async () => {
    const source = await readSource();
    expect(source).toContain('controller.selectedResale.costVariance');
    expect(source).toContain('resales.' + 'varianceHint');
    expect(source).toContain('Math.abs(controller.selectedResale.costVariance) > 0.009');
  });
});
