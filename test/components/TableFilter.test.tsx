import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock();

const TableFilter = (await import('../../components/shared/TableFilter')).default;

const baseProps = {
  title: 'Status',
  options: ['Open', 'Closed', 'Pending'],
  selectedValues: [] as string[],
  onFilterChange: () => {},
  sortDirection: null as 'asc' | 'desc' | null,
  onSortChange: () => {},
  onClose: () => {},
};

describe('<TableFilter />', () => {
  test('renders title, all options, and translated controls', () => {
    render(<TableFilter {...baseProps} />);
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('table.sortAsc')).toBeInTheDocument();
    expect(screen.getByText('table.sortDesc')).toBeInTheDocument();
    expect(screen.getByText('table.clearFilter')).toBeInTheDocument();
    expect(screen.getByText('(table.selectAll)')).toBeInTheDocument();
  });

  test('typing in the search input filters the visible options', () => {
    render(<TableFilter {...baseProps} />);
    const search = screen.getByPlaceholderText('table.search') as HTMLInputElement;

    fireEvent.change(search, { target: { value: 'open' } });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByText('Closed')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });

  test('search with no matches shows the noResults message', () => {
    render(<TableFilter {...baseProps} />);
    const search = screen.getByPlaceholderText('table.search') as HTMLInputElement;

    fireEvent.change(search, { target: { value: 'zzzzzzzz' } });

    expect(screen.getByText('table.noResults')).toBeInTheDocument();
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
  });

  test('clicking an unchecked option calls onFilterChange with that option appended', () => {
    const onFilterChange = mock((_v: string[]) => {});
    render(<TableFilter {...baseProps} onFilterChange={onFilterChange} />);

    fireEvent.click(screen.getByText('Open'));

    expect(onFilterChange).toHaveBeenCalledWith(['Open']);
  });

  test('clicking a selected option removes it from the selection', () => {
    const onFilterChange = mock((_v: string[]) => {});
    render(
      <TableFilter
        {...baseProps}
        selectedValues={['Open', 'Closed']}
        onFilterChange={onFilterChange}
      />,
    );

    fireEvent.click(screen.getByText('Open'));

    expect(onFilterChange).toHaveBeenCalledWith(['Closed']);
  });

  test('select-all checkbox selects every visible option', () => {
    const onFilterChange = mock((_v: string[]) => {});
    render(<TableFilter {...baseProps} onFilterChange={onFilterChange} />);

    // The select-all checkbox is the first checkbox in the dropdown.
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    expect(onFilterChange).toHaveBeenCalledWith(['Open', 'Closed', 'Pending']);
  });

  test('select-all when all are already selected deselects every visible option', () => {
    const onFilterChange = mock((_v: string[]) => {});
    render(
      <TableFilter
        {...baseProps}
        selectedValues={['Open', 'Closed', 'Pending']}
        onFilterChange={onFilterChange}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    expect(onFilterChange).toHaveBeenCalledWith([]);
  });

  test('select-all only toggles options matching the current search filter', () => {
    const onFilterChange = mock((_v: string[]) => {});
    render(
      <TableFilter {...baseProps} selectedValues={['Pending']} onFilterChange={onFilterChange} />,
    );
    const search = screen.getByPlaceholderText('table.search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'open' } });

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    // Pending stays selected (filtered out); Open is added.
    expect(onFilterChange).toHaveBeenCalledWith(['Pending', 'Open']);
  });

  test('clear-filter button calls onFilterChange with an empty array', () => {
    const onFilterChange = mock((_v: string[]) => {});
    render(
      <TableFilter {...baseProps} selectedValues={['Open']} onFilterChange={onFilterChange} />,
    );

    fireEvent.click(screen.getByText('table.clearFilter'));

    expect(onFilterChange).toHaveBeenCalledWith([]);
  });

  test('sort ascending button calls onSortChange("asc")', () => {
    const onSortChange = mock((_d: 'asc' | 'desc' | null) => {});
    render(<TableFilter {...baseProps} onSortChange={onSortChange} />);

    fireEvent.click(screen.getByText('table.sortAsc'));

    expect(onSortChange).toHaveBeenCalledWith('asc');
  });

  test('sort descending button calls onSortChange("desc")', () => {
    const onSortChange = mock((_d: 'asc' | 'desc' | null) => {});
    render(<TableFilter {...baseProps} onSortChange={onSortChange} />);

    fireEvent.click(screen.getByText('table.sortDesc'));

    expect(onSortChange).toHaveBeenCalledWith('desc');
  });

  test('close button (header xmark) calls onClose', () => {
    const onClose = mock(() => {});
    render(<TableFilter {...baseProps} onClose={onClose} />);

    const closeButton = screen.getAllByRole('button').find((b) => b.querySelector('i.fa-xmark'));
    if (!closeButton) throw new Error('close button not found');

    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  test('empty-string options render the table.empty placeholder label', () => {
    render(<TableFilter {...baseProps} options={['', 'Open']} />);

    expect(screen.getByText('table.empty')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  test('search filter respects the table.empty translated label', () => {
    render(<TableFilter {...baseProps} options={['', 'Open']} />);
    const search = screen.getByPlaceholderText('table.search') as HTMLInputElement;

    fireEvent.change(search, { target: { value: 'empty' } });

    expect(screen.getByText('table.empty')).toBeInTheDocument();
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
  });
});
