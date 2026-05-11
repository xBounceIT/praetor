import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock();

const DatePickerButton = (await import('../../components/shared/DatePickerButton')).default;

describe('<DatePickerButton />', () => {
  test('opens a calendar section with a single pill time input', () => {
    render(
      <DatePickerButton label="Start" value={new Date(2024, 2, 15, 8, 30)} onChange={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button'));

    const timeInput = screen.getByLabelText('labels.time') as HTMLInputElement;
    expect(timeInput).toBeInTheDocument();
    expect(timeInput).toHaveAttribute('type', 'time');
    expect(timeInput).toHaveValue('08:30');
    expect(screen.getByRole('button', { name: 'buttons.apply' })).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  test('applies the selected date with the time input value', () => {
    const onChange = mock((_date: Date) => {});
    render(
      <DatePickerButton label="Start" value={new Date(2024, 2, 15, 8, 30)} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByLabelText('labels.time'), { target: { value: '14:45' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.apply' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const appliedDate = onChange.mock.calls[0][0] as Date;
    expect(appliedDate.getFullYear()).toBe(2024);
    expect(appliedDate.getMonth()).toBe(2);
    expect(appliedDate.getDate()).toBe(15);
    expect(appliedDate.getHours()).toBe(14);
    expect(appliedDate.getMinutes()).toBe(45);
  });

  test('renders the same picker controls for an end date label', () => {
    render(
      <DatePickerButton label="End" value={new Date(2024, 2, 16, 23, 59)} onChange={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByLabelText('labels.time')).toHaveValue('23:59');
    expect(screen.getByRole('button', { name: 'buttons.apply' })).toBeInTheDocument();
  });
});
