import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, within } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock();

const SelectControl = (await import('../../components/shared/SelectControl')).default;

const options = [
  { id: 'a', name: 'Apple' },
  { id: 'b', name: 'Banana' },
  { id: 'c', name: 'Cherry' },
];

describe('<SelectControl />', () => {
  test('uses native shadcn Field spacing so labels align with adjacent inputs', async () => {
    const source = await Bun.file(
      new URL('../../components/shared/SelectControl.tsx', import.meta.url),
    ).text();

    expect(source).toContain("Field className={cn('relative min-w-0', className)}");
    expect(source).not.toContain("Field className={cn('relative min-w-0 gap-1.5'");
  });

  test('plain select displays the selected value and calls onChange', () => {
    const onChange = mock((_value: string | string[]) => {});
    render(<SelectControl options={options} value="b" onChange={onChange} />);

    expect(screen.getByText('Banana')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Apple' }));

    expect(onChange).toHaveBeenCalledWith('a');
  });

  test('plain select content renders above the shared modal layer', () => {
    render(<SelectControl options={options} value="b" onChange={() => {}} />);

    fireEvent.click(screen.getByRole('combobox'));

    const selectContent = document.querySelector('[data-slot="select-content"]');
    expect(selectContent?.className).toContain('z-[70]');
  });

  test('plain select option with a badge renders the badge inside a flex wrapper that truncates', () => {
    const badgedOptions = [
      { id: 'a', name: 'Apple' },
      { id: 'b', name: 'Banana', badge: 'You' },
    ];
    render(<SelectControl options={badgedOptions} value="a" onChange={() => {}} />);

    fireEvent.click(screen.getByRole('combobox'));

    const badge = screen.getByText('You');
    expect(badge).toBeInTheDocument();

    const wrapper = badge.parentElement;
    expect(wrapper?.className).toContain('min-w-0');
    expect(wrapper?.className).toContain('flex-1');
  });

  test('plain select shows placeholder when no option is selected', () => {
    render(
      <SelectControl options={options} value="" onChange={() => {}} placeholder="Pick something" />,
    );

    expect(screen.getByText('Pick something')).toBeInTheDocument();
  });

  test('searchable combobox filters options and selects a value', () => {
    const onChange = mock((_value: string | string[]) => {});
    render(<SelectControl options={options} value="" onChange={onChange} searchable />);

    fireEvent.click(screen.getByRole('button'));
    fireEvent.input(screen.getByPlaceholderText('select.search'), { target: { value: 'an' } });

    expect(screen.getByText('Banana')).toBeInTheDocument();
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Banana'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  test('searchable popover content renders above the shared modal layer', () => {
    render(<SelectControl options={options} value="" onChange={() => {}} searchable />);

    fireEvent.click(screen.getByRole('button'));

    const popoverContent = document.querySelector('[data-slot="popover-content"]');
    expect(popoverContent?.className).toContain('z-[70]');
  });

  test('multi combobox toggles selected values and renders chips', () => {
    const onChange = mock((_value: string | string[]) => {});
    const { rerender } = render(
      <SelectControl options={options} value={['a']} onChange={onChange} searchable isMulti />,
    );

    expect(screen.getByText('Apple')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Banana'));

    expect(onChange).toHaveBeenCalledWith(['a', 'b']);

    rerender(
      <SelectControl options={options} value={['a', 'b']} onChange={onChange} searchable isMulti />,
    );
    expect(screen.getAllByText('Apple').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Banana').length).toBeGreaterThan(0);
  });

  test('empty-string option ids round-trip through plain select', () => {
    const emptyOptions = [{ id: '', name: 'Custom item' }, ...options];
    const plainChange = mock((_value: string | string[]) => {});

    render(<SelectControl options={emptyOptions} value="" onChange={plainChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Apple' }));
    expect(plainChange).toHaveBeenCalledWith('a');
  });

  test('empty-string option ids round-trip through combobox', () => {
    const emptyOptions = [{ id: '', name: 'Custom item' }, ...options];
    const comboChange = mock((_value: string | string[]) => {});

    render(
      <SelectControl
        options={emptyOptions}
        value="a"
        onChange={comboChange}
        searchable
        placeholder="Pick item"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Apple/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Custom item'));
    expect(comboChange).toHaveBeenCalledWith('');
  });

  test('open searchable combobox closes and stops changing when disabled', () => {
    const onChange = mock((_value: string | string[]) => {});
    const { rerender } = render(
      <SelectControl options={options} value="" onChange={onChange} searchable />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    rerender(<SelectControl options={options} value="" onChange={onChange} searchable disabled />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('disabled controls do not open or change', () => {
    const onChange = mock((_value: string | string[]) => {});
    render(<SelectControl options={options} value="" onChange={onChange} searchable disabled />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('searchable combobox shows an empty state', () => {
    render(<SelectControl options={options} value="" onChange={() => {}} searchable />);

    fireEvent.click(screen.getByRole('button'));
    fireEvent.input(screen.getByPlaceholderText('select.search'), { target: { value: 'zzzzzz' } });

    expect(screen.getByText('select.noOptions')).toBeInTheDocument();
  });
});
