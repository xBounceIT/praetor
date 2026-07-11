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

  test('renders label accessories outside the label element', () => {
    render(
      <SelectControl
        id="fruit"
        options={options}
        value="a"
        onChange={() => {}}
        label="Fruit"
        labelAccessory={<button type="button">Help</button>}
        required
      />,
    );

    const label = screen.getByText('Fruit').closest('label');
    expect(label).toHaveAttribute('for', 'fruit');
    expect(within(label as HTMLElement).queryByRole('button', { name: 'Help' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Help' }).closest('label')).toBeNull();
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
    expect(selectContent?.className).toContain('z-[90]');
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

  test('searchable combobox renders displayValue with muted placeholder styling when displayValueIsPlaceholder is set', () => {
    render(
      <SelectControl
        options={[{ id: 'none', name: 'No supplier quote' }, ...options]}
        value="none"
        onChange={() => {}}
        searchable
        displayValue="No supplier quote"
        displayValueIsPlaceholder
      />,
    );

    const label = screen.getByText('No supplier quote');
    expect(label).toHaveClass('text-muted-foreground');
    expect(label).not.toHaveClass('font-semibold');
  });

  test('searchable combobox renders displayValue with full-contrast styling once a real value is selected', () => {
    render(
      <SelectControl
        options={[{ id: 'none', name: 'No supplier quote' }, ...options]}
        value="a"
        onChange={() => {}}
        searchable
        displayValue="Apple"
        displayValueIsPlaceholder={false}
      />,
    );

    const label = screen.getByText('Apple');
    expect(label).toHaveClass('font-semibold', 'text-foreground');
    expect(label).not.toHaveClass('text-muted-foreground');
  });

  test('searchable popover content renders above the shared modal layer', () => {
    render(<SelectControl options={options} value="" onChange={() => {}} searchable />);

    fireEvent.click(screen.getByRole('button'));

    const popoverContent = document.querySelector('[data-slot="popover-content"]');
    expect(popoverContent?.className).toContain('z-[90]');
  });

  test('searchable popover content sizes to fit its options instead of clipping to the trigger width', () => {
    render(<SelectControl options={options} value="" onChange={() => {}} searchable />);

    fireEvent.click(screen.getByRole('button'));

    const popoverContent = document.querySelector('[data-slot="popover-content"]');
    // Grows to fit the widest option (no truncated supplier names)...
    expect(popoverContent?.className).toContain('w-fit');
    // ...but never narrower than the trigger...
    expect(popoverContent?.className).toContain(
      'min-w-[max(12rem,var(--radix-popover-trigger-width))]',
    );
    // ...and never wider than the available viewport space (stays on screen).
    expect(popoverContent?.className).toContain(
      'max-w-[var(--radix-popover-content-available-width)]',
    );
    // The old behaviour hard-pinned the panel to the trigger width, clipping content.
    expect(popoverContent?.className).not.toContain('w-[var(--radix-popover-trigger-width)]');
  });

  test('searchable combobox stays non-modal on a plain page so it never locks page scroll', () => {
    render(<SelectControl options={options} value="" onChange={() => {}} searchable />);

    fireEvent.click(screen.getByRole('button'));

    // A non-modal popover leaves the rest of the page interactive.
    expect(document.body.style.pointerEvents).not.toBe('none');
  });

  test('searchable combobox becomes modal inside a dialog so the option list scrolls with the wheel', () => {
    // Inside a modal dialog, Radix's scroll-lock whitelists only the dialog's own
    // subtree, so wheel events over this portaled popover are swallowed. Promoting
    // it to modal gives it its own scroll-lock; Radix signals modality by disabling
    // outside pointer events.
    render(
      <div data-slot="dialog-content">
        <SelectControl options={options} value="" onChange={() => {}} searchable />
      </div>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(document.body.style.pointerEvents).toBe('none');
  });

  test('multi combobox toggles selected values and renders chips', () => {
    const onChange = mock((_value: string | string[]) => {});
    const { rerender } = render(
      <SelectControl options={options} value={['a']} onChange={onChange} searchable isMulti />,
    );

    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveClass('h-auto', 'min-h-9', 'whitespace-normal');
    expect(screen.getByText('Apple').parentElement).toHaveClass('text-foreground');

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
  test('plain select greys out disabled options and does not select them', () => {
    const onChange = mock((_value: string | string[]) => {});
    const disabledOptions = [options[0], { ...options[1], disabled: true }];

    render(<SelectControl options={disabledOptions} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));

    const disabledOption = screen.getByRole('option', { name: 'Banana' });
    expect(disabledOption).toHaveAttribute('data-disabled');
    expect(disabledOption).toHaveClass('data-[disabled]:opacity-50');

    fireEvent.click(disabledOption);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('searchable combobox greys out disabled options and keeps enabled options selectable', () => {
    const onChange = mock((_value: string | string[]) => {});
    const disabledOptions = [options[0], { ...options[1], disabled: true }];

    render(<SelectControl options={disabledOptions} value="" onChange={onChange} searchable />);
    fireEvent.click(screen.getByRole('button'));

    const disabledOption = screen.getByText('Banana').closest('[data-slot="command-item"]');
    expect(disabledOption).not.toBeNull();
    expect(disabledOption).toHaveAttribute('data-disabled', 'true');
    expect(disabledOption).toHaveClass('data-[disabled=true]:opacity-50');

    fireEvent.click(disabledOption as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Apple'));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  test('multi-select all excludes disabled options', () => {
    const onChange = mock((_value: string | string[]) => {});
    const disabledOptions = [options[0], { ...options[1], disabled: true }, options[2]];

    render(
      <SelectControl options={disabledOptions} value={[]} onChange={onChange} searchable isMulti />,
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: 'select.selectAll' }));

    expect(onChange).toHaveBeenCalledWith(['a', 'c']);
  });
  test('multi-select can remove a selected option that later becomes disabled', () => {
    const onChange = mock((_value: string | string[]) => {});
    const disabledOptions = [options[0], { ...options[1], disabled: true }];

    render(
      <SelectControl
        options={disabledOptions}
        value={['a', 'b']}
        onChange={onChange}
        searchable
        isMulti
      />,
    );

    const removeControl = screen.getByText('Banana').nextElementSibling;
    expect(removeControl).not.toBeNull();
    fireEvent.click(removeControl as HTMLElement);

    expect(onChange).toHaveBeenCalledWith(['a']);
  });
});
