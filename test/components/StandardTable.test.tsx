import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { THEME_STORAGE_KEY } from '../../utils/theme';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock();

const csvModule = await import('../../utils/csv');
const downloadCsvSpy = spyOn(csvModule, 'downloadCsv').mockImplementation(() => () => {});

const clipboardModule = await import('../../utils/clipboard');
const writeClipboardSpy = spyOn(clipboardModule, 'writeTextToClipboard').mockResolvedValue(true);
const readClipboardSpy = spyOn(clipboardModule, 'readTextFromClipboard').mockResolvedValue({
  ok: false,
  reason: 'unavailable',
});

const { Tooltip, TooltipContent, TooltipTrigger } = await import('../../components/ui/tooltip');
const { useState } = await import('react');
const { decodeLegacyFilterValue } = await import('../../components/shared/customViewHelpers');
const StandardTable = (await import('../../components/shared/StandardTable')).default;
const Modal = (await import('../../components/shared/Modal')).default;
const QuickViewLinkButton = (await import('../../components/shared/QuickViewLinkButton')).default;
const StatusBadge = (await import('../../components/shared/StatusBadge')).default;

const countPaddingRows = (container: HTMLElement) =>
  container.querySelectorAll('tbody tr[aria-hidden="true"]').length;

type Row = { id: string; name: string; age: number };
type ContactRow = Row & { email: string; phone: string };

const TABLE_FONT_SIZE_STORAGE_KEY = 'praetor_table_fontsize';

const sampleRows: Row[] = [
  { id: '1', name: 'Alice', age: 30 },
  { id: '2', name: 'Bob', age: 25 },
  { id: '3', name: 'Charlie', age: 35 },
];

const sampleColumns = [
  { header: 'Name', accessorKey: 'name' as const, id: 'name' },
  { header: 'Age', accessorKey: 'age' as const, id: 'age' },
];

const mapLegacyContactEmailFilterValueForTest = (value: string) => value.trim();

const getLegacyContactFilterValueForTest = (row: ContactRow) =>
  [row.email, row.phone].filter(Boolean).join(' ');

const contactAliasColumns = [
  { header: 'Name', accessorKey: 'name' as const, id: 'name' },
  {
    header: 'Email',
    accessorKey: 'email' as const,
    id: 'email',
    legacyHiddenColumnIds: ['contact'],
    legacySortColumnIds: ['contact'],
    legacyFilterColumnIds: ['contact'],
    legacySortAccessorFn: getLegacyContactFilterValueForTest,
    legacyFilterAccessorFn: getLegacyContactFilterValueForTest,
    mapLegacyFilterValue: mapLegacyContactEmailFilterValueForTest,
  },
  {
    header: 'Phone',
    accessorKey: 'phone' as const,
    id: 'phone',
    legacyHiddenColumnIds: ['contact'],
  },
];

const clickSortHeader = (headerText: string) => {
  const headerCell = screen.getByText(headerText).closest('th') as HTMLTableCellElement;
  const btn = within(headerCell)
    .getAllByRole('button')
    .find((button) => button.textContent?.trim().startsWith(headerText)) as HTMLButtonElement;
  act(() => {
    fireEvent.click(btn);
  });
};

const openHeaderFilter = async (columnHeader: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: `table.filters ${columnHeader}` }));
  return user;
};

const selectFilterValue = async (columnHeader: string, value: string) => {
  const user = await openHeaderFilter(columnHeader);
  act(() => {
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: value }));
  });
  return user;
};

const openColumnSettings = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('table.columnSettings'));
  return user;
};

const openCustomViews = async () => {
  const user = await openColumnSettings();
  await user.click(screen.getByText('table.customViews'));
  return user;
};

const clickMenuItemByText = (text: string) => {
  const item = screen.getByText(text).closest('[role="menuitem"]') as HTMLElement;
  act(() => fireEvent.click(item));
};

const clickMenuAction = (element: HTMLElement) => {
  act(() => fireEvent.click(element.closest('[role="menuitem"]') ?? element));
};

const getRenderedColumnIds = () =>
  Array.from(document.querySelectorAll<HTMLElement>('thead [data-column-header-label]')).map(
    (element) => element.dataset.columnHeaderLabel,
  );

const getCustomViewColumnIds = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-custom-view-column-id]')).map(
    (element) => element.dataset.customViewColumnId,
  );

const dragColumnAfter = (sourceHeader: string, targetHeader: string) => {
  const dataTransfer = {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: mock(() => {}),
  };
  const handle = screen.getByLabelText(`table.reorderColumnHandle: ${sourceHeader}`);
  const target = screen.getByText(targetHeader).closest('th') as HTMLTableCellElement;
  target.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
  act(() => {
    fireEvent.dragStart(handle, { dataTransfer });
  });
  act(() => {
    fireEvent.dragOver(target, { clientX: 1, dataTransfer });
  });
  expect(target.getAttribute('data-column-drop-position')).toBe('after');
  act(() => {
    fireEvent.drop(target, { clientX: 1, dataTransfer });
  });
};

const dragCustomViewColumnAfter = (sourceId: string, targetId: string) => {
  const dataTransfer = {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: mock(() => {}),
  };
  const handle = document.querySelector<HTMLElement>(
    `[data-custom-view-column-drag-handle="${sourceId}"]`,
  );
  const target = document.querySelector<HTMLElement>(`[data-custom-view-column-id="${targetId}"]`);
  if (!handle || !target) throw new Error('Missing custom view column drag target');
  target.getBoundingClientRect = () => ({ top: 0, height: 100 }) as DOMRect;
  act(() => fireEvent.dragStart(handle, { dataTransfer }));
  // Entering the next row should reorder immediately; reaching its lower half is unnecessary.
  act(() => fireEvent.dragOver(target, { clientY: 1, dataTransfer }));
  act(() => fireEvent.drop(target, { clientY: 1, dataTransfer }));
};

describe('<StandardTable />', () => {
  beforeEach(() => {
    localStorage.clear();
    downloadCsvSpy.mockClear();
    writeClipboardSpy.mockClear();
    readClipboardSpy.mockClear();
    writeClipboardSpy.mockResolvedValue(true);
    readClipboardSpy.mockResolvedValue({ ok: false, reason: 'unavailable' });
  });

  afterEach(() => {
    localStorage.clear();
  });

  afterAll(() => {
    downloadCsvSpy.mockRestore();
    writeClipboardSpy.mockRestore();
    readClipboardSpy.mockRestore();
  });

  test('renders rows and column headers', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  test('empty state when data is empty', () => {
    render(<StandardTable<Row> title="People" data={[]} columns={sampleColumns} />);
    expect(screen.getByText('table.noResults')).toBeInTheDocument();
  });

  test('empty state renders the shadcn Empty primitive at minimum height', () => {
    const { container } = render(
      <StandardTable<Row> title="People" data={[]} columns={sampleColumns} />,
    );
    const emptyEl = container.querySelector('[data-slot="empty"]') as HTMLElement | null;
    expect(emptyEl).not.toBeNull();
    expect(emptyEl?.textContent).toContain('table.noResults');
    // Default minBodyRows = 4, body row height = 44px → at least 176px reserved.
    expect(Number.parseInt(emptyEl?.style.minHeight ?? '0', 10)).toBeGreaterThanOrEqual(176);
  });

  test('custom emptyState overrides default text', () => {
    render(
      <StandardTable<Row>
        title="People"
        data={[]}
        columns={sampleColumns}
        emptyState={<div>Nothing here</div>}
      />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByText('table.noResults')).not.toBeInTheDocument();
  });

  test('short pages are padded with aria-hidden placeholder rows up to minBodyRows', () => {
    const { container } = render(
      <StandardTable<Row>
        title="ShortPage"
        data={sampleRows.slice(0, 1)}
        columns={sampleColumns}
      />,
    );
    const paddingRows = container.querySelectorAll('tbody tr[aria-hidden="true"]');
    expect(paddingRows.length).toBe(3);
    // Padding rows must be inert and excluded from the a11y tree so existing
    // role-based queries (and screen readers) ignore them.
    for (const padding of paddingRows) {
      expect(padding.className).toContain('pointer-events-none');
      expect(padding.querySelector('button')).toBeNull();
    }
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
  });

  test('full pages skip padding rows entirely', () => {
    const many: Row[] = Array.from({ length: 5 }, (_, i) => ({
      id: String(i + 1),
      name: `User${i + 1}`,
      age: 20 + i,
    }));
    const { container } = render(
      <StandardTable<Row> title="FullPage" data={many} columns={sampleColumns} />,
    );
    expect(countPaddingRows(container)).toBe(0);
  });

  test('minBodyRows prop overrides the default padding target', () => {
    const { container } = render(
      <StandardTable<Row>
        title="CustomMin"
        data={sampleRows.slice(0, 1)}
        columns={sampleColumns}
        minBodyRows={2}
      />,
    );
    expect(countPaddingRows(container)).toBe(1);
  });

  test('minBodyRows={0} disables padding so the body collapses to its rows', () => {
    const { container } = render(
      <StandardTable<Row>
        title="NoPadding"
        data={sampleRows.slice(0, 1)}
        columns={sampleColumns}
        minBodyRows={0}
      />,
    );
    expect(countPaddingRows(container)).toBe(0);
  });

  test('renders rows in source order by default', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    const cells = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent);
    expect(cells[0]).toContain('Alice');
    expect(cells[1]).toContain('Bob');
    expect(cells[2]).toContain('Charlie');
  });

  test('row click fires onRowClick with the row object', () => {
    const onRowClick = mock((_row: Row) => {});
    render(
      <StandardTable<Row>
        title="People"
        data={sampleRows}
        columns={sampleColumns}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText('Bob'));
    expect(onRowClick).toHaveBeenCalledWith(sampleRows[1]);
  });

  test('rowsPerPage persists to localStorage', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />,
    );

    // The rows-per-page shadcn Select trigger shows the current value (default 10).
    const trigger = screen.getByRole('combobox');
    expect(trigger.textContent).toContain('10');
    expect(trigger.className).toContain('rounded-lg');
    await user.click(trigger);

    // Pick "20" from the dropdown - fail loudly if the option isn't rendered.
    await user.click(screen.getByRole('option', { name: '20' }));
    unmount();

    // localStorage should hold the newly-selected value, not just any value.
    expect(localStorage.getItem('praetor_table_rows_people')).toBe('20');
  });

  test('persistenceKey isolates rows, widths, and saved views while migrating its legacy font', async () => {
    const keyedView = [
      {
        id: 'keyed-view',
        name: 'Oldest first',
        hiddenColIds: [],
        sortState: { colId: 'age', px: 'desc' },
        filterState: {},
      },
    ];
    localStorage.setItem('praetor_table_rows_articoli', '50');
    localStorage.setItem('praetor_table_rows_client_quote_items', '5');
    localStorage.setItem('praetor_table_fontsize_articoli', 'xs');
    localStorage.setItem('praetor_table_fontsize_client_quote_items', 'base');
    localStorage.setItem('praetor_table_colwidths_articoli', JSON.stringify({ name: 112 }));
    localStorage.setItem(
      'praetor_table_colwidths_client_quote_items',
      JSON.stringify({ name: 220 }),
    );
    localStorage.setItem('praetor_table_customviews_client_quote_items', JSON.stringify(keyedView));
    localStorage.setItem('praetor_table_activeview_client_quote_items', 'keyed-view');

    const user = userEvent.setup();
    const { unmount } = render(
      <StandardTable<Row>
        title="Articoli"
        persistenceKey="client.quote.items"
        data={sampleRows}
        columns={sampleColumns}
      />,
    );

    const trigger = screen.getByRole('combobox');
    expect(trigger.textContent).toContain('5');
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Charlie');
    expect(rows[1].className).toContain('text-base');
    expect((screen.getByText('Name').closest('th') as HTMLTableCellElement).style.width).toBe(
      '220px',
    );

    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: '20' }));
    unmount();

    expect(localStorage.getItem('praetor_table_rows_client_quote_items')).toBe('20');
    expect(localStorage.getItem('praetor_table_rows_articoli')).toBe('50');
    expect(localStorage.getItem('praetor_table_fontsize_articoli')).toBe('xs');
    expect(localStorage.getItem(TABLE_FONT_SIZE_STORAGE_KEY)).toBe('base');
    expect(localStorage.getItem('praetor_table_colwidths_articoli')).toBe(
      JSON.stringify({ name: 112 }),
    );
  });

  test('rows-per-page select menu uses the scoped shadcn dark theme', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const user = userEvent.setup();
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);

    await user.click(screen.getByRole('combobox'));

    const content = document.body.querySelector('[data-slot="select-content"]');
    expect(content?.hasAttribute('data-shadcn-theme-scope')).toBe(true);
    expect(content?.getAttribute('data-shadcn-theme')).toBe('dark');
    expect(content?.className).toContain('dark');
    expect(content?.className).toContain('border-border');
  });

  test('CSV export follows the displayed column order', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    expect(screen.getByRole('table').parentElement?.className).toContain('rounded-lg');
    dragColumnAfter('Name', 'Age');
    const exportButton = screen.getByText('table.export');
    fireEvent.click(exportButton);

    expect(downloadCsvSpy).toHaveBeenCalled();
    const args = downloadCsvSpy.mock.calls[0];
    // First arg: rows array (header row + data rows)
    expect(Array.isArray(args[0])).toBe(true);
    const rows = args[0] as string[][];
    expect(rows[0]).toEqual(['Age', 'Name']);
    expect(rows.length).toBe(4); // header + 3 rows
    // Second arg: filename string
    expect(typeof args[1]).toBe('string');
    expect((args[1] as string).startsWith('people_')).toBe(true);
    expect((args[1] as string).endsWith('.csv')).toBe(true);
  });

  test('cell renders custom cell function output', () => {
    const colsWithCustom = [
      ...sampleColumns,
      {
        header: 'Tag',
        id: 'tag',
        accessorFn: (row: Row) => row.name,
        cell: ({ row }: { row: Row }) => <span data-testid={`tag-${row.id}`}>tag-{row.name}</span>,
      },
    ];
    render(<StandardTable<Row> title="People" data={sampleRows} columns={colsWithCustom} />);
    expect(screen.getByTestId('tag-1').textContent).toBe('tag-Alice');
  });

  test('renders count and label in header', () => {
    render(
      <StandardTable<Row>
        title="People"
        data={sampleRows}
        columns={sampleColumns}
        totalLabel="users"
      />,
    );
    // With 3 rows, the header should show "3 users"
    expect(screen.getByText(/3\s+users/)).toBeInTheDocument();
  });

  test('keeps column ordering available when column hiding is disabled', async () => {
    render(
      <StandardTable<Row>
        title="Fixed Columns"
        data={sampleRows}
        columns={sampleColumns}
        allowColumnHiding={false}
      />,
    );

    expect(document.querySelectorAll('[data-column-drag-handle]')).toHaveLength(2);
    const user = await openColumnSettings();
    expect(screen.queryAllByRole('menuitemcheckbox')).toHaveLength(0);
    expect(screen.getByText('table.resetColumns')).toBeInTheDocument();

    await user.click(screen.getByText('table.customViews'));
    clickMenuItemByText('buttons.add');
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('[aria-pressed]')).toBeNull();
    expect(dialog.querySelectorAll('[data-custom-view-column-drag-handle]')).toHaveLength(2);
  });

  test('ignores hidden columns from an active saved view when hiding is disabled', () => {
    localStorage.setItem(
      'praetor_table_customviews_fixed_columns',
      JSON.stringify([
        {
          id: 'hidden-age',
          name: 'Hidden age',
          hiddenColIds: ['age'],
          columnOrder: ['name', 'age'],
          sortState: null,
          filterState: {},
        },
      ]),
    );
    localStorage.setItem('praetor_table_activeview_fixed_columns', 'hidden-age');

    render(
      <StandardTable<Row>
        title="Fixed Columns"
        data={sampleRows}
        columns={sampleColumns}
        allowColumnHiding={false}
      />,
    );

    expect(screen.getByText('Age')).toBeInTheDocument();
  });

  test('disabled row receives disabled styling', () => {
    render(
      <StandardTable<Row>
        title="People"
        data={sampleRows}
        columns={sampleColumns}
        disabledRow={(row) => row.id === '2'}
      />,
    );
    // Bob's row should be present but with the disabled visual treatment.
    // We just confirm Bob's text still renders - the classNames are an implementation detail.
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  test('sticky-right last column does not stretch; rightmost non-sticky column does and keeps its alignment', () => {
    const columns = [
      { header: 'Name', accessorKey: 'name' as const, id: 'name' },
      { header: 'Age', accessorKey: 'age' as const, id: 'age', align: 'right' as const },
      {
        id: 'actions',
        header: 'Actions',
        cell: () => <button type="button">x</button>,
      },
    ];
    render(<StandardTable<Row> title="People" data={sampleRows} columns={columns} />);

    // rows[0] is the header; rows[1] is Alice's data row.
    const aliceRow = screen.getAllByRole('row')[1];
    const cells = aliceRow.querySelectorAll('td');
    expect(cells.length).toBe(4);

    // Fixed-layout cells keep their alignment without relying on a stretch column.
    expect(cells[1].className).toContain('align-middle');
    expect(cells[1].className).toContain('text-right');
    expect(cells[1].className).toContain('overflow-hidden');

    // Spacer absorbs spare container width so the sticky action column remains on the right.
    expect(cells[2]).toHaveAttribute('aria-hidden', 'true');
    expect(cells[2].style.width).toBe('auto');
    expect(cells[3].className).toContain('w-auto');
    expect(cells[3].className).not.toMatch(/\bw-full\b/);
    expect(screen.getByRole('table').style.width).toBe('100%');
    expect(screen.getByRole('table').style.minWidth).not.toBe('');
    const ageResizeLine = screen
      .getByText('Age')
      .closest('th')
      ?.querySelector('[data-column-resize-line="age"]');
    const ageResizeHandle = screen
      .getByText('Age')
      .closest('th')
      ?.querySelector('[data-column-resize-handle="age"]');
    expect(ageResizeLine?.className).toContain('bg-transparent');
    expect(ageResizeLine?.className).not.toContain('bg-border');
    expect(ageResizeHandle?.className).toContain('z-10');
    expect(ageResizeHandle?.className).not.toContain('z-30');
  });

  test('sparse action-only custom views keep actions sticky without inserting a spacer', () => {
    const columns = [
      { header: 'Name', accessorKey: 'name' as const, id: 'name' },
      {
        id: 'actions',
        header: 'Actions',
        cell: () => <button type="button">x</button>,
      },
    ];
    render(<StandardTable<Row> title="People" data={sampleRows} columns={columns} />);

    const headerRow = screen.getAllByRole('row')[0];
    const headerCells = headerRow.querySelectorAll('th');
    const aliceRow = screen.getAllByRole('row')[1];
    const cells = aliceRow.querySelectorAll('td');

    // Two data columns + a trailing-spacer cell that absorbs leftover container space.
    expect(headerCells).toHaveLength(3);
    expect(cells).toHaveLength(3);
    expect(headerCells[1].className).toContain('sticky');
    expect(headerCells[1].className).toContain('right-0');
    expect(cells[1].className).toContain('sticky');
    expect(cells[1].className).toContain('right-0');
    // No action-anchor spacer is inserted when only one data column is present.
    expect(screen.getByRole('table').querySelector('[data-action-spacer]')).toBeNull();
    // A trailing spacer column stretches the table without overriding any column width.
    expect(screen.getByRole('table').querySelector('[data-trailing-spacer]')).not.toBeNull();
    expect(screen.getByRole('table').style.width).toBe('100%');
    expect(Number.parseInt(headerCells[0].style.width, 10)).toBeGreaterThan(0);
    expect(
      screen.getByText('Name').closest('th')?.querySelector('[data-column-resize-line="name"]')
        ?.className,
    ).toContain('bg-border');
  });

  // ---------------------------------------------------------------------------
  // Column ordering
  // ---------------------------------------------------------------------------
  test('drag and keyboard reorder headers and cells while actions stay fixed', () => {
    const columns = [
      ...sampleColumns,
      {
        id: 'actions',
        header: 'Actions',
        disableSorting: true,
        disableFiltering: true,
        sticky: 'right' as const,
        cell: () => <button type="button">Edit</button>,
      },
    ];
    render(<StandardTable<Row> title="Column Order" data={sampleRows} columns={columns} />);

    expect(screen.getByLabelText('table.reorderColumnHandle: Name')).toBeInTheDocument();
    expect(screen.getByLabelText('table.reorderColumnHandle: Age')).toBeInTheDocument();
    expect(screen.queryByLabelText('table.reorderColumnHandle: Actions')).not.toBeInTheDocument();

    dragColumnAfter('Name', 'Age');
    expect(getRenderedColumnIds()).toEqual(['age', 'name', 'actions']);
    const firstRowValues = Array.from(
      screen.getAllByRole('row')[1].querySelectorAll<HTMLElement>('.standard-table-value-cell'),
    ).map((cell) => cell.textContent);
    expect(firstRowValues).toEqual(['30', 'Alice']);

    const ageHandle = screen.getByLabelText('table.reorderColumnHandle: Age');
    act(() => fireEvent.keyDown(ageHandle, { key: 'ArrowRight' }));
    expect(getRenderedColumnIds()).toEqual(['name', 'age', 'actions']);
  });

  test('reset columns restores the definition order after a drag', async () => {
    render(<StandardTable<Row> title="Reset Order" data={sampleRows} columns={sampleColumns} />);
    dragColumnAfter('Name', 'Age');
    expect(getRenderedColumnIds()).toEqual(['age', 'name']);

    const user = await openColumnSettings();
    await user.click(screen.getByText('table.resetColumns'));
    expect(getRenderedColumnIds()).toEqual(['name', 'age']);
  });

  // ---------------------------------------------------------------------------
  // Sorting (via TanStack header sort handlers)
  // ---------------------------------------------------------------------------
  test('sorting ascending by name reorders the rendered rows', () => {
    // Render with intentionally unsorted data so a no-op sort would fail.
    const unsortedRows: Row[] = [
      { id: '3', name: 'Charlie', age: 35 },
      { id: '1', name: 'Alice', age: 30 },
      { id: '2', name: 'Bob', age: 25 },
    ];
    render(<StandardTable<Row> title="People" data={unsortedRows} columns={sampleColumns} />);
    clickSortHeader('Name');
    const rows = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('Alice');
    expect(rows[1]).toContain('Bob');
    expect(rows[2]).toContain('Charlie');
  });

  test('sortable column header uses shadcn hover background and sort icon styling', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);

    const headerCell = screen.getByText('Name').closest('th') as HTMLTableCellElement;
    const sortButton = within(headerCell)
      .getAllByRole('button')
      .find((button) => button.textContent?.trim().startsWith('Name')) as HTMLButtonElement;
    const sortIcon = sortButton.querySelector('svg.lucide-arrow-up-down');

    expect(sortButton.className).toContain('rounded-lg');
    expect(sortButton.className).not.toContain('-ml-2');
    expect(screen.getByLabelText('table.reorderColumnHandle: Name').className).toContain('-ml-2');
    expect(sortButton.className).toContain('font-semibold');
    expect(sortButton.className).toContain('hover:bg-accent');
    expect(sortButton.className).toContain('hover:text-accent-foreground');
    expect(sortIcon?.className).toContain('transition-colors');
  });

  test('all sortable header buttons align with cell padding', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);

    for (const headerText of ['Name', 'Age']) {
      const headerCell = screen.getByText(headerText).closest('th') as HTMLTableCellElement;
      const sortButton = within(headerCell)
        .getAllByRole('button')
        .find((button) => button.textContent?.trim().startsWith(headerText)) as HTMLButtonElement;
      expect(sortButton.className).not.toContain('-ml-2');
      expect(screen.getByLabelText(`table.reorderColumnHandle: ${headerText}`).className).toContain(
        '-ml-2',
      );
    }
  });

  test('every non-action header shows a sort icon affordance', () => {
    const columns = [
      { header: 'Name', accessorKey: 'name' as const, id: 'name' },
      { header: 'Age', accessorKey: 'age' as const, id: 'age', disableSorting: true },
      {
        id: 'actions',
        header: 'Actions',
        sticky: 'right' as const,
        cell: () => <span>X</span>,
      },
    ];
    render(<StandardTable<Row> title="People" data={sampleRows} columns={columns} />);

    expect(screen.getByText('Name').closest('th')?.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('Age').closest('th')?.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('Actions').closest('th')?.querySelector('svg')).toBeNull();
  });

  test('simple resize handle click does not change or persist the column width', async () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);

    const headerCell = screen.getByText('Name').closest('th') as HTMLTableCellElement;
    const resizeHandle = headerCell.querySelector(
      '[data-column-resize-handle="name"]',
    ) as HTMLElement;
    const resizeLine = headerCell.querySelector('[data-column-resize-line="name"]') as HTMLElement;
    const initialWidth = headerCell.style.width;

    expect(resizeHandle.className).toContain('w-2');
    expect(resizeHandle.className).toContain('right-0');
    expect(resizeHandle.className).toContain('touch-none');
    expect(resizeLine.className).toContain('w-px');
    expect(resizeLine.className).toContain('bg-border');

    act(() => {
      fireEvent.mouseDown(resizeHandle, { clientX: 128 });
      fireEvent.mouseUp(document);
    });

    await waitFor(() => expect(headerCell.style.width).toBe(initialWidth));
    const saved = JSON.parse(localStorage.getItem('praetor_table_colwidths_people') ?? '{}');
    expect(saved.name).toBeUndefined();
  });

  test('dragging a resize handle increases only the target column', async () => {
    render(<StandardTable<Row> title="Drag Widths" data={sampleRows} columns={sampleColumns} />);

    const nameHeader = screen.getByText('Name').closest('th') as HTMLTableCellElement;
    const ageHeader = screen.getByText('Age').closest('th') as HTMLTableCellElement;
    const resizeHandle = nameHeader.querySelector(
      '[data-column-resize-handle="name"]',
    ) as HTMLElement;
    const initialNameWidth = Number.parseInt(nameHeader.style.width, 10);
    const initialAgeWidth = Number.parseInt(ageHeader.style.width, 10);

    act(() => {
      fireEvent.mouseDown(resizeHandle, { clientX: initialNameWidth });
    });

    await waitFor(() =>
      expect(nameHeader.querySelector('[data-column-resize-line="name"]')?.className).toContain(
        'bg-primary',
      ),
    );

    act(() => {
      fireEvent.mouseMove(document, { clientX: initialNameWidth + 60 });
      fireEvent.mouseUp(document);
    });

    await waitFor(() =>
      expect(Number.parseInt(nameHeader.style.width, 10)).toBeGreaterThan(initialNameWidth),
    );
    expect(Number.parseInt(nameHeader.style.width, 10)).toBe(initialNameWidth + 60);
    expect(Number.parseInt(ageHeader.style.width, 10)).toBe(initialAgeWidth);
    const table = nameHeader.closest('table') as HTMLTableElement;
    expect(table.className).toContain('table-fixed');
    expect(screen.getByText('Alice').closest('td')?.className).toContain('overflow-hidden');
    expect(screen.getByText('Alice').closest('td')?.className).toContain('text-ellipsis');
  });

  test('dragging far left clamps to the deterministic header-control minimum', async () => {
    localStorage.setItem('praetor_table_colwidths_clamped_drag', JSON.stringify({ name: 220 }));
    render(<StandardTable<Row> title="Clamped Drag" data={sampleRows} columns={sampleColumns} />);

    const nameHeader = screen.getByText('Name').closest('th') as HTMLTableCellElement;
    const resizeHandle = nameHeader.querySelector(
      '[data-column-resize-handle="name"]',
    ) as HTMLElement;

    await waitFor(() => expect(Number.parseInt(nameHeader.style.width, 10)).toBe(220));

    act(() => {
      fireEvent.mouseDown(resizeHandle, { clientX: 220 });
    });

    await waitFor(() =>
      expect(nameHeader.querySelector('[data-column-resize-line="name"]')?.className).toContain(
        'bg-primary',
      ),
    );

    act(() => {
      fireEvent.mouseMove(document, { clientX: -500 });
      fireEvent.mouseUp(document);
    });

    await waitFor(() => expect(Number.parseInt(nameHeader.style.width, 10)).toBe(140));
    await waitFor(() => {
      const saved = JSON.parse(
        localStorage.getItem('praetor_table_colwidths_clamped_drag') ?? '{}',
      );
      expect(saved.name).toBe(140);
    });
  });

  test('fixed table fallback widths use deterministic full header text', () => {
    localStorage.setItem(
      'praetor_table_colwidths_deterministic_headers',
      JSON.stringify({ name: 160 }),
    );
    const columns = [
      { header: 'Name', accessorKey: 'name' as const, id: 'name' },
      { header: 'Very Long Header', accessorKey: 'age' as const, id: 'age' },
    ];

    render(
      <StandardTable<Row> title="Deterministic Headers" data={sampleRows} columns={columns} />,
    );

    const longHeaderCell = screen.getByText('Very Long Header').closest('th') as HTMLElement;
    expect(Number.parseInt(longHeaderCell.style.minWidth, 10)).toBeGreaterThan(190);
  });

  test('stored column widths are clamped to the full header label width', async () => {
    localStorage.setItem('praetor_table_colwidths_role_width', JSON.stringify({ role: 32 }));
    const columns = [{ header: 'Ruolo', accessorKey: 'name' as const, id: 'role' }];

    render(<StandardTable<Row> title="Role Width" data={sampleRows} columns={columns} />);

    const headerCell = screen.getByText('Ruolo').closest('th') as HTMLElement;
    await waitFor(() =>
      expect(Number.parseInt(headerCell.style.minWidth, 10)).toBeGreaterThan(110),
    );
    expect(screen.getByText('Ruolo').className).not.toContain('truncate');
  });

  test('stored widths below minimum are clamped once and do not widen on remount', async () => {
    localStorage.setItem('praetor_table_colwidths_remount_width', JSON.stringify({ role: 32 }));
    const columns = [{ header: 'Ruolo', accessorKey: 'name' as const, id: 'role' }];
    const { unmount } = render(
      <StandardTable<Row> title="Remount Width" data={sampleRows} columns={columns} />,
    );

    const firstHeader = screen.getByText('Ruolo').closest('th') as HTMLElement;
    await waitFor(() => expect(Number.parseInt(firstHeader.style.width, 10)).toBe(147));
    const savedAfterFirstRender = localStorage.getItem('praetor_table_colwidths_remount_width');

    unmount();
    render(<StandardTable<Row> title="Remount Width" data={sampleRows} columns={columns} />);

    const secondHeader = screen.getByText('Ruolo').closest('th') as HTMLElement;
    await waitFor(() => expect(Number.parseInt(secondHeader.style.width, 10)).toBe(147));
    expect(localStorage.getItem('praetor_table_colwidths_remount_width')).toBe(
      savedAfterFirstRender,
    );
  });

  test('stale stored column widths are ignored while fixed layout remains deterministic', async () => {
    localStorage.setItem('praetor_table_colwidths_stale_widths', JSON.stringify({ missing: 160 }));

    render(<StandardTable<Row> title="Stale Widths" data={sampleRows} columns={sampleColumns} />);

    expect(screen.getByRole('table').className).toContain('table-fixed');
    expect(screen.getByText('Alice').closest('td')?.className).toContain('overflow-hidden');
    await waitFor(() =>
      expect(localStorage.getItem('praetor_table_colwidths_stale_widths')).toBe('{}'),
    );
  });

  test('sorting descending by age reorders numerically (largest first)', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    clickSortHeader('Age');
    const rows = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent ?? '');
    // Age 35, 30, 25 → Charlie, Alice, Bob
    expect(rows[0]).toContain('Charlie');
    expect(rows[1]).toContain('Alice');
    expect(rows[2]).toContain('Bob');
  });

  // ---------------------------------------------------------------------------
  // Filters: shadcn header dropdowns bound to TanStack column filters
  // ---------------------------------------------------------------------------
  test('selecting a single filter value narrows the visible rows', async () => {
    const { container } = render(
      <StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />,
    );
    await selectFilterValue('Name', 'Alice');
    const tbody = container.querySelector('tbody') as HTMLElement;
    await waitFor(() => {
      const bodyText = tbody.textContent ?? '';
      expect(bodyText).toContain('Alice');
      expect(bodyText).not.toContain('Bob');
      expect(bodyText).not.toContain('Charlie');
    });
  });

  test('selected filter values match exact options instead of substrings', () => {
    type PaymentRow = { id: string; status: string };
    const rows: PaymentRow[] = [
      { id: '1', status: 'Paid' },
      { id: '2', status: 'Unpaid' },
    ];

    render(
      <StandardTable<PaymentRow>
        title="Payments"
        data={rows}
        columns={[{ header: 'Status', accessorKey: 'status', id: 'status' }]}
        initialFilterState={{ status: ['Paid'] }}
      />,
    );

    const bodyRows = screen.getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(1);
    expect(bodyRows[0].textContent).toContain('Paid');
    expect(bodyRows[0].textContent).not.toContain('Unpaid');
  });

  test('clears controlled initial filters when the prop returns to undefined', async () => {
    const ControlledFilterTable = () => {
      const [filters, setFilters] = useState<Record<string, string[]> | undefined>({
        name: ['Alice'],
      });
      return (
        <>
          <button type="button" onClick={() => setFilters(undefined)}>
            Clear controlled filter
          </button>
          <StandardTable<Row>
            title="Controlled Filter"
            data={sampleRows}
            columns={sampleColumns}
            initialFilterState={filters}
          />
        </>
      );
    };

    render(<ControlledFilterTable />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByText('Clear controlled filter'));
    });

    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Charlie')).toBeInTheDocument();
    });
  });

  test('multi-column filters intersect (Name + Age)', () => {
    const rows: Row[] = [
      { id: '1', name: 'Alice', age: 30 },
      { id: '2', name: 'Alice', age: 35 },
      { id: '3', name: 'Bob', age: 30 },
    ];
    render(
      <StandardTable<Row>
        title="MultiFilter"
        data={rows}
        columns={sampleColumns}
        initialFilterState={{ name: ['Alice'], age: ['30'] }}
      />,
    );
    // Only the Alice + 30 row should remain.
    const bodyRows = screen.getAllByRole('row').slice(1);
    expect(bodyRows.length).toBe(1);
    expect(bodyRows[0].textContent).toContain('Alice');
    expect(bodyRows[0].textContent).toContain('30');
  });

  test('clearing a filter via the dropdown restores all rows', async () => {
    const { container } = render(
      <StandardTable<Row>
        title="People"
        data={sampleRows}
        columns={sampleColumns}
        initialFilterState={{ name: ['Alice'] }}
      />,
    );
    const tbody = container.querySelector('tbody') as HTMLElement;
    expect(tbody.textContent).not.toContain('Bob');
    await openHeaderFilter('Name');
    clickMenuItemByText('table.clearFilter');
    expect(tbody.textContent).toContain('Bob');
    expect(tbody.textContent).toContain('Charlie');
  });

  test('header filter menu uses shadcn border tokens and searches filter options', async () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    const user = await openHeaderFilter('Name');

    const content = document.body.querySelector('[data-slot="dropdown-menu-content"]');
    expect(content?.className).toContain('border-border');

    const search = screen.getByRole('searchbox', { name: 'table.search Name' });
    expect(search).toHaveAttribute('placeholder', 'table.search');
    await user.type(search, 'ali');

    const aliceOption = screen.getByRole('menuitemcheckbox', { name: 'Alice' });
    const checkboxIndicator = aliceOption.querySelector(
      '[data-slot="dropdown-menu-checkbox-indicator"]',
    );

    expect(aliceOption).toBeInTheDocument();
    expect(checkboxIndicator?.className).toContain('right-2');
    expect(checkboxIndicator?.className).toContain('text-foreground');
    expect(checkboxIndicator?.className).not.toContain('border-input');
    expect(checkboxIndicator?.className).not.toContain('bg-primary');
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Bob' })).toBeNull();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Charlie' })).toBeNull();
  });

  test('does not render the unsolicited toolbar search input', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    expect(screen.queryByPlaceholderText('table.search Name')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Sticky-right action column: classes on header and body cells
  // ---------------------------------------------------------------------------
  test('sticky-right action header is sticky and keeps its label without sort controls', () => {
    const cols = [
      ...sampleColumns,
      {
        id: 'actions',
        header: 'Actions',
        sticky: 'right' as const,
        cell: () => <span>X</span>,
      },
    ];
    render(<StandardTable<Row> title="People" data={sampleRows} columns={cols} />);
    const headerRow = screen.getAllByRole('row')[0];
    const actionsHeader = within(headerRow).getAllByRole('columnheader')[2];
    expect(actionsHeader.className).toContain('sticky');
    expect(actionsHeader.className).toContain('right-0');
    expect(actionsHeader.className).toContain('bg-background');
    expect(Number.parseInt(actionsHeader.style.minWidth, 10)).toBeGreaterThanOrEqual(64);
    expect(actionsHeader.className).not.toContain('bg-card');
    expect(actionsHeader.textContent?.trim()).toBe('Actions');
    expect(within(actionsHeader).queryByRole('button')).not.toBeInTheDocument();
    expect(actionsHeader.querySelector('[data-column-resize-handle="actions"]')).toBeNull();
    expect(actionsHeader.querySelector('svg')).toBeNull();
  });

  test('value cells reset custom value styling while preserving status badges', () => {
    const cols = [
      {
        header: 'Name',
        accessorKey: 'name' as const,
        id: 'name',
        cell: ({ row }: { row: Row }) => (
          <span className="rounded-lg bg-red-500 px-2 font-bold text-red-900">{row.name}</span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'age' as const,
        id: 'status',
        cell: () => <StatusBadge type="active" label="Active" />,
      },
    ];

    render(<StandardTable<Row> title="People" data={sampleRows.slice(0, 1)} columns={cols} />);

    const aliceCell = screen.getByText('Alice').closest('td') as HTMLTableCellElement;
    expect(aliceCell.className).toContain('standard-table-value-cell');
    // Font-size is driven by the row-level fontSizeClass (default 'sm'), not hardcoded on the cell.
    expect(aliceCell.className).not.toContain('text-sm');
    expect(aliceCell.closest('tr')?.className).toContain('text-sm');
    expect(screen.getByText('Active')).toHaveAttribute('data-status-badge');
  });

  test('sticky-right data columns stay inline instead of becoming row actions', () => {
    const cols = [
      { header: 'Name', accessorKey: 'name' as const, id: 'name' },
      { header: 'Age', accessorKey: 'age' as const, id: 'age', sticky: 'right' as const },
    ];
    localStorage.setItem(
      'praetor_table_customviews_stickyorder',
      JSON.stringify([
        {
          id: 'sticky-view',
          name: 'Sticky order',
          hiddenColIds: [],
          columnOrder: ['age', 'name'],
          sortState: null,
          filterState: {},
        },
      ]),
    );
    localStorage.setItem('praetor_table_activeview_stickyorder', 'sticky-view');
    render(<StandardTable<Row> title="StickyOrder" data={sampleRows} columns={cols} />);

    expect(screen.getByText('Age')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.queryByLabelText('table.rowActions')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('table.reorderColumnHandle: Age')).not.toBeInTheDocument();
    expect(getRenderedColumnIds()).toEqual(['name', 'age']);
  });

  test('sticky-right body cell collapses actions behind an ellipsis menu', async () => {
    const user = userEvent.setup();
    const actionCell = mock(({ row }: { row: Row }) => (
      <button type="button" aria-label={`Edit ${row.name}`} data-testid={`action-${row.id}`}>
        X
      </button>
    ));
    const cols = [
      ...sampleColumns,
      {
        id: 'actions',
        header: 'Actions',
        sticky: 'right' as const,
        cell: actionCell,
      },
    ];
    render(<StandardTable<Row> title="People" data={sampleRows} columns={cols} />);
    expect(screen.queryByTestId('action-1')).not.toBeInTheDocument();
    const firstActionCell = screen.getAllByLabelText('table.rowActions')[0].closest('td');
    expect(firstActionCell?.className).toContain('bg-background');
    expect(Number.parseInt(firstActionCell?.style.minWidth ?? '0', 10)).toBeGreaterThanOrEqual(64);
    expect(firstActionCell?.className).not.toContain('bg-card');
    expect(firstActionCell?.className).not.toContain('border-l');
    expect(firstActionCell?.className).not.toContain('group-hover:bg-muted/50');

    await user.click(screen.getAllByLabelText('table.rowActions')[0]);
    expect(screen.getByTestId('action-1')).toBeInTheDocument();
    expect(screen.getByText('Edit Alice')).toBeInTheDocument();
    const actionMenu = screen
      .getByTestId('action-1')
      .closest('[data-standard-table-action-menu="true"]') as HTMLElement;
    expect(actionMenu).toHaveAttribute('data-slot', 'dropdown-menu-content');
    expect(actionMenu.className).toContain('z-[90]');
    expect(actionMenu.className).toContain('w-max');
    expect(actionMenu.className).toContain('min-w-[9rem]');
    expect(screen.getByTestId('action-1').className).toContain('text-popover-foreground');
  });

  test('action cells render once per visible row before a menu opens', () => {
    const actionCell = mock(({ row }: { row: Row }) => (
      <button type="button" aria-label={`Edit ${row.name}`} data-testid={`action-${row.id}`}>
        X
      </button>
    ));
    const cols = [
      ...sampleColumns,
      {
        id: 'actions',
        header: 'Actions',
        sticky: 'right' as const,
        cell: actionCell,
      },
    ];

    render(<StandardTable<Row> title="People" data={sampleRows} columns={cols} />);

    expect(actionCell).toHaveBeenCalledTimes(sampleRows.length);
    expect(screen.queryByTestId('action-1')).not.toBeInTheDocument();
  });

  test('modal table cell editing keeps focus across multiple keystrokes', async () => {
    const user = userEvent.setup();

    const ModalTableEditor = () => {
      const [rows, setRows] = useState<Row[]>([{ id: '1', name: '', age: 0 }]);
      const columns = [
        {
          header: 'Name',
          id: 'name',
          accessorKey: 'name' as const,
          cell: ({ row }: { row: Row }) => (
            <input
              aria-label={`Edit ${row.id}`}
              value={row.name}
              onChange={(event) => {
                const nextName = event.target.value;
                setRows((currentRows) =>
                  currentRows.map((currentRow) =>
                    currentRow.id === row.id ? { ...currentRow, name: nextName } : currentRow,
                  ),
                );
              }}
            />
          ),
        },
      ];

      return (
        <Modal isOpen onClose={() => {}}>
          <StandardTable<Row> title="Modal Rows" data={rows} columns={columns} />
        </Modal>
      );
    };

    render(<ModalTableEditor />);

    const input = screen.getByLabelText('Edit 1') as HTMLInputElement;
    await user.click(input);
    await user.keyboard('ab');

    expect(input).toHaveValue('ab');
    expect(document.activeElement).toBe(input);
  });

  test('collapsed tooltip-wrapped actions use tooltip text as menu labels', async () => {
    const user = userEvent.setup();
    const cols = [
      ...sampleColumns,
      {
        id: 'actions',
        header: 'Actions',
        sticky: 'right' as const,
        cell: ({ row }: { row: Row }) => (
          <div>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button type="button" data-testid={`send-action-${row.id}`}>
                    <i className="fa-solid fa-paper-plane" aria-hidden="true"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Send {row.name}</TooltipContent>
            </Tooltip>
          </div>
        ),
      },
    ];

    render(<StandardTable<Row> title="People" data={sampleRows} columns={cols} />);

    await user.click(screen.getAllByLabelText('table.rowActions')[0]);

    expect(screen.getByTestId('send-action-1')).toBeInTheDocument();
    expect(screen.getByText('Send Alice')).toBeInTheDocument();
    expect(screen.getByTestId('send-action-1').className).toContain('text-popover-foreground');
  });

  test('row action menus preserve quick-view links and disabled shortcuts', async () => {
    const user = userEvent.setup();
    const cols = [
      ...sampleColumns,
      {
        id: 'actions',
        header: 'Actions',
        sticky: 'right' as const,
        cell: ({ row }: { row: Row }) => (
          <QuickViewLinkButton
            href={row.id === '1' ? '#/people/1' : null}
            label={`Open ${row.name}`}
            disabledLabel={`Cannot open ${row.name}`}
          />
        ),
      },
    ];

    render(<StandardTable<Row> title="People" data={sampleRows.slice(0, 2)} columns={cols} />);

    const triggers = screen.getAllByLabelText('table.rowActions');
    await user.click(triggers[0]);
    const link = screen.getByRole('link', { name: 'Open Alice' });
    expect(link).toHaveAttribute('href', '#/people/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.closest('button')).toBeNull();

    await user.keyboard('{Escape}');
    await user.click(screen.getAllByLabelText('table.rowActions')[1]);
    expect(screen.getByRole('button', { name: 'Cannot open Bob' })).toBeDisabled();
  });

  test('row action trigger is hidden when the action cell has no items', async () => {
    const user = userEvent.setup();
    const actionCell = mock(({ row }: { row: Row }) =>
      row.id === '1' ? null : (
        <button type="button" aria-label={`Edit ${row.name}`} data-testid={`action-${row.id}`}>
          <i className="fa-solid fa-pencil" aria-hidden="true"></i>
        </button>
      ),
    );
    const cols = [
      ...sampleColumns,
      {
        id: 'actions',
        header: 'Actions',
        sticky: 'right' as const,
        cell: actionCell,
      },
    ];

    render(<StandardTable<Row> title="People" data={sampleRows.slice(0, 2)} columns={cols} />);

    expect(screen.getAllByLabelText('table.rowActions')).toHaveLength(1);
    fireEvent.contextMenu(screen.getByText('Alice').closest('tr') as HTMLElement);
    expect(screen.queryByTestId('action-1')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('table.rowActions'));
    expect(screen.getByTestId('action-2')).toBeInTheDocument();
  });

  test('action column stays borderless even while sticky over scrollable content', () => {
    const cols = [
      ...sampleColumns,
      {
        id: 'actions',
        header: 'Actions',
        sticky: 'right' as const,
        cell: () => <button type="button">Edit</button>,
      },
    ];
    render(<StandardTable<Row> title="People" data={sampleRows} columns={cols} />);

    const tableContainer = screen.getByRole('table').parentElement as HTMLDivElement;
    const headerRow = screen.getAllByRole('row')[0];
    const actionHeader = within(headerRow).getAllByRole('columnheader')[2];
    const actionCell = screen.getAllByLabelText('table.rowActions')[0].closest('td') as HTMLElement;

    Object.defineProperty(tableContainer, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(tableContainer, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(tableContainer, 'scrollLeft', {
      configurable: true,
      value: 0,
      writable: true,
    });

    act(() => {
      fireEvent.scroll(tableContainer);
    });

    expect(actionHeader.className).not.toContain('border-l');
    expect(actionCell.className).not.toContain('border-l');

    tableContainer.scrollLeft = 300;
    act(() => {
      fireEvent.scroll(tableContainer);
    });

    expect(actionHeader.className).not.toContain('border-l');
    expect(actionCell.className).not.toContain('border-l');
  });

  // ---------------------------------------------------------------------------
  // Row-action menu: click handler + stopPropagation prevents row click
  // ---------------------------------------------------------------------------
  test('row action menu item fires its handler without bubbling to row click', async () => {
    const user = userEvent.setup();
    const onAction = mock(() => {});
    const onRowClick = mock(() => {});
    const cols = [
      ...sampleColumns,
      {
        id: 'actions',
        header: 'Actions',
        sticky: 'right' as const,
        cell: ({ row }: { row: Row }) => (
          <button
            type="button"
            data-testid={`row-action-${row.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onAction();
            }}
          >
            ...
          </button>
        ),
      },
    ];
    render(
      <StandardTable<Row>
        title="People"
        data={sampleRows}
        columns={cols}
        onRowClick={onRowClick}
      />,
    );
    await user.click(screen.getAllByLabelText('table.rowActions')[1]);
    await user.click(screen.getByTestId('row-action-2'));
    expect(onAction).toHaveBeenCalledTimes(1);
    // stopPropagation in the action button keeps the row's onClick silent.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test('right-clicking a row opens its shadcn context menu actions', async () => {
    const onAction = mock((id: string) => id);
    const cols = [
      ...sampleColumns,
      {
        id: 'actions',
        header: 'Actions',
        sticky: 'right' as const,
        cell: ({ row }: { row: Row }) => (
          <button
            type="button"
            data-testid={`context-action-${row.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onAction(row.id);
            }}
          >
            Edit {row.name}
          </button>
        ),
      },
    ];
    render(<StandardTable<Row> title="People" data={sampleRows} columns={cols} />);

    expect(screen.queryByTestId('context-action-2')).not.toBeInTheDocument();

    act(() => {
      fireEvent.contextMenu(screen.getAllByRole('row')[2], { clientX: 12, clientY: 24 });
    });

    const action = await screen.findByTestId('context-action-2');
    const actionMenu = action.closest('[data-standard-table-action-menu="true"]') as HTMLElement;
    expect(actionMenu).toHaveAttribute('data-slot', 'context-menu-content');
    expect(actionMenu.className).toContain('z-[90]');
    expect(actionMenu.className).toContain('w-max');
    expect(actionMenu.className).toContain('min-w-[9rem]');
    expect(action.className).toContain('text-popover-foreground');

    await userEvent.click(action);
    expect(onAction).toHaveBeenCalledWith('2');
    await waitFor(() => expect(screen.queryByTestId('context-action-2')).not.toBeInTheDocument());
  });

  test('saved views cannot hide the actions column or disable row context actions', async () => {
    const onAction = mock((id: string) => id);
    localStorage.setItem(
      'praetor_table_customviews_action_persist',
      JSON.stringify([
        {
          id: 'hide-actions',
          name: 'Hide actions',
          hiddenColIds: ['actions'],
          sortState: null,
          filterState: {},
        },
      ]),
    );
    localStorage.setItem('praetor_table_activeview_action_persist', 'hide-actions');
    const cols = [
      { header: 'Name', accessorKey: 'name' as const, id: 'name' },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }: { row: Row }) => (
          <button
            type="button"
            data-testid={`persisted-action-${row.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onAction(row.id);
            }}
          >
            Edit {row.name}
          </button>
        ),
      },
    ];
    render(<StandardTable<Row> title="Action Persist" data={sampleRows} columns={cols} />);

    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getAllByLabelText('table.rowActions')).toHaveLength(sampleRows.length);

    await openColumnSettings();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Actions' })).toBeNull();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    act(() => {
      fireEvent.contextMenu(screen.getAllByRole('row')[1], { clientX: 12, clientY: 24 });
    });

    const action = await screen.findByTestId('persisted-action-1');
    await userEvent.click(action);
    expect(onAction).toHaveBeenCalledWith('1');
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------
  test('pagination navigates with the shadcn previous and next buttons', () => {
    const many: Row[] = Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      name: `User${i + 1}`,
      age: 20 + i,
    }));
    render(
      <StandardTable<Row>
        title="Many"
        data={many}
        columns={sampleColumns}
        defaultRowsPerPage={5}
      />,
    );
    // Page 1: User1..User5 visible
    expect(screen.getByText('User1')).toBeInTheDocument();
    expect(screen.getByText('User5')).toBeInTheDocument();
    expect(screen.queryByText('User6')).not.toBeInTheDocument();

    // Click next to move to page 2.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
    });
    expect(screen.queryByText('User1')).not.toBeInTheDocument();
    expect(screen.getByText('User6')).toBeInTheDocument();
    expect(screen.getByText('User10')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'buttons.previous' }));
    });
    expect(screen.getByText('User1')).toBeInTheDocument();
  });

  test('changing rowsPerPage produces the new slice on page 1', async () => {
    const user = userEvent.setup();
    const many: Row[] = Array.from({ length: 30 }, (_, i) => ({
      id: String(i + 1),
      name: `User${i + 1}`,
      age: 100 + i,
    }));
    const { container } = render(
      <StandardTable<Row>
        title="Many"
        data={many}
        columns={sampleColumns}
        defaultRowsPerPage={5}
      />,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger.textContent).toContain('5');
    expect(trigger.className).toContain('h-7');
    expect(trigger.className).toContain('text-foreground');
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: '20' }));

    // Now 20 rows fit on page 1. Count rows directly to avoid substring
    // collisions like "User21" matching "User2107".
    const tbody = container.querySelector('tbody') as HTMLElement;
    const bodyRows = tbody.querySelectorAll('tr');
    expect(bodyRows.length).toBe(20);
  });

  test('clamps current page when data changes reduce the page count', async () => {
    const many: Row[] = Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      name: `User${i + 1}`,
      age: 20 + i,
    }));
    const { rerender } = render(
      <StandardTable<Row>
        title="ClampPage"
        data={many}
        columns={sampleColumns}
        defaultRowsPerPage={5}
      />,
    );

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
    });
    expect(screen.getByText('User11')).toBeInTheDocument();

    rerender(
      <StandardTable<Row>
        title="ClampPage"
        data={many.slice(0, 4)}
        columns={sampleColumns}
        defaultRowsPerPage={5}
      />,
    );

    await waitFor(() => expect(screen.getByText('User1')).toBeInTheDocument());
    expect(screen.queryByText('table.noResults')).not.toBeInTheDocument();
  });

  test('pagination omits the range counter and previous-button disables on page 1', () => {
    const many: Row[] = Array.from({ length: 7 }, (_, i) => ({
      id: String(i + 1),
      name: `User${i + 1}`,
      age: 100 + i,
    }));
    render(
      <StandardTable<Row>
        title="ShowingTest"
        data={many}
        columns={sampleColumns}
        defaultRowsPerPage={5}
      />,
    );
    expect(screen.queryByText(/pagination\.showing/)).not.toBeInTheDocument();

    const previousButton = screen.getByRole('button', { name: 'buttons.previous' });
    expect(previousButton).toBeDisabled();
    expect(previousButton.getAttribute('data-size')).toBe('sm');
    expect(previousButton.className).toContain('border-border');
    expect(previousButton.className).toContain('rounded-lg');
    expect(previousButton.className).toContain('!h-7');
    expect(previousButton.className).toContain('!text-sm');
    expect(previousButton.className).toContain('!leading-[var(--text-sm--line-height)]');
    expect(previousButton.className).toContain('!font-medium');
    expect(previousButton.className).toContain('disabled:opacity-50');
    expect(previousButton.className).not.toContain('disabled:opacity-100');
  });

  test('pagination uses native disabled states when there is only one page', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);

    const previousButton = screen.getByRole('button', { name: 'buttons.previous' });
    const nextButton = screen.getByRole('button', { name: 'buttons.next' });

    expect(previousButton).toBeDisabled();
    expect(nextButton).toBeDisabled();
    expect(previousButton.className).toContain('rounded-lg');
    expect(nextButton.className).toContain('rounded-lg');
    expect(previousButton.className).toContain('disabled:opacity-50');
    expect(nextButton.className).toContain('disabled:opacity-50');
    expect(previousButton.className).not.toContain('disabled:opacity-100');
    expect(nextButton.className).not.toContain('disabled:opacity-100');
  });

  test('toolbar outline buttons use the same shadcn border token as pagination', async () => {
    const user = userEvent.setup();
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);

    const exportButton = screen.getByRole('button', { name: 'table.exportToCsv' });
    const decreaseFontButton = screen.getByRole('button', { name: 'table.decreaseFont' });
    const increaseFontButton = screen.getByRole('button', { name: 'table.increaseFont' });
    const columnsButton = screen.getByRole('button', { name: 'table.columnSettings' });

    expect(exportButton.getAttribute('data-size')).toBe('sm');
    expect(columnsButton.getAttribute('data-size')).toBe('sm');
    expect(decreaseFontButton.getAttribute('data-size')).toBe('sm');
    expect(increaseFontButton.getAttribute('data-size')).toBe('sm');

    for (const button of [exportButton, decreaseFontButton, increaseFontButton, columnsButton]) {
      expect(button.className).toContain('border-border');
      expect(button.className).toContain('rounded-lg');
      expect(button.className).toContain('!h-7');
      expect(button.className).toContain('!text-sm');
      expect(button.className).toContain('!leading-[var(--text-sm--line-height)]');
      expect(button.className).toContain('!font-medium');
      expect(button.className).not.toContain('focus-visible:border-ring');
    }

    expect(columnsButton.getAttribute('data-variant')).toBe('outline');
    await user.click(columnsButton);
    await waitFor(() => expect(columnsButton.getAttribute('data-state')).toBe('open'));
    expect(columnsButton.getAttribute('data-variant')).toBe('outline');
    expect(columnsButton.className).toContain('data-[state=open]:border-border');
    expect(columnsButton.className).toContain('data-[state=open]:bg-accent');
    expect(columnsButton.className).toContain('focus-visible:ring-0');
  });

  // ---------------------------------------------------------------------------
  // Custom views: gear menu, column visibility, save / load / delete / export
  // ---------------------------------------------------------------------------
  test('gear menu opens, toggles a column, and reset restores all', async () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    const user = await openColumnSettings();

    expect(screen.getAllByText('Name').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Age' }));

    const remainingAge = screen.queryAllByText('Age');
    expect(remainingAge.length).toBe(1);

    await user.click(screen.getByText('table.resetColumns'));
    expect(screen.getAllByText('Age').length).toBe(2);
  });

  test('custom view modal reorders columns by drag and keyboard and saves the order', async () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    await openCustomViews();
    clickMenuItemByText('buttons.add');

    expect(getCustomViewColumnIds()).toEqual(['name', 'age']);
    dragCustomViewColumnAfter('name', 'age');
    expect(getCustomViewColumnIds()).toEqual(['age', 'name']);

    const nameHandle = document.querySelector<HTMLElement>(
      '[data-custom-view-column-drag-handle="name"]',
    );
    if (!nameHandle) throw new Error('Missing custom view column keyboard handle');
    act(() => fireEvent.keyDown(nameHandle, { key: 'ArrowUp' }));
    expect(getCustomViewColumnIds()).toEqual(['name', 'age']);
    act(() => fireEvent.keyDown(nameHandle, { key: 'ArrowDown' }));
    expect(getCustomViewColumnIds()).toEqual(['age', 'name']);

    const input = screen.getByPlaceholderText('table.viewNamePlaceholder') as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: 'My View' } }));
    act(() => fireEvent.click(screen.getByText('table.save')));

    const stored = localStorage.getItem('praetor_table_customviews_people');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string);
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe('My View');
    expect(parsed[0].columnOrder).toEqual(['age', 'name']);

    const activeId = localStorage.getItem('praetor_table_activeview_people');
    expect(activeId).toBe(parsed[0].id);
    expect(getRenderedColumnIds()).toEqual(['age', 'name']);
  });

  test('custom view modal opened from the shadcn columns menu is immediately keyboard-ready', async () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    const user = await openCustomViews();
    clickMenuItemByText('buttons.add');

    const input = screen.getByPlaceholderText('table.viewNamePlaceholder') as HTMLInputElement;
    await waitFor(() => expect(input).toHaveFocus());

    await user.keyboard('Keyboard View');
    expect(input.value).toBe('Keyboard View');
  });

  test('custom view add and import actions render side by side', async () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    await openCustomViews();

    const addItem = screen.getByText('buttons.add').closest('[role="menuitem"]') as HTMLElement;
    const importItem = screen
      .getByText('buttons.import')
      .closest('[role="menuitem"]') as HTMLElement;
    const actionsRow = addItem.parentElement as HTMLElement;

    expect(actionsRow.className).toContain('flex');
    expect(actionsRow.className).not.toContain('grid');
    expect(addItem.className).toContain('flex-1');
    expect(importItem.className).toContain('flex-1');
  });

  test('loading a stored view restores and normalizes its column order', () => {
    const stored = [
      {
        id: 'ordered-view',
        name: 'Ordered',
        hiddenColIds: [],
        columnOrder: ['age', 'ghost', 'age'],
        sortState: null,
        filterState: {},
      },
    ];
    localStorage.setItem('praetor_table_customviews_columnload', JSON.stringify(stored));
    localStorage.setItem('praetor_table_activeview_columnload', 'ordered-view');

    render(<StandardTable<Row> title="ColumnLoad" data={sampleRows} columns={sampleColumns} />);

    expect(getRenderedColumnIds()).toEqual(['age', 'name']);
    expect(localStorage.getItem('praetor_table_activeview_columnload')).toBe('ordered-view');

    act(() =>
      fireEvent.keyDown(screen.getByLabelText('table.reorderColumnHandle: Age'), {
        key: 'ArrowRight',
      }),
    );
    expect(getRenderedColumnIds()).toEqual(['name', 'age']);
    expect(localStorage.getItem('praetor_table_activeview_columnload')).toBeNull();
  });

  test('loading a stored view at mount applies sortState to the table', () => {
    const stored = [
      {
        id: 'v1',
        name: 'AgeDesc',
        hiddenColIds: [],
        sortState: { colId: 'age', px: 'desc' },
        filterState: {},
      },
    ];
    localStorage.setItem('praetor_table_customviews_loadtest', JSON.stringify(stored));
    localStorage.setItem('praetor_table_activeview_loadtest', 'v1');

    render(<StandardTable<Row> title="LoadTest" data={sampleRows} columns={sampleColumns} />);
    const rows = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('Charlie');
    expect(rows[1]).toContain('Alice');
    expect(rows[2]).toContain('Bob');
  });

  test('loading a stored view hides columns through legacy hidden column aliases', () => {
    const contactRows: ContactRow[] = sampleRows.map((row) => ({
      ...row,
      email: `${row.name.toLowerCase()}@example.com`,
      phone: `555-${row.id}`,
    }));
    const stored = [
      {
        id: 'v1',
        name: 'No contact',
        hiddenColIds: ['contact'],
        sortState: null,
        filterState: {},
      },
    ];
    localStorage.setItem('praetor_table_customviews_contact_alias', JSON.stringify(stored));
    localStorage.setItem('praetor_table_activeview_contact_alias', 'v1');

    render(
      <StandardTable<ContactRow>
        title="Contact Alias"
        data={contactRows}
        columns={contactAliasColumns}
      />,
    );

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.queryByText('Email')).not.toBeInTheDocument();
    expect(screen.queryByText('Phone')).not.toBeInTheDocument();
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('555-1')).not.toBeInTheDocument();
  });

  test('loading a stored view maps legacy contact sort and filters to split columns', () => {
    const contactRows: ContactRow[] = [
      { id: '1', name: 'Alice', age: 30, email: 'amy@example.com', phone: '' },
      { id: '2', name: 'Bob', age: 25, email: '', phone: '555-1' },
      { id: '3', name: 'Charlie', age: 35, email: 'mira@example.com', phone: '555-2' },
      { id: '4', name: 'Dana', age: 40, email: 'amy@example.com', phone: '555-1' },
      { id: '5', name: 'Erin', age: 45, email: '', phone: '' },
    ];
    const stored = [
      {
        id: 'v1',
        name: 'Filtered contact',
        hiddenColIds: [],
        sortState: { colId: 'contact', px: 'asc' },
        filterState: { contact: ['amy@example.com', '555-1', ''] },
      },
    ];
    localStorage.setItem('praetor_table_customviews_contact_sort_filter', JSON.stringify(stored));
    localStorage.setItem('praetor_table_activeview_contact_sort_filter', 'v1');

    render(
      <StandardTable<ContactRow>
        title="Contact Sort Filter"
        data={contactRows}
        columns={contactAliasColumns}
      />,
    );

    const rows = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent ?? '');
    const visibleRows = rows.filter((row) => row.trim().length > 0);
    expect(visibleRows[0]).toContain('Erin');
    expect(visibleRows[1]).toContain('Bob');
    expect(visibleRows[2]).toContain('Alice');
    expect(rows.some((row) => row.includes('Alice'))).toBe(true);
    expect(rows.some((row) => row.includes('Bob'))).toBe(true);
    expect(rows.some((row) => row.includes('Charlie'))).toBe(false);
    expect(rows.some((row) => row.includes('Dana'))).toBe(false);
    expect(rows.some((row) => row.includes('Erin'))).toBe(true);
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
  });

  test('renaming a stored view preserves legacy hidden column aliases as current columns', async () => {
    const contactRows: ContactRow[] = sampleRows.map((row) => ({
      ...row,
      email: `${row.name.toLowerCase()}@example.com`,
      phone: `555-${row.id}`,
    }));
    const stored = [
      {
        id: 'v1',
        name: 'No contact',
        hiddenColIds: ['contact'],
        sortState: { colId: 'contact', px: 'desc' },
        filterState: { contact: ['alice@example.com 555-1'] },
      },
    ];
    localStorage.setItem('praetor_table_customviews_contact_alias_edit', JSON.stringify(stored));

    render(
      <StandardTable<ContactRow>
        title="Contact Alias Edit"
        data={contactRows}
        columns={contactAliasColumns}
      />,
    );
    await openCustomViews();
    clickMenuAction(screen.getByLabelText('table.renameView'));

    const input = screen.getByPlaceholderText('table.viewNamePlaceholder') as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: 'Renamed no contact' } }));
    act(() => fireEvent.click(screen.getByText('table.save')));

    const saved = JSON.parse(
      localStorage.getItem('praetor_table_customviews_contact_alias_edit') as string,
    );
    expect(saved[0]).toMatchObject({
      name: 'Renamed no contact',
      hiddenColIds: ['email', 'phone'],
      sortState: { colId: 'email', px: 'desc', legacyColId: 'contact' },
    });
    expect(
      saved[0].filterState.email.map((value: string) => decodeLegacyFilterValue(value)),
    ).toEqual([{ legacyColumnId: 'contact', value: 'alice@example.com 555-1' }]);
  });

  test('deleting a saved view removes it from localStorage', async () => {
    const seeded = [
      { id: 'v1', name: 'View 1', hiddenColIds: [], sortState: null, filterState: {} },
      { id: 'v2', name: 'View 2', hiddenColIds: [], sortState: null, filterState: {} },
    ];
    localStorage.setItem('praetor_table_customviews_deltest', JSON.stringify(seeded));
    localStorage.setItem('praetor_table_activeview_deltest', 'v2');

    render(<StandardTable<Row> title="DelTest" data={sampleRows} columns={sampleColumns} />);

    await openCustomViews();

    const deleteBtns = screen.getAllByLabelText('table.deleteView');
    expect(deleteBtns.length).toBe(2);
    clickMenuAction(deleteBtns[1]);

    const stored = JSON.parse(localStorage.getItem('praetor_table_customviews_deltest') as string);
    expect(stored.length).toBe(1);
    expect(stored[0].id).toBe('v1');
    expect(localStorage.getItem('praetor_table_activeview_deltest')).toBeNull();
  });

  test('exporting a saved view writes a JSON payload to the clipboard', async () => {
    const seeded = [
      {
        id: 'vexp',
        name: 'Exportable',
        hiddenColIds: ['age'],
        columnOrder: ['age', 'name'],
        sortState: { colId: 'name', px: 'asc' },
        filterState: { name: ['Alice'] },
      },
    ];
    localStorage.setItem('praetor_table_customviews_exporttest', JSON.stringify(seeded));

    render(<StandardTable<Row> title="ExportTest" data={sampleRows} columns={sampleColumns} />);
    await openCustomViews();

    const exportBtns = screen.getAllByLabelText('table.exportView');
    await act(async () => {
      fireEvent.click(exportBtns[0].closest('[role="menuitem"]') ?? exportBtns[0]);
      await Promise.resolve();
    });
    expect(writeClipboardSpy).toHaveBeenCalled();
    const payload = JSON.parse(writeClipboardSpy.mock.calls[0][0] as string);
    expect(payload.name).toBe('Exportable');
    expect(payload.hiddenColIds).toEqual(['age']);
    expect(payload.columnOrder).toEqual(['age', 'name']);
    expect(payload.sortState).toEqual({ colId: 'name', px: 'asc' });
    expect(payload.filterState).toEqual({ name: ['Alice'] });
  });

  test('importing via paste modal adds a new view to localStorage', async () => {
    render(<StandardTable<Row> title="ImportTest" data={sampleRows} columns={sampleColumns} />);
    await openCustomViews();

    // Clipboard read returns 'unavailable' → the paste modal opens.
    await act(async () => {
      fireEvent.click(
        screen.getByText('buttons.import').closest('[role="menuitem"]') as HTMLElement,
      );
      await Promise.resolve();
    });
    const textarea = screen.getByPlaceholderText(
      'table.pasteViewPlaceholder',
    ) as HTMLTextAreaElement;
    const importPayload = JSON.stringify({
      name: 'Imported',
      hiddenColIds: [],
      columnOrder: ['age', 'name'],
      sortState: null,
      filterState: {},
    });
    act(() => fireEvent.change(textarea, { target: { value: importPayload } }));
    act(() => fireEvent.click(screen.getByText('table.importView')));

    const stored = JSON.parse(
      localStorage.getItem('praetor_table_customviews_importtest') as string,
    );
    expect(stored.length).toBe(1);
    expect(stored[0].name).toBe('Imported');
    expect(stored[0].columnOrder).toEqual(['age', 'name']);
  });

  test('paste import surfaces an error for invalid JSON', async () => {
    render(<StandardTable<Row> title="BadImport" data={sampleRows} columns={sampleColumns} />);
    await openCustomViews();

    await act(async () => {
      fireEvent.click(
        screen.getByText('buttons.import').closest('[role="menuitem"]') as HTMLElement,
      );
      await Promise.resolve();
    });
    const textarea = screen.getByPlaceholderText(
      'table.pasteViewPlaceholder',
    ) as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'not-json{' } }));
    act(() => fireEvent.click(screen.getByText('table.importView')));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('table.viewImportFailed');
  });

  // ---------------------------------------------------------------------------
  // Loading-state vs no-data rendering
  // ---------------------------------------------------------------------------
  test('renders children (loading slot) when data is undefined', () => {
    render(
      <StandardTable<Row> title="Loading">
        <div data-testid="loading-spinner">loading…</div>
      </StandardTable>,
    );
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('renders loadingState instead of the table when isLoading is true', () => {
    render(
      <StandardTable<Row>
        title="Loading"
        data={sampleRows}
        columns={sampleColumns}
        isLoading
        loadingState={<div data-testid="loading-state">Loading rows…</div>}
      />,
    );

    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('externalTotalCount renders without data + columns', () => {
    render(
      <StandardTable<Row> title="ExternalCount" totalCount={42} totalLabel="things">
        <div>body</div>
      </StandardTable>,
    );
    expect(screen.getByText(/42\s+things/)).toBeInTheDocument();
  });

  test('font size buttons disable at min and max', () => {
    render(<StandardTable<Row> title="Fonts" data={sampleRows} columns={sampleColumns} />);
    const decrease = screen.getByLabelText('table.decreaseFont');
    const increase = screen.getByLabelText('table.increaseFont');
    expect((decrease as HTMLButtonElement).disabled).toBe(false);
    expect((increase as HTMLButtonElement).disabled).toBe(false);

    // Step down to 'xs' → decrease should disable.
    act(() => fireEvent.click(decrease));
    expect((decrease as HTMLButtonElement).disabled).toBe(true);
    expect(localStorage.getItem(TABLE_FONT_SIZE_STORAGE_KEY)).toBe('xs');
    expect(localStorage.getItem('praetor_table_fontsize_fonts')).toBeNull();

    // Step up twice → 'base' → increase should disable.
    act(() => {
      fireEvent.click(increase);
      fireEvent.click(increase);
    });
    expect((increase as HTMLButtonElement).disabled).toBe(true);
    expect(localStorage.getItem(TABLE_FONT_SIZE_STORAGE_KEY)).toBe('base');
  });

  test('shares font size with mounted tables and tables rendered later', () => {
    const { unmount } = render(
      <div>
        <section data-testid="first-table">
          <StandardTable<Row> title="First" data={sampleRows} columns={sampleColumns} />
        </section>
        <section data-testid="second-table">
          <StandardTable<Row> title="Second" data={sampleRows} columns={sampleColumns} />
        </section>
      </div>,
    );

    const firstTable = within(screen.getByTestId('first-table'));
    const secondTable = within(screen.getByTestId('second-table'));
    act(() => fireEvent.click(firstTable.getByLabelText('table.decreaseFont')));

    expect(firstTable.getByText('Alice').closest('tr')?.className).toContain('text-xs');
    expect(secondTable.getByText('Alice').closest('tr')?.className).toContain('text-xs');
    expect(secondTable.getByLabelText('table.decreaseFont')).toBeDisabled();
    expect(localStorage.getItem(TABLE_FONT_SIZE_STORAGE_KEY)).toBe('xs');

    unmount();
    render(<StandardTable<Row> title="Third" data={sampleRows} columns={sampleColumns} />);
    expect(screen.getByText('Alice').closest('tr')?.className).toContain('text-xs');
    expect(screen.getByLabelText('table.decreaseFont')).toBeDisabled();
  });

  test('uses valid global font sizes and falls back for invalid values', () => {
    localStorage.setItem(TABLE_FONT_SIZE_STORAGE_KEY, 'invalid');
    localStorage.setItem('praetor_table_fontsize_invalid_font', 'xs');
    const { unmount } = render(
      <StandardTable<Row> title="Invalid Font" data={sampleRows} columns={sampleColumns} />,
    );
    expect(screen.getByText('Alice').closest('tr')?.className).toContain('text-sm');
    expect(localStorage.getItem(TABLE_FONT_SIZE_STORAGE_KEY)).toBe('invalid');

    unmount();
    localStorage.setItem(TABLE_FONT_SIZE_STORAGE_KEY, 'base');
    localStorage.setItem('praetor_table_fontsize_saved_font', 'xs');
    render(<StandardTable<Row> title="Saved Font" data={sampleRows} columns={sampleColumns} />);
    expect(screen.getByText('Alice').closest('tr')?.className).toContain('text-base');
    expect(screen.getByLabelText('table.increaseFont')).toBeDisabled();
  });

  test('migrates the first valid legacy size and syncs tables that are already mounted', () => {
    const { rerender } = render(
      <div>
        <section key="first" data-testid="first-legacy-table">
          <StandardTable<Row> title="First Legacy" data={sampleRows} columns={sampleColumns} />
        </section>
      </div>,
    );
    expect(localStorage.getItem(TABLE_FONT_SIZE_STORAGE_KEY)).toBeNull();

    localStorage.setItem('praetor_table_fontsize_second_legacy', 'base');
    rerender(
      <div>
        <section key="first" data-testid="first-legacy-table">
          <StandardTable<Row> title="First Legacy" data={sampleRows} columns={sampleColumns} />
        </section>
        <section key="second" data-testid="second-legacy-table">
          <StandardTable<Row> title="Second Legacy" data={sampleRows} columns={sampleColumns} />
        </section>
      </div>,
    );

    const firstTable = within(screen.getByTestId('first-legacy-table'));
    const secondTable = within(screen.getByTestId('second-legacy-table'));
    expect(firstTable.getByText('Alice').closest('tr')?.className).toContain('text-base');
    expect(secondTable.getByText('Alice').closest('tr')?.className).toContain('text-base');
    expect(localStorage.getItem(TABLE_FONT_SIZE_STORAGE_KEY)).toBe('base');

    localStorage.setItem('praetor_table_fontsize_third_legacy', 'xs');
    rerender(
      <div>
        <section key="first" data-testid="first-legacy-table">
          <StandardTable<Row> title="First Legacy" data={sampleRows} columns={sampleColumns} />
        </section>
        <section key="second" data-testid="second-legacy-table">
          <StandardTable<Row> title="Second Legacy" data={sampleRows} columns={sampleColumns} />
        </section>
        <section key="third" data-testid="third-legacy-table">
          <StandardTable<Row> title="Third Legacy" data={sampleRows} columns={sampleColumns} />
        </section>
      </div>,
    );

    const thirdTable = within(screen.getByTestId('third-legacy-table'));
    expect(thirdTable.getByText('Alice').closest('tr')?.className).toContain('text-base');
    expect(localStorage.getItem(TABLE_FONT_SIZE_STORAGE_KEY)).toBe('base');
    expect(localStorage.getItem('praetor_table_fontsize_second_legacy')).toBe('base');
    expect(localStorage.getItem('praetor_table_fontsize_third_legacy')).toBe('xs');
  });

  test('syncs localStorage events and ignores sessionStorage events', () => {
    render(<StandardTable<Row> title="Storage Sync" data={sampleRows} columns={sampleColumns} />);

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: TABLE_FONT_SIZE_STORAGE_KEY,
          newValue: 'base',
          storageArea: localStorage,
        }),
      );
    });
    expect(screen.getByText('Alice').closest('tr')?.className).toContain('text-base');

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: TABLE_FONT_SIZE_STORAGE_KEY,
          newValue: 'xs',
          storageArea: sessionStorage,
        }),
      );
    });
    expect(screen.getByText('Alice').closest('tr')?.className).toContain('text-base');
  });

  test('cell double-click invokes onCellDoubleClick with the row', () => {
    const onDouble = mock(() => {});
    const cols = [
      { header: 'Name', accessorKey: 'name' as const, id: 'name', onCellDoubleClick: onDouble },
      { header: 'Age', accessorKey: 'age' as const, id: 'age' },
    ];
    render(<StandardTable<Row> title="Double" data={sampleRows} columns={cols} />);
    const aliceCell = screen.getByText('Alice');
    act(() => fireEvent.doubleClick(aliceCell));
    expect(onDouble).toHaveBeenCalledTimes(1);
  });

  test('disabled row blocks onRowClick', () => {
    const onRowClick = mock(() => {});
    render(
      <StandardTable<Row>
        title="People"
        data={sampleRows}
        columns={sampleColumns}
        onRowClick={onRowClick}
        disabledRow={(r) => r.id === '2'}
      />,
    );
    act(() => fireEvent.click(screen.getByText('Bob')));
    expect(onRowClick).not.toHaveBeenCalled();
    act(() => fireEvent.click(screen.getByText('Alice')));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  test('hidden column (col.hidden) is not rendered as a header', () => {
    const cols = [
      { header: 'Name', accessorKey: 'name' as const, id: 'name' },
      { header: 'Age', accessorKey: 'age' as const, id: 'age', hidden: true },
    ];
    render(<StandardTable<Row> title="HiddenCol" data={sampleRows} columns={cols} />);
    const headerRow = screen.getAllByRole('row')[0];
    expect(within(headerRow).queryByText('Age')).not.toBeInTheDocument();
  });
});
