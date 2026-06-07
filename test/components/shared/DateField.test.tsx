import { describe, expect, mock, test } from 'bun:test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const DateField = (await import('../../../components/shared/DateField')).default;

describe('<DateField />', () => {
  test('shows the placeholder label when no value is set', () => {
    render(<DateField value="" onChange={() => {}} />);
    // identity i18n mock returns the translation key verbatim
    expect(screen.getByText('labels.selectDate')).toBeInTheDocument();
  });

  test('renders the selected date formatted for the locale', () => {
    render(<DateField value="2024-03-15" onChange={() => {}} />);
    const trigger = screen.getByRole('combobox');
    // en locale → 2-digit month/day, numeric year
    expect(trigger.textContent).toContain('03/15/2024');
  });

  test('selecting a day commits a YYYY-MM-DD string', async () => {
    const onChange = mock((_v: string) => {});
    const user = userEvent.setup();
    render(<DateField value="2024-03-10" onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    const day20 = await screen.findByText('20');
    await user.click(day20);

    expect(onChange).toHaveBeenCalledWith('2024-03-20');
  });

  test('optional fields expose a clear action that emits an empty string', async () => {
    const onChange = mock((_v: string) => {});
    const user = userEvent.setup();
    render(<DateField value="2024-03-10" onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    const clear = await screen.findByText('buttons.clear');
    await user.click(clear);

    expect(onChange).toHaveBeenCalledWith('');
  });

  test('required fields do not render a clear action', async () => {
    const user = userEvent.setup();
    render(<DateField value="2024-03-10" required onChange={() => {}} />);

    await user.click(screen.getByRole('combobox'));
    // Wait for the calendar to mount before asserting the clear button is absent.
    await screen.findByText('20');
    expect(screen.queryByText('buttons.clear')).not.toBeInTheDocument();
  });

  test('disabled field keeps the calendar closed', () => {
    render(<DateField value="2024-03-10" disabled onChange={() => {}} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();
    expect(screen.queryByText('20')).not.toBeInTheDocument();
  });

  test('reflects an aria-invalid state on the trigger', () => {
    render(<DateField value="" onChange={() => {}} aria-invalid />);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  });
});
