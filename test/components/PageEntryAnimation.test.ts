import { describe, expect, test } from 'bun:test';

const routeViewSources = [
  '../../App.tsx',
  '../../components/CRM/ClientsView.tsx',
  '../../components/CRM/SuppliersView.tsx',
  '../../components/HR/ExternalEmployeesView.tsx',
  '../../components/HR/InternalEmployeesView.tsx',
  '../../components/UserSettings.tsx',
  '../../components/WorkUnitsView.tsx',
  '../../components/accounting/ClientsInvoicesView.tsx',
  '../../components/accounting/ClientsOrdersView.tsx',
  '../../components/accounting/SupplierInvoicesView.tsx',
  '../../components/accounting/SupplierOrdersView.tsx',
  '../../components/administration/AuthSettings.tsx',
  '../../components/administration/EmailSettings.tsx',
  '../../components/administration/GeneralSettings.tsx',
  '../../components/administration/LogsView.tsx',
  '../../components/administration/RolesView.tsx',
  '../../components/administration/UserManagement.tsx',
  '../../components/administration/WebhooksView.tsx',
  '../../components/catalog/InternalListingView.tsx',
  '../../components/projects/ProjectDetailView.tsx',
  '../../components/projects/ProjectsView.tsx',
  '../../components/projects/ResalesView.tsx',
  '../../components/projects/TasksView.tsx',
  '../../components/sales/ClientOffersView.tsx',
  '../../components/sales/ClientQuotesView.tsx',
  '../../components/sales/SupplierQuotesView.tsx',
  '../../components/timesheet/RecurringManager.tsx',
] as const;

const wholePageEntryAnimations = [
  'className="flex flex-col gap-6 animate-in fade-in duration-500"',
  'className="space-y-8 animate-in fade-in duration-500"',
  'className="space-y-6 animate-in fade-in duration-500"',
  'className="space-y-6 animate-in fade-in duration-300"',
  'className="space-y-6 animate-in slide-in-from-bottom-2 duration-500"',
  'className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500"',
  'className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500"',
  'animate-in fade-in slide-in-from-right-4 duration-300',
  'animate-in fade-in slide-in-from-left-4 duration-300',
] as const;

describe('route view entry animations', () => {
  test('do not fade whole-page wrappers during fast navigation', async () => {
    for (const sourcePath of routeViewSources) {
      const source = await Bun.file(new URL(sourcePath, import.meta.url)).text();

      for (const className of wholePageEntryAnimations) {
        expect(source, `${sourcePath} should not dim the whole route view`).not.toContain(
          className,
        );
      }
    }
  });
});
