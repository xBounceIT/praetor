import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ClientOffer, OfferVersion, OfferVersionRow } from '../../types';

// Stable `t` and `i18n` references so components that put `t` in useCallback dep arrays
// (e.g. OfferVersionsPanel.reload) don't infinite-loop in tests. The shared installI18nMock
// helper creates a fresh `t` per useTranslation call, which is fine for components that
// use t inline but breaks ones that depend on its identity.
const t = (key: string) => key;
const i18n = { language: 'en', changeLanguage: () => {} };
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t, i18n }),
  Trans: ({ children }: { children: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const listVersionsMock = mock<(id: string) => Promise<OfferVersionRow[]>>(() =>
  Promise.resolve([]),
);
const getVersionMock = mock<(id: string, versionId: string) => Promise<OfferVersion>>(() =>
  Promise.reject(new Error('not configured')),
);
const restoreVersionMock = mock<(id: string, versionId: string) => Promise<ClientOffer>>(() =>
  Promise.reject(new Error('not configured')),
);

mock.module('../../services/api/clientOffers', () => ({
  clientOffersApi: {
    listVersions: (id: string) => listVersionsMock(id),
    getVersion: (id: string, vid: string) => getVersionMock(id, vid),
    restoreVersion: (id: string, vid: string) => restoreVersionMock(id, vid),
  },
}));

// Stable rendering for createdAt; the panel passes (timestamp, language).
mock.module('../../utils/date', () => ({
  formatInsertDateTime: (ts: number) => `formatted-${ts}`,
}));

// DeleteConfirmModal uses createPortal under the hood (via shared/Modal). Portal targets in
// happy-dom + React 19 don't reliably surface in screen queries, so swap in a flat
// passthrough that renders the confirm/cancel buttons inline when isOpen.
mock.module('../../components/shared/DeleteConfirmModal', () => ({
  default: ({
    isOpen,
    onConfirm,
    onClose,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <button type="button" onClick={onClose}>
          confirm-cancel
        </button>
        <button type="button" onClick={onConfirm}>
          confirm-yes
        </button>
      </div>
    ) : null,
}));

const OfferVersionsPanel = (await import('../../components/sales/OfferVersionsPanel')).default;

const VERSION_ROW_UPDATE = {
  id: 'ov-1',
  offerId: 'co-1',
  reason: 'update' as const,
  createdByUserId: 'u-1',
  createdAt: 1_700_000_000_000,
};

const VERSION_ROW_RESTORE = {
  id: 'ov-2',
  offerId: 'co-1',
  reason: 'restore' as const,
  createdByUserId: 'u-1',
  createdAt: 1_700_000_001_000,
};

const FULL_VERSION = {
  ...VERSION_ROW_UPDATE,
  snapshot: {
    schemaVersion: 1 as const,
    offer: {
      id: 'co-1',
      linkedQuoteId: 'cq-1',
      clientId: 'c-1',
      clientName: 'Acme',
      paymentTerms: 'immediate' as const,
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft' as const,
      expirationDate: '2026-12-31',
      notes: undefined,
      createdAt: 0,
      updatedAt: 0,
    },
    items: [],
  },
};

const RESTORED_OFFER = {
  id: 'co-1',
  linkedQuoteId: 'cq-1',
  clientId: 'c-1',
  clientName: 'Acme',
  paymentTerms: 'immediate' as const,
  discount: 0,
  discountType: 'percentage' as const,
  status: 'draft' as const,
  expirationDate: '2026-12-31',
  notes: undefined,
  createdAt: 0,
  updatedAt: 1_700_000_002_000,
  items: [],
};

const baseProps = {
  offerId: 'co-1',
  selectedVersionId: null,
  onPreview: () => {},
  onClearPreview: () => {},
  onRestored: () => {},
};

beforeEach(() => {
  listVersionsMock.mockReset();
  getVersionMock.mockReset();
  restoreVersionMock.mockReset();
  listVersionsMock.mockImplementation(() => Promise.resolve([]));
});

afterEach(() => {
  // Modal portal sets body overflow: hidden; reset between tests to avoid bleed.
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

describe('<OfferVersionsPanel />', () => {
  test('renders empty-state copy when no versions exist', async () => {
    listVersionsMock.mockImplementation(() => Promise.resolve([]));
    render(<OfferVersionsPanel {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByText('clientOffers.versionHistory.empty')).toBeInTheDocument(),
    );
    expect(listVersionsMock).toHaveBeenCalledWith('co-1');
  });

  test('renders one row per version with reason badge for "Save" vs "Restored"', async () => {
    listVersionsMock.mockImplementation(() =>
      Promise.resolve([VERSION_ROW_RESTORE, VERSION_ROW_UPDATE]),
    );
    render(<OfferVersionsPanel {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByText('clientOffers.versionHistory.reasonRestore')).toBeInTheDocument(),
    );
    expect(screen.getByText('clientOffers.versionHistory.reasonUpdate')).toBeInTheDocument();
    expect(screen.getByText('formatted-1700000001000')).toBeInTheDocument();
    expect(screen.getByText('formatted-1700000000000')).toBeInTheDocument();
  });

  test('shows error when listVersions rejects', async () => {
    listVersionsMock.mockImplementation(() => Promise.reject(new Error('boom')));
    render(<OfferVersionsPanel {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByText('clientOffers.versionHistory.loadFailed')).toBeInTheDocument(),
    );
  });

  test('clicking a row fetches the full version and calls onPreview', async () => {
    listVersionsMock.mockImplementation(() => Promise.resolve([VERSION_ROW_UPDATE]));
    getVersionMock.mockImplementation(() => Promise.resolve(FULL_VERSION));
    const onPreview = mock(() => {});
    render(<OfferVersionsPanel {...baseProps} onPreview={onPreview} />);
    await waitFor(() => expect(screen.getByText('formatted-1700000000000')).toBeInTheDocument());

    fireEvent.click(screen.getByText('formatted-1700000000000'));
    await waitFor(() => expect(getVersionMock).toHaveBeenCalledWith('co-1', 'ov-1'));
    expect(onPreview).toHaveBeenCalledWith(FULL_VERSION);
  });

  test('re-clicking the already-selected version is a no-op (no extra fetch)', async () => {
    listVersionsMock.mockImplementation(() => Promise.resolve([VERSION_ROW_UPDATE]));
    render(<OfferVersionsPanel {...baseProps} selectedVersionId="ov-1" />);
    await waitFor(() => expect(screen.getByText('formatted-1700000000000')).toBeInTheDocument());
    fireEvent.click(screen.getByText('formatted-1700000000000'));
    expect(getVersionMock).not.toHaveBeenCalled();
  });

  test('selected version reveals "Back to current" and "Restore" actions', async () => {
    listVersionsMock.mockImplementation(() => Promise.resolve([VERSION_ROW_UPDATE]));
    render(<OfferVersionsPanel {...baseProps} selectedVersionId="ov-1" />);
    await waitFor(() =>
      expect(screen.getByText('clientOffers.versionHistory.backToCurrent')).toBeInTheDocument(),
    );
    expect(screen.getByText('clientOffers.versionHistory.restoreButton')).toBeInTheDocument();
  });

  test('"Back to current" button calls onClearPreview', async () => {
    listVersionsMock.mockImplementation(() => Promise.resolve([VERSION_ROW_UPDATE]));
    const onClearPreview = mock(() => {});
    render(
      <OfferVersionsPanel
        {...baseProps}
        selectedVersionId="ov-1"
        onClearPreview={onClearPreview}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('clientOffers.versionHistory.backToCurrent')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('clientOffers.versionHistory.backToCurrent'));
    expect(onClearPreview).toHaveBeenCalled();
  });

  test('Restore button is disabled when `disabled` prop is true', async () => {
    listVersionsMock.mockImplementation(() => Promise.resolve([VERSION_ROW_UPDATE]));
    render(<OfferVersionsPanel {...baseProps} selectedVersionId="ov-1" disabled />);
    await waitFor(() =>
      expect(screen.getByText('clientOffers.versionHistory.restoreButton')).toBeInTheDocument(),
    );
    const restoreBtn = screen
      .getByText('clientOffers.versionHistory.restoreButton')
      .closest('button') as HTMLButtonElement;
    expect(restoreBtn.disabled).toBe(true);
  });

  test('Restore flow: confirm → restoreVersion called → onRestored called → list reloaded', async () => {
    listVersionsMock.mockImplementation(() => Promise.resolve([VERSION_ROW_UPDATE]));
    restoreVersionMock.mockImplementation(() => Promise.resolve(RESTORED_OFFER));
    const onRestored = mock(() => {});
    render(<OfferVersionsPanel {...baseProps} selectedVersionId="ov-1" onRestored={onRestored} />);
    await waitFor(() =>
      expect(screen.getByText('clientOffers.versionHistory.restoreButton')).toBeInTheDocument(),
    );

    // Open confirm modal
    fireEvent.click(screen.getByText('clientOffers.versionHistory.restoreButton'));
    await waitFor(() => expect(screen.getByText('confirm-yes')).toBeInTheDocument());

    // Confirm
    listVersionsMock.mockClear();
    fireEvent.click(screen.getByText('confirm-yes'));

    await waitFor(() => expect(restoreVersionMock).toHaveBeenCalledWith('co-1', 'ov-1'));
    expect(onRestored).toHaveBeenCalledWith(RESTORED_OFFER);
    // After success, the panel reloads the list.
    await waitFor(() => expect(listVersionsMock).toHaveBeenCalled());
  });

  test('Restore error surfaces the server message verbatim', async () => {
    listVersionsMock.mockImplementation(() => Promise.resolve([VERSION_ROW_UPDATE]));
    restoreVersionMock.mockImplementation(() =>
      Promise.reject(new Error('Non-draft offers are read-only')),
    );
    render(<OfferVersionsPanel {...baseProps} selectedVersionId="ov-1" />);
    await waitFor(() =>
      expect(screen.getByText('clientOffers.versionHistory.restoreButton')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText('clientOffers.versionHistory.restoreButton'));
    await waitFor(() => expect(screen.getByText('confirm-yes')).toBeInTheDocument());
    fireEvent.click(screen.getByText('confirm-yes'));

    await waitFor(() =>
      expect(screen.getByText('Non-draft offers are read-only')).toBeInTheDocument(),
    );
  });
});
