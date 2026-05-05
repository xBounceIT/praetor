import { describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

const CustomSelect = (await import('../../components/shared/CustomSelect')).default;

const options = [
  { id: 'a', name: 'Apple' },
  { id: 'b', name: 'Banana' },
  { id: 'c', name: 'Cherry' },
];

describe('<CustomSelect />', () => {
  test('renders selected label for single-select with controlled value', () => {
    render(<CustomSelect options={options} value="b" onChange={() => {}} />);
    expect(screen.getByText('Banana')).toBeInTheDocument();
  });

  test('renders placeholder when nothing selected', () => {
    render(
      <CustomSelect options={options} value="" onChange={() => {}} placeholder="Pick something" />,
    );
    expect(screen.getByText('Pick something')).toBeInTheDocument();
  });

  test('clicking trigger button opens dropdown', () => {
    render(<CustomSelect options={options} value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('Cherry')).toBeInTheDocument();
  });

  test('selecting an option in single mode calls onChange and closes dropdown', () => {
    const onChange = mock((_v: string | string[]) => {});
    render(<CustomSelect options={options} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Apple'));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  test('searchable: typing filters options by name', () => {
    render(<CustomSelect options={options} value="" onChange={() => {}} searchable />);
    fireEvent.click(screen.getByRole('button'));
    const search = screen.getByPlaceholderText('select.search') as HTMLInputElement;
    fireEvent.input(search, { target: { value: 'an' } });
    expect(screen.getByText('Banana')).toBeInTheDocument();
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
    expect(screen.queryByText('Cherry')).not.toBeInTheDocument();
  });

  test('isMulti: clicking options accumulates selection', () => {
    const onChange = mock((_v: string | string[]) => {});
    render(<CustomSelect options={options} value={[]} onChange={onChange} isMulti />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Apple'));
    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  test('isMulti: select-all button passes all option ids', () => {
    const onChange = mock((_v: string | string[]) => {});
    render(<CustomSelect options={options} value={[]} onChange={onChange} isMulti />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('select.selectAll'));
    expect(onChange).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  test('autoOpen opens dropdown on mount', () => {
    render(<CustomSelect options={options} value="" onChange={() => {}} autoOpen />);
    expect(screen.getByText('Apple')).toBeInTheDocument();
  });

  test('mousedown outside closes the dropdown', () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <CustomSelect options={options} value="" onChange={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Apple')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
  });

  test('dispatching custom-select-open from another id closes this dropdown', () => {
    render(<CustomSelect options={options} value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Apple')).toBeInTheDocument();

    act(() => {
      document.dispatchEvent(
        new CustomEvent('custom-select-open', { detail: { id: 'other-instance' } }),
      );
    });

    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
  });

  test('disabled prop prevents opening', () => {
    render(<CustomSelect options={options} value="" onChange={() => {}} disabled />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
  });

  test('empty filtered options shows noOptions message', () => {
    render(<CustomSelect options={options} value="" onChange={() => {}} searchable />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByPlaceholderText('select.search'), {
      target: { value: 'zzzzzz' },
    });
    expect(screen.getByText('select.noOptions')).toBeInTheDocument();
  });
});
