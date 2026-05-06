import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';

installI18nMock();

const UnitTypeSelector = (await import('../../components/shared/UnitTypeSelector')).default;

describe('<UnitTypeSelector />', () => {
  test('renders the selected unit label text on the trigger button', () => {
    render(
      <UnitTypeSelector
        value="hours"
        onChange={() => {}}
        isSupply={false}
        quantity={2}
        i18nPrefix="sales:supplierQuotes"
      />,
    );
    expect(screen.getByRole('button').textContent).toContain('sales:supplierQuotes.hours');
  });

  test('renders a static label (no dropdown) when isSupply is true', () => {
    render(
      <UnitTypeSelector
        value="unit"
        onChange={() => {}}
        isSupply={true}
        quantity={1}
        i18nPrefix="sales:supplierQuotes"
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('sales:supplierQuotes.unit')).toBeInTheDocument();
  });

  test('static label uses plural form when quantity is not 1', () => {
    render(
      <UnitTypeSelector
        value="unit"
        onChange={() => {}}
        isSupply={true}
        quantity={3}
        i18nPrefix="sales:supplierQuotes"
      />,
    );
    expect(screen.getByText('sales:supplierQuotes.units')).toBeInTheDocument();
  });

  test('selecting a different unit calls onChange with the new id', () => {
    const onChange = mock((_v: string) => {});
    render(
      <UnitTypeSelector
        value="unit"
        onChange={onChange}
        isSupply={false}
        quantity={1}
        i18nPrefix="sales:supplierQuotes"
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('sales:supplierQuotes.hour'));
    expect(onChange).toHaveBeenCalledWith('hours');
  });
});
