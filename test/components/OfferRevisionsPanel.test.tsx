import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ClientOffer, OfferRevision, RevisionRow } from '../../types';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';
import { render } from '../helpers/render';

const t = (key: string) => key;
const i18n = { language: 'it', changeLanguage: () => {} };
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t, i18n }),
  Trans: ({ children }: { children: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const listRevisionsMock = mock<(id: string) => Promise<RevisionRow[]>>(() => Promise.resolve([]));
const getRevisionMock = mock<(id: string, revisionId: string) => Promise<OfferRevision>>(() =>
  Promise.reject(new Error('not configured')),
);
const restoreRevisionMock = mock<(id: string, revisionId: string) => Promise<ClientOffer>>(() =>
  Promise.reject(new Error('not configured')),
);

const realDate = await import('../../utils/date');
mock.module('../../utils/date', () => ({
  ...realDate,
  formatInsertDateTime: (timestamp: number) => `formatted-${timestamp}`,
}));

mock.module('../../components/shared/DeleteConfirmModal', () => ({
  default: ({
    isOpen,
    onConfirm,
    zIndex,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    zIndex?: number;
  }) =>
    isOpen ? (
      <button type="button" data-z-index={zIndex} onClick={onConfirm}>
        confirm-restore
      </button>
    ) : null,
}));

clearSpyStateAfterAll();

const { OfferRevisionsPanel } = await import('../../components/sales/OfferRevisionsPanel');
const { getHistoryPreviewIds } = await import('../../utils/historyPreview');

const REVISION_ROW: RevisionRow = {
  id: 'or-2',
  revisionNumber: 2,
  revisionCode: 'REV2',
  createdByUserId: 'u-1',
  createdByUserName: 'Ada Lovelace',
  createdAt: 1_700_000_000_000,
};

const FULL_REVISION: OfferRevision = {
  ...REVISION_ROW,
  snapshot: {
    schemaVersion: 1,
    offer: {
      id: 'OFF_26_001',
      linkedQuoteId: 'PRE_26_001',
      clientId: 'client-1',
      clientName: 'Acme',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage',
      status: 'sent',
      deliveryDate: null,
      expirationDate: '2026-12-31',
      createdAt: 1,
      updatedAt: 2,
    },
    items: [],
  },
};

const RESTORED_OFFER: ClientOffer = {
  ...FULL_REVISION.snapshot.offer,
  revisionNumber: 2,
  revisionCode: 'REV2',
  status: 'draft',
  items: [],
};

const baseProps = {
  offerId: 'OFF_26_001',
  selectedRevisionId: null,
  onPreview: () => {},
  onClearPreview: () => {},
  onRestored: () => {},
  revisionApi: {
    listRevisions: (id: string) => listRevisionsMock(id),
    getRevision: (id: string, revisionId: string) => getRevisionMock(id, revisionId),
    restoreRevision: (id: string, revisionId: string) => restoreRevisionMock(id, revisionId),
  },
};

beforeEach(() => {
  listRevisionsMock.mockReset();
  getRevisionMock.mockReset();
  restoreRevisionMock.mockReset();
  listRevisionsMock.mockImplementation(() => Promise.resolve([REVISION_ROW]));
});

describe('<OfferRevisionsPanel />', () => {
  test('assigns an active preview to exactly one history section', () => {
    expect(getHistoryPreviewIds({ id: 'or-2', revisionCode: 'REV2' })).toEqual({
      revisionId: 'or-2',
      versionId: null,
    });
    expect(getHistoryPreviewIds({ id: 'ov-4' })).toEqual({
      revisionId: null,
      versionId: 'ov-4',
    });
    expect(getHistoryPreviewIds(null)).toEqual({ revisionId: null, versionId: null });
  });

  test('shows immutable code, date and author and loads the selected snapshot', async () => {
    getRevisionMock.mockImplementation(() => Promise.resolve(FULL_REVISION));
    const onPreview = mock(() => {});
    render(<OfferRevisionsPanel {...baseProps} onPreview={onPreview} />);

    await waitFor(() => expect(screen.getByText('REV2')).toBeInTheDocument());
    expect(screen.getByText('formatted-1700000000000 · Ada Lovelace')).toBeInTheDocument();

    fireEvent.click(screen.getByText('REV2'));
    await waitFor(() => expect(getRevisionMock).toHaveBeenCalledWith('OFF_26_001', 'or-2'));
    expect(onPreview).toHaveBeenCalledWith(FULL_REVISION);
  });

  test('restores the selected revision after confirmation and reloads the rail', async () => {
    restoreRevisionMock.mockImplementation(() => Promise.resolve(RESTORED_OFFER));
    const onRestored = mock(() => {});
    render(
      <OfferRevisionsPanel {...baseProps} selectedRevisionId="or-2" onRestored={onRestored} />,
    );

    await waitFor(() =>
      expect(screen.getByText('clientOffers.revisionHistory.restoreButton')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('clientOffers.revisionHistory.restoreButton'));
    const confirmButton = await screen.findByText('confirm-restore');
    expect(confirmButton).toHaveAttribute('data-z-index', '70');
    fireEvent.click(confirmButton);

    await waitFor(() => expect(restoreRevisionMock).toHaveBeenCalledWith('OFF_26_001', 'or-2'));
    expect(onRestored).toHaveBeenCalledWith(RESTORED_OFFER);
    await waitFor(() => expect(listRevisionsMock).toHaveBeenCalledTimes(2));
  });
});
