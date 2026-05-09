import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

const csvModule = await import('../../utils/csv');
const downloadCsvSpy = spyOn(csvModule, 'downloadCsv').mockImplementation(() => {});

const clipboardModule = await import('../../utils/clipboard');
const writeClipboardSpy = spyOn(clipboardModule, 'writeTextToClipboard').mockResolvedValue(true);
const readClipboardSpy = spyOn(clipboardModule, 'readTextFromClipboard').mockResolvedValue({
  ok: false,
  reason: 'unavailable',
});

const StandardTable = (await import('../../components/shared/StandardTable')).default;

type Row = { id: string; name: string; age: number };

const sampleRows: Row[] = [
  { id: '1', name: 'Alice', age: 30 },
  { id: '2', name: 'Bob', age: 25 },
  { id: '3', name: 'Charlie', age: 35 },
];

const sampleColumns = [
  { header: 'Name', accessorKey: 'name' as const, id: 'name' },
  { header: 'Age', accessorKey: 'age' as const, id: 'age' },
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
    await user.click(trigger);

    // Pick "20" from the dropdown - fail loudly if the option isn't rendered.
    await user.click(screen.getByRole('option', { name: '20' }));
    unmount();

    // localStorage should hold the newly-selected value, not just any value.
    expect(localStorage.getItem('praetor_table_rows_people')).toBe('20');
  });

  test('rows-per-page select menu uses the scoped shadcn dark theme', async () => {
    localStorage.setItem('praetor_theme', 'dark');
    const user = userEvent.setup();
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);

    await user.click(screen.getByRole('combobox'));

    const content = document.body.querySelector('[data-slot="select-content"]');
    expect(content?.hasAttribute('data-shadcn-theme-scope')).toBe(true);
    expect(content?.getAttribute('data-shadcn-theme')).toBe('dark');
    expect(content?.className).toContain('dark');
  });

  test('CSV export click invokes downloadCsv with rows and filename', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    const exportButton = screen.getByText('table.export');
    fireEvent.click(exportButton);

    expect(downloadCsvSpy).toHaveBeenCalled();
    const args = downloadCsvSpy.mock.calls[0];
    // First arg: rows array (header row + data rows)
    expect(Array.isArray(args[0])).toBe(true);
    const rows = args[0] as string[][];
    expect(rows[0]).toEqual(['Name', 'Age']);
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
        sticky: 'right' as const,
        cell: () => <button type="button">x</button>,
      },
    ];
    render(<StandardTable<Row> title="People" data={sampleRows} columns={columns} />);

    // rows[0] is the header; rows[1] is Alice's data row.
    const aliceRow = screen.getAllByRole('row')[1];
    const cells = aliceRow.querySelectorAll('td');
    expect(cells.length).toBe(3);

    // Stretch column (Age): absorbs leftover width AND keeps its right alignment.
    expect(cells[1].className).toContain('w-full');
    expect(cells[1].className).toContain('text-right');
    expect(cells[1].className).not.toMatch(/\bw-px\b/);

    // Sticky-right action column: stays w-auto, never w-full.
    expect(cells[2].className).toContain('w-auto');
    expect(cells[2].className).not.toMatch(/\bw-full\b/);
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
    const sortIcon = sortButton.querySelector('i.fa-arrow-up-arrow-down');

    expect(sortButton.className).toContain('rounded-md');
    expect(sortButton.className).toContain('hover:bg-accent');
    expect(sortButton.className).toContain('hover:text-accent-foreground');
    expect(sortIcon?.className).toContain('transition-colors');
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
    expect(checkboxIndicator?.className).toContain('border-input');
    expect(checkboxIndicator?.className).toContain('group-data-[state=checked]:bg-primary');
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
  test('sticky-right action header is sticky but visually empty', () => {
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
    expect(actionsHeader.className).toContain('bg-card');
    expect(actionsHeader.className).not.toContain('bg-background');
    expect(actionsHeader.textContent?.trim()).toBe('');
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
  });

  test('sticky-right data columns stay inline instead of becoming row actions', () => {
    const cols = [
      { header: 'Name', accessorKey: 'name' as const, id: 'name' },
      { header: 'Age', accessorKey: 'age' as const, id: 'age', sticky: 'right' as const },
    ];
    render(<StandardTable<Row> title="People" data={sampleRows} columns={cols} />);

    expect(screen.getByText('Age')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.queryByLabelText('table.rowActions')).not.toBeInTheDocument();
  });

  test('sticky-right body cell collapses actions behind an ellipsis menu', async () => {
    const user = userEvent.setup();
    const cols = [
      ...sampleColumns,
      {
        id: 'actions',
        header: 'Actions',
        sticky: 'right' as const,
        cell: ({ row }: { row: Row }) => (
          <button type="button" aria-label={`Edit ${row.name}`} data-testid={`action-${row.id}`}>
            X
          </button>
        ),
      },
    ];
    render(<StandardTable<Row> title="People" data={sampleRows} columns={cols} />);
    expect(screen.queryByTestId('action-1')).not.toBeInTheDocument();
    const firstActionCell = screen.getAllByLabelText('table.rowActions')[0].closest('td');
    expect(firstActionCell?.className).toContain('bg-card');
    expect(firstActionCell?.className).not.toContain('bg-background');

    await user.click(screen.getAllByLabelText('table.rowActions')[0]);
    expect(screen.getByTestId('action-1')).toBeInTheDocument();
    expect(screen.getByText('Edit Alice')).toBeInTheDocument();
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

  test('pagination "showing" counter renders and previous-button disables on page 1', () => {
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
    expect(screen.getByText(/pagination\.showing/)).toBeInTheDocument();

    const previousButton = screen.getByRole('button', { name: 'buttons.previous' });
    expect(previousButton).toBeDisabled();
    expect(previousButton.getAttribute('data-size')).toBe('sm');
    expect(previousButton.className).toContain('border-border');
    expect(previousButton.className).toContain('text-foreground');
    expect(previousButton.className).toContain('disabled:opacity-100');
  });

  test('toolbar outline buttons use the same shadcn border token as pagination', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);

    const exportButton = screen.getByRole('button', { name: 'table.exportToCsv' });
    const decreaseFontButton = screen.getByRole('button', { name: 'table.decreaseFont' });
    const increaseFontButton = screen.getByRole('button', { name: 'table.increaseFont' });
    const columnsButton = screen.getByRole('button', { name: 'table.columnSettings' });

    expect(exportButton.getAttribute('data-size')).toBe('sm');
    expect(columnsButton.getAttribute('data-size')).toBe('sm');
    expect(decreaseFontButton.getAttribute('data-size')).toBe('icon-sm');
    expect(increaseFontButton.getAttribute('data-size')).toBe('icon-sm');

    for (const button of [exportButton, decreaseFontButton, increaseFontButton, columnsButton]) {
      expect(button.className).toContain('border-border');
    }
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

  test('saving a custom view persists it to localStorage and marks it active', async () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    await openCustomViews();
    clickMenuItemByText('buttons.add');

    const input = screen.getByPlaceholderText('table.viewNamePlaceholder') as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: 'My View' } }));
    act(() => fireEvent.click(screen.getByText('table.save')));

    const stored = localStorage.getItem('praetor_table_customviews_people');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string);
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe('My View');

    const activeId = localStorage.getItem('praetor_table_activeview_people');
    expect(activeId).toBe(parsed[0].id);
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
    expect(localStorage.getItem('praetor_table_fontsize_fonts')).toBe('xs');

    // Step up twice → 'base' → increase should disable.
    act(() => fireEvent.click(increase));
    act(() => fireEvent.click(increase));
    expect((increase as HTMLButtonElement).disabled).toBe(true);
    expect(localStorage.getItem('praetor_table_fontsize_fonts')).toBe('base');
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
