import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import type { DocumentCodeModuleId } from '../../types';

const previewMock = mock();

mock.module('../../services/api', () => ({
  default: {
    documentCodeTemplates: {
      preview: previewMock,
    },
  },
}));

let useDocumentCodePreview: typeof import('../../hooks/useDocumentCodePreview').useDocumentCodePreview;

beforeAll(async () => {
  ({ useDocumentCodePreview } = await import('../../hooks/useDocumentCodePreview'));
});

// biome-ignore lint/style/useComponentExportOnlyModules: Test-only hook probe.
const PreviewProbe = ({
  moduleId,
  date,
  enabled = true,
}: {
  moduleId: DocumentCodeModuleId;
  date?: string;
  enabled?: boolean;
}) => {
  const { preview, isLoading } = useDocumentCodePreview(moduleId, { date, enabled });
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="preview">{preview ?? ''}</span>
    </div>
  );
};

describe('useDocumentCodePreview', () => {
  beforeEach(() => {
    previewMock.mockReset();
    previewMock.mockResolvedValue({
      moduleId: 'client_quote',
      preview: 'PREV_26_0042',
      year: 2026,
      sequence: 42,
    });
  });

  test('loads the next code preview for the selected module', async () => {
    render(<PreviewProbe moduleId="client_quote" />);

    await waitFor(() => expect(screen.getByTestId('preview')).toHaveTextContent('PREV_26_0042'));
    expect(previewMock).toHaveBeenCalledWith('client_quote', undefined);
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  test('passes the invoice date when provided', async () => {
    render(<PreviewProbe moduleId="client_invoice" date="2027-01-15" />);

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    expect(previewMock).toHaveBeenCalledWith('client_invoice', '2027-01-15');
  });

  test('does not fetch while disabled', async () => {
    render(<PreviewProbe moduleId="client_quote" enabled={false} />);

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(previewMock).not.toHaveBeenCalled();
  });
});
