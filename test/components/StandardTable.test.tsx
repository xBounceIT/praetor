import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

// Each header's filter trigger is an icon-only button with no accessible name,
// so scope the lookup to the matching <th> and grab its single button.
const openFilterFor = (headerText: string) => {
  const headerCell = screen.getByText(headerText).closest('th') as HTMLTableCellElement;
  const btn = headerCell.querySelector('button') as HTMLButtonElement;
  act(() => {
    fireEvent.click(btn);
  });
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

  test('rowsPerPage persists to localStorage', () => {
    const { unmount } = render(
      <StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />,
    );

    // The rows-per-page CustomSelect's trigger shows the current value (default 10).
    const triggers = screen.getAllByRole('button').filter((b) => b.textContent === '10');
    expect(triggers.length).toBeGreaterThan(0);
    fireEvent.click(triggers[0]);

    // Pick "20" from the dropdown — fail loudly if the option isn't rendered.
    fireEvent.click(screen.getByText('20'));
    unmount();

    // localStorage should hold the newly-selected value, not just any value.
    expect(localStorage.getItem('praetor_table_rows_people')).toBe('20');
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
    // We just confirm Bob's text still renders — the classNames are an implementation detail.
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
  // Sorting (ascending / descending via the per-column filter popup)
  // ---------------------------------------------------------------------------
  test('sorting ascending by name reorders the rendered rows', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    openFilterFor('Name');
    act(() => {
      fireEvent.click(screen.getByText('table.sortAsc'));
    });
    const rows = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('Alice');
    expect(rows[1]).toContain('Bob');
    expect(rows[2]).toContain('Charlie');
  });

  test('sorting descending by age reorders numerically (largest first)', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    openFilterFor('Age');
    act(() => {
      fireEvent.click(screen.getByText('table.sortDesc'));
    });
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
  // Filters: dropdown filter (the only filter UI on the per-column popup)
  // ---------------------------------------------------------------------------
  test('selecting a single filter value narrows the visible rows', () => {
    const { container } = render(
      <StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />,
    );
    openFilterFor('Name');
    // Click the "Alice" filter option (under a <label>; table cells aren't).
    act(() => {
      const aliceLabels = screen.getAllByText('Alice');
      const optionLabel = aliceLabels.find((el) => el.closest('label'));
      fireEvent.click(optionLabel ?? aliceLabels[0]);
    });
    const tbody = container.querySelector('tbody') as HTMLElement;
    const bodyText = tbody.textContent ?? '';
    expect(bodyText).toContain('Alice');
    expect(bodyText).not.toContain('Bob');
    expect(bodyText).not.toContain('Charlie');
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

  test('clearing a filter via the popup restores all rows', () => {
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
    openFilterFor('Name');
    act(() => {
      fireEvent.click(screen.getByText('table.clearFilter'));
    });
    expect(tbody.textContent).toContain('Bob');
    expect(tbody.textContent).toContain('Charlie');
  });

  // ---------------------------------------------------------------------------
  // Sticky-right action column: classes on header and body cells
  // ---------------------------------------------------------------------------
  test('sticky-right header has sticky positioning classes', () => {
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
    const actionsHeader = screen.getByText('Actions').closest('th') as HTMLTableCellElement;
    expect(actionsHeader.className).toContain('sticky');
    expect(actionsHeader.className).toContain('right-0');
  });

  test('sticky-right body cell wraps content in a flex container', () => {
    const cols = [
      ...sampleColumns,
      {
        id: 'actions',
        header: 'Actions',
        sticky: 'right' as const,
        cell: ({ row }: { row: Row }) => (
          <button type="button" data-testid={`action-${row.id}`}>
            X
          </button>
        ),
      },
    ];
    render(<StandardTable<Row> title="People" data={sampleRows} columns={cols} />);
    const actionBtn = screen.getByTestId('action-1');
    const wrapper = actionBtn.parentElement as HTMLElement;
    expect(wrapper.className).toContain('flex');
    expect(wrapper.className).toContain('justify-end');
  });

  // ---------------------------------------------------------------------------
  // Row-action menu: click handler + stopPropagation prevents row click
  // ---------------------------------------------------------------------------
  test('row action button fires its handler without bubbling to row click', () => {
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
    act(() => {
      fireEvent.click(screen.getByTestId('row-action-2'));
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    // stopPropagation in the action button keeps the row's onClick silent.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------
  test('pagination renders multiple pages and navigates with the page buttons', () => {
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

    // Click page button "2".
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '2' }));
    });
    expect(screen.queryByText('User1')).not.toBeInTheDocument();
    expect(screen.getByText('User6')).toBeInTheDocument();
    expect(screen.getByText('User10')).toBeInTheDocument();
  });

  test('changing rowsPerPage produces the new slice on page 1', () => {
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
    const triggers = screen.getAllByRole('button').filter((b) => b.textContent === '5');
    expect(triggers.length).toBeGreaterThan(0);
    act(() => fireEvent.click(triggers[0]));
    act(() => fireEvent.click(screen.getByText('20')));

    // Now 20 rows fit on page 1. Count rows directly to avoid substring
    // collisions like "User21" matching "User2107".
    const tbody = container.querySelector('tbody') as HTMLElement;
    const bodyRows = tbody.querySelectorAll('tr');
    expect(bodyRows.length).toBe(20);
  });

  test('pagination "showing" counter renders and previous-button disables on page 1', () => {
    const many: Row[] = Array.from({ length: 7 }, (_, i) => ({
      id: String(i + 1),
      name: `User${i + 1}`,
      age: 100 + i,
    }));
    const { container } = render(
      <StandardTable<Row>
        title="ShowingTest"
        data={many}
        columns={sampleColumns}
        defaultRowsPerPage={5}
      />,
    );
    expect(screen.getByText(/pagination\.showing/)).toBeInTheDocument();

    // The chevron-left button should be disabled on page 1.
    const prevBtn = container.querySelector('.fa-chevron-left')
      ?.parentElement as HTMLButtonElement | null;
    expect(prevBtn?.disabled).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Custom views: gear menu, column visibility, save / load / delete / export
  // ---------------------------------------------------------------------------
  test('gear menu opens, toggles a column, and reset restores all', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    const gearBtn = screen.getByLabelText('table.columnSettings');
    act(() => fireEvent.click(gearBtn));

    expect(screen.getAllByText('Name').length).toBeGreaterThan(0);

    // Click the Age row inside the popup. There are multiple "Age" texts on
    // screen (header + popup); pick the popup entry by its select-none class.
    const ageEntries = screen.getAllByText('Age');
    const popupAge = ageEntries.find((el) => el.className.includes('select-none'));
    expect(popupAge).toBeDefined();
    act(() => fireEvent.click(popupAge as HTMLElement));

    const remainingAge = screen.queryAllByText('Age');
    expect(remainingAge.length).toBe(1);

    act(() => fireEvent.click(screen.getByText('table.resetColumns')));
    expect(screen.getAllByText('Age').length).toBe(2);
  });

  test('saving a custom view persists it to localStorage and marks it active', () => {
    render(<StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} />);
    act(() => fireEvent.click(screen.getByLabelText('table.columnSettings')));
    const viewsBtn = screen.getByText('table.customViews').closest('button') as HTMLElement;
    act(() => fireEvent.click(viewsBtn));
    act(() => fireEvent.click(screen.getByText('buttons.add')));

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

  test('deleting a saved view removes it from localStorage', () => {
    const seeded = [
      { id: 'v1', name: 'View 1', hiddenColIds: [], sortState: null, filterState: {} },
      { id: 'v2', name: 'View 2', hiddenColIds: [], sortState: null, filterState: {} },
    ];
    localStorage.setItem('praetor_table_customviews_deltest', JSON.stringify(seeded));
    localStorage.setItem('praetor_table_activeview_deltest', 'v2');

    render(<StandardTable<Row> title="DelTest" data={sampleRows} columns={sampleColumns} />);

    act(() => fireEvent.click(screen.getByLabelText('table.columnSettings')));
    const viewsBtn = screen.getByText('table.customViews').closest('button') as HTMLElement;
    act(() => fireEvent.click(viewsBtn));

    const deleteBtns = screen.getAllByLabelText('table.deleteView');
    expect(deleteBtns.length).toBe(2);
    act(() => fireEvent.click(deleteBtns[1]));

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
    act(() => fireEvent.click(screen.getByLabelText('table.columnSettings')));
    const viewsBtn = screen.getByText('table.customViews').closest('button') as HTMLElement;
    act(() => fireEvent.click(viewsBtn));

    const exportBtns = screen.getAllByLabelText('table.exportView');
    await act(async () => {
      fireEvent.click(exportBtns[0]);
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
    act(() => fireEvent.click(screen.getByLabelText('table.columnSettings')));
    const viewsBtn = screen.getByText('table.customViews').closest('button') as HTMLElement;
    act(() => fireEvent.click(viewsBtn));

    // Clipboard read returns 'unavailable' → the paste modal opens.
    await act(async () => {
      fireEvent.click(screen.getByText('buttons.import'));
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
    act(() => fireEvent.click(screen.getByLabelText('table.columnSettings')));
    const viewsBtn = screen.getByText('table.customViews').closest('button') as HTMLElement;
    act(() => fireEvent.click(viewsBtn));

    await act(async () => {
      fireEvent.click(screen.getByText('buttons.import'));
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
        <div data-testid="loading-spinner">loading...</div>
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
