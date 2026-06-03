import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { GeneralSettings as IGeneralSettings } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const GeneralSettings = (await import('../../../components/administration/GeneralSettings'))
  .default;

const settings: IGeneralSettings = {
  currency: 'EUR',
  dailyLimit: 8,
  startOfWeek: 'Monday',
  treatSaturdayAsHoliday: true,
  enableAiReporting: false,
  enforceTotpForAdmins: false,
  allowWeekendSelection: true,
  defaultLocation: 'remote',
  rilCompanyName: '',
  rilDefaultStartTime: '09:00',
  rilDefaultExitTime: '18:00',
  rilLunchBreakMinutes: 60,
  rilNoteOptions: [
    { value: 'P', label: 'Ferie' },
    { value: 'F', label: 'Festivita' },
  ],
  rilTransferOptions: ['In sede', 'Telelavoro'],
};

describe('<GeneralSettings /> RIL option settings', () => {
  afterEach(() => {
    cleanup();
  });

  test('edits RIL note and transfer values through global settings', async () => {
    const onUpdate = mock(async () => undefined);
    render(
      <GeneralSettings
        settings={settings}
        onUpdate={onUpdate}
        branding={{ companyName: null, logoUrl: null }}
        onBrandingChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('general.tabs.tracking'));
    fireEvent.click(screen.getByRole('button', { name: 'general.rilAddNoteOption' }));
    fireEvent.change(screen.getByLabelText('general.rilOptionCodeLabel 1'), {
      target: { value: 'HOL' },
    });
    fireEvent.change(screen.getByLabelText('general.rilOptionNameLabel 1'), {
      target: { value: 'Holiday' },
    });
    fireEvent.change(screen.getByLabelText('general.rilOptionCodeLabel 2'), {
      target: { value: 'P' },
    });
    fireEvent.change(screen.getByLabelText('general.rilOptionNameLabel 2'), {
      target: { value: 'Permit' },
    });
    fireEvent.change(screen.getByLabelText('general.rilOptionCodeLabel 3'), {
      target: { value: 'M' },
    });
    fireEvent.change(screen.getByLabelText('general.rilOptionNameLabel 3'), {
      target: { value: 'Sick' },
    });
    fireEvent.change(screen.getByLabelText('general.rilDefaultExitTimeLabel'), {
      target: { value: '17:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'general.rilAddTransferOption' }));
    fireEvent.change(screen.getByLabelText('general.rilTransferOptionNameLabel 1'), {
      target: { value: 'Office' },
    });
    fireEvent.change(screen.getByLabelText('general.rilTransferOptionNameLabel 2'), {
      target: { value: 'Remote' },
    });
    fireEvent.change(screen.getByLabelText('general.rilTransferOptionNameLabel 3'), {
      target: { value: 'Customer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /general.saveConfiguration/ }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        rilNoteOptions: [
          { value: 'HOL', label: 'Holiday' },
          { value: 'P', label: 'Permit' },
          { value: 'M', label: 'Sick' },
        ],
        rilDefaultExitTime: '17:30',
        rilTransferOptions: ['Office', 'Remote', 'Customer'],
      }),
    );
  });
});
