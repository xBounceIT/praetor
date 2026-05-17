import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { EmailConfig } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

clearSpyStateAfterAll();

const EmailSettings = (await import('../../../components/administration/EmailSettings')).default;

const MASKED = '********';

const baseConfig: EmailConfig = {
  enabled: true,
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpEncryption: 'tls',
  smtpRejectUnauthorized: true,
  smtpUser: 'user@example.com',
  smtpPassword: MASKED,
  fromEmail: 'noreply@example.com',
  fromName: 'Praetor',
};

const renderEmailSettings = (overrides: Partial<ComponentProps<typeof EmailSettings>> = {}) => {
  const onSave = mock(async (_config: EmailConfig) => {});
  const onTestEmail = mock(async (_recipientEmail: string) => ({ success: true, code: 'OK' }));
  const props: ComponentProps<typeof EmailSettings> = {
    config: baseConfig,
    onSave,
    onTestEmail,
    ...overrides,
  };
  render(<EmailSettings {...props} />);
  return { ...props, onSave, onTestEmail };
};

describe('<EmailSettings /> masked smtpPassword guard (issue #601 follow-up)', () => {
  test('smtpPassword with a masked value renders as a Stored badge instead of a pre-filled password input', () => {
    renderEmailSettings();

    expect(screen.getByTestId('smtp-password')).toBeInTheDocument();
    expect(screen.queryByTestId('smtp-password-input')).toBeNull();
  });

  test('saving with Stored mode active round-trips MASKED_SECRET so the server preserves the stored password', async () => {
    const onSave = mock(async (_config: EmailConfig) => {});
    renderEmailSettings({ onSave });

    // Make some unrelated change so the save button activates.
    const userInput = screen.getByText('email.username').parentElement?.querySelector('input');
    if (!userInput) throw new Error('SMTP user input not found');
    fireEvent.change(userInput, { target: { value: 'newuser@example.com' } });

    const saveButton = screen.getByRole('button', { name: /general\.saveConfiguration/ });
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const submitted = onSave.mock.calls[0]?.[0] as EmailConfig;
    expect(submitted.smtpPassword).toBe(MASKED);
  });

  test('clicking Replace clears the field and lets the admin type a new password that is sent to the server', async () => {
    const onSave = mock(async (_config: EmailConfig) => {});
    renderEmailSettings({ onSave });

    fireEvent.click(screen.getByTestId('smtp-password-replace'));

    const passwordInput = screen.getByTestId('smtp-password-input') as HTMLInputElement;
    expect(passwordInput.value).toBe('');

    fireEvent.change(passwordInput, { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /general\.saveConfiguration/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const submitted = onSave.mock.calls[0]?.[0] as EmailConfig;
    expect(submitted.smtpPassword).toBe('new-secret');
  });
});

describe('<EmailSettings /> From Email auto-fill from SMTP username', () => {
  const emptyConfig: EmailConfig = {
    enabled: true,
    smtpHost: '',
    smtpPort: 587,
    smtpEncryption: 'tls',
    smtpRejectUnauthorized: true,
    smtpUser: '',
    smtpPassword: '',
    fromEmail: '',
    fromName: 'Praetor',
  };

  const inputForLabel = (labelText: string) => {
    const input = screen.getByText(labelText).parentElement?.querySelector('input');
    if (!input) throw new Error(`Input for label "${labelText}" not found`);
    return input as HTMLInputElement;
  };

  test('typing into the SMTP username auto-fills From Email when it is blank', () => {
    renderEmailSettings({ config: emptyConfig });

    const smtpUser = inputForLabel('email.username');
    fireEvent.change(smtpUser, { target: { value: 'noreply@example.com' } });

    expect(inputForLabel('email.fromEmail').value).toBe('noreply@example.com');
  });

  test('a manually-edited From Email is locked and not overwritten by later SMTP username edits', () => {
    renderEmailSettings({ config: emptyConfig });

    const fromEmail = inputForLabel('email.fromEmail');
    fireEvent.change(fromEmail, { target: { value: 'custom@example.com' } });

    const smtpUser = inputForLabel('email.username');
    fireEvent.change(smtpUser, { target: { value: 'auth@example.com' } });

    expect(inputForLabel('email.fromEmail').value).toBe('custom@example.com');
  });

  test('a saved From Email from the persisted config is treated as manually-edited on mount', () => {
    renderEmailSettings(); // baseConfig has a non-empty fromEmail

    const smtpUser = inputForLabel('email.username');
    fireEvent.change(smtpUser, { target: { value: 'newauth@example.com' } });

    expect(inputForLabel('email.fromEmail').value).toBe('noreply@example.com');
  });
});
