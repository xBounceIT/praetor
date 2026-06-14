import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DocumentCodeSettings from '../../../components/administration/DocumentCodeSettings';

const listMock = mock();
const updateMock = mock();

const t = (key: string, options?: Record<string, unknown>) => {
  if (typeof options?.defaultValue === 'string') return options.defaultValue;
  if (typeof options?.placeholder === 'string') return `${key} ${options.placeholder}`;
  return key;
};

mock.module('react-i18next', () => ({
  useTranslation: () => ({ t }),
}));

mock.module('../../../services/api', () => ({
  default: {
    documentCodeTemplates: {
      list: listMock,
      update: updateMock,
    },
  },
}));

const TEMPLATES = [
  {
    moduleId: 'client_quote',
    label: 'Client quotes',
    prefix: 'PREV',
    template: '{PREFIX}_{YY}_{SEQ}',
    sequencePadding: 4,
    preview: 'PREV_26_0001',
  },
  {
    moduleId: 'client_invoice',
    label: 'Client invoices',
    prefix: 'INV',
    template: '{PREFIX}-{YYYY}-{SEQ}',
    sequencePadding: 4,
    preview: 'INV-2026-0001',
  },
];

describe('DocumentCodeSettings', () => {
  beforeEach(() => {
    listMock.mockReset();
    updateMock.mockReset();
    listMock.mockResolvedValue(TEMPLATES);
    updateMock.mockImplementation(async (templates) =>
      templates.map((template: (typeof TEMPLATES)[number]) => ({
        ...template,
        label: template.moduleId === 'client_quote' ? 'Client quotes' : 'Client invoices',
        preview:
          template.moduleId === 'client_quote'
            ? `${template.prefix}_26_0001`
            : `${template.prefix}-2026-0001`,
      })),
    );
  });

  test('shows validation, live preview, and saves normalized templates', async () => {
    render(<DocumentCodeSettings />);

    const prefixInput = await screen.findByDisplayValue('PREV');
    fireEvent.change(prefixInput, { target: { value: 'QTE' } });

    expect(screen.getByText('QTE_26_0001')).toBeInTheDocument();

    const templateInput = screen.getByDisplayValue('{PREFIX}_{YY}_{SEQ}');
    fireEvent.change(templateInput, { target: { value: '{PREFIX}_{BAD}_{SEQ}' } });

    expect(screen.getByText(/unknownPlaceholder/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /saveConfiguration/ })).toBeDisabled();

    fireEvent.change(templateInput, { target: { value: ' {PREFIX}_{YYYY}_{SEQ} ' } });
    fireEvent.click(screen.getByRole('button', { name: /saveConfiguration/ }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          moduleId: 'client_quote',
          prefix: 'QTE',
          template: '{PREFIX}_{YYYY}_{SEQ}',
          sequencePadding: 4,
        },
      ]),
    );
  });
});
