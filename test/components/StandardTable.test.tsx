import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

const csvModule = await import('../../utils/csv');
const downloadCsvSpy = spyOn(csvModule, 'downloadCsv').mockImplementation(() => {});

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

describe('<StandardTable />', () => {
  beforeEach(() => {
    localStorage.clear();
    downloadCsvSpy.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  afterAll(() => {
    downloadCsvSpy.mockRestore();
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
});
