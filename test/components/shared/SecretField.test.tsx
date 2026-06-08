import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import SecretField from '../../../components/shared/SecretField';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const baseProps = {
  label: 'Password',
  value: '',
  onChange: () => {},
  isStored: false,
  isReplacing: false,
  onStartReplace: () => {},
  onCancelReplace: () => {},
  storedLabel: 'Secret stored',
  storedHelp: 'Leave as-is to keep it.',
};

describe('<SecretField />', () => {
  test('renders the label and input as shadcn-native primitives', () => {
    render(<SecretField {...baseProps} testId="secret" />);

    // The shadcn FieldLabel / Input expose stable `data-slot` hooks. The previous implementation
    // used a raw <label>/<input> with hardcoded zinc + uppercase styling, so asserting these slots
    // locks the field to the native shadcn style that matches the sibling fields around it.
    const label = screen.getByText('Password');
    expect(label.getAttribute('data-slot')).toBe('field-label');

    const input = screen.getByTestId('secret-input');
    expect(input.getAttribute('data-slot')).toBe('input');
    expect(input.getAttribute('aria-label')).toBe('Password');
  });

  test('uses a textarea (not an input) when multiline', () => {
    render(<SecretField {...baseProps} multiline testId="secret" />);
    expect(screen.getByTestId('secret-input').tagName).toBe('TEXTAREA');
  });

  test('stored mode hides the input behind a Replace affordance', () => {
    const onStartReplace = mock(() => {});
    render(<SecretField {...baseProps} isStored testId="secret" onStartReplace={onStartReplace} />);

    expect(screen.queryByTestId('secret-input')).toBeNull();
    expect(screen.getByText('Secret stored')).toBeDefined();

    fireEvent.click(screen.getByTestId('secret-replace'));
    expect(onStartReplace).toHaveBeenCalled();
  });
});
