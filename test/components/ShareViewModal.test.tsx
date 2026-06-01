import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ViewDirectoryUser, ViewShare } from '../../services/api/views';
import { installI18nMock } from '../helpers/i18n';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';
import { render } from '../helpers/render';

installI18nMock();

const DIRECTORY: ViewDirectoryUser[] = [
  { id: 'me', name: 'Me Owner', username: 'me.owner', avatarInitials: 'MO' },
  { id: 'u2', name: 'Bob Builder', username: 'bob.builder', avatarInitials: 'BB' },
  { id: 'u3', name: 'Carla Smith', username: 'carla.smith', avatarInitials: 'CS' },
  { id: 'u4', name: 'Dave Jones', username: 'dave.jones', avatarInitials: 'DJ' },
];

// Mocked viewsApi surface — only the methods ShareViewModal touches.
const directoryMock = mock(
  async (_signal?: AbortSignal): Promise<ViewDirectoryUser[]> => DIRECTORY,
);
const getSharesMock = mock(async (_id: string, _signal?: AbortSignal): Promise<ViewShare[]> => []);
const replaceSharesMock = mock(
  async (_id: string, shares: ViewShare[]): Promise<ViewShare[]> => shares,
);

mock.module('../../services/api/views', () => ({
  viewsApi: {
    directory: directoryMock,
    getShares: getSharesMock,
    replaceShares: replaceSharesMock,
  },
}));

// Stub the current-user hook so the owner ('me') is excluded from the candidate list.
let currentUserId: string | undefined = 'me';
mock.module('../../contexts/CurrentUserContext', () => ({
  useCurrentUserId: () => currentUserId,
}));

const toastErrorMock = mock(() => {});
const toastSuccessMock = mock(() => {});
// Mock the full toast surface (not just toastError): Bun's mock.module is global and
// persists across files, so an incomplete mock here leaks a `utils/toast` missing
// `toastSuccess` into other suites that import it (e.g. ProjectRules), breaking them.
mock.module('../../utils/toast', () => ({
  toastError: toastErrorMock,
  toastSuccess: toastSuccessMock,
}));

clearSpyStateAfterAll();

const ShareViewModal = (await import('../../components/shared/ShareViewModal')).default;

const renderModal = (overrides: Partial<Parameters<typeof ShareViewModal>[0]> = {}) => {
  const onClose = mock(() => {});
  const onSaved = mock(() => {});
  const result = render(
    <ShareViewModal
      isOpen
      onClose={onClose}
      viewId="sv-1"
      viewName="My Custom View"
      onSaved={onSaved}
      {...overrides}
    />,
  );
  return { onClose, onSaved, ...result };
};

// Resolves the shared-column row (a div) for a given user name. The available column
// renders a <button>, the shared column renders a <div> with a permission Select inside.
const sharedRowFor = (name: string): HTMLElement => {
  const label = screen.getByText(name);
  const row = label.closest('div.flex.items-center.gap-3.p-3') as HTMLElement | null;
  if (!row) throw new Error(`Shared row for "${name}" not found`);
  return row;
};

describe('<ShareViewModal />', () => {
  beforeEach(() => {
    currentUserId = 'me';
    directoryMock.mockClear();
    getSharesMock.mockClear();
    replaceSharesMock.mockClear();
    toastErrorMock.mockClear();
    directoryMock.mockImplementation(async () => DIRECTORY);
    getSharesMock.mockImplementation(async () => []);
    replaceSharesMock.mockImplementation(async (_id, shares) => shares);
  });

  afterEach(() => {
    currentUserId = 'me';
  });

  test('loads the directory and existing shares, excluding the current user', async () => {
    getSharesMock.mockImplementation(async () => [{ userId: 'u2', permission: 'write' }]);
    renderModal();

    // Available column lists the other-than-current, not-yet-shared users.
    expect(await screen.findByText('Carla Smith')).toBeInTheDocument();
    expect(screen.getByText('Dave Jones')).toBeInTheDocument();
    // u2 is pre-shared → in the shared column, not available.
    expect(screen.getByText('Bob Builder')).toBeInTheDocument();
    // The owner ('me') must never appear as a candidate.
    expect(screen.queryByText('Me Owner')).not.toBeInTheDocument();

    expect(directoryMock).toHaveBeenCalledTimes(1);
    expect(getSharesMock).toHaveBeenCalledTimes(1);
    expect(getSharesMock.mock.calls[0][0]).toBe('sv-1');
  });

  test('toggling a user into shared and saving emits the correct {userId,permission}[]', async () => {
    const { onSaved } = renderModal();

    // Select Carla in the available column, then move her to shared.
    fireEvent.click(await screen.findByText('Carla Smith'));
    fireEvent.click(screen.getByRole('button', { name: /views.shareSelected/ }));

    // She now appears in the shared column at the default 'read' permission.
    await waitFor(() => expect(sharedRowFor('Carla Smith')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() => expect(replaceSharesMock).toHaveBeenCalledTimes(1));
    expect(replaceSharesMock.mock.calls[0][0]).toBe('sv-1');
    expect(replaceSharesMock.mock.calls[0][1]).toEqual([{ userId: 'u3', permission: 'read' }]);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  test('changing a recipient permission to write emits write', async () => {
    getSharesMock.mockImplementation(async () => [{ userId: 'u2', permission: 'read' }]);
    renderModal();

    // Wait for the pre-shared recipient to render in the shared column.
    await screen.findByText('Bob Builder');

    // Open the per-row permission Select and pick "write".
    const trigger = within(sharedRowFor('Bob Builder')).getByRole('combobox');
    fireEvent.click(trigger);
    const writeOption = await waitFor(() => {
      const writeNode = Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="option"]'),
      ).find((opt) => (opt.textContent ?? '').includes('views.permissionWrite'));
      if (!writeNode) throw new Error('write option not rendered');
      return writeNode;
    });
    fireEvent.click(writeOption);

    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() => expect(replaceSharesMock).toHaveBeenCalledTimes(1));
    expect(replaceSharesMock.mock.calls[0][1]).toEqual([{ userId: 'u2', permission: 'write' }]);
  });

  test('search filters both columns by name and username', async () => {
    getSharesMock.mockImplementation(async () => [{ userId: 'u2', permission: 'read' }]);
    renderModal();

    await screen.findByText('Carla Smith');
    const searchInput = screen.getByPlaceholderText('views.searchUsers');

    // Filter by a name fragment unique to Dave.
    fireEvent.change(searchInput, { target: { value: 'dave' } });
    expect(screen.getByText('Dave Jones')).toBeInTheDocument();
    expect(screen.queryByText('Carla Smith')).not.toBeInTheDocument();
    // Bob is shared but doesn't match the search → hidden from the shared column too.
    expect(screen.queryByText('Bob Builder')).not.toBeInTheDocument();

    // Filter by a username fragment unique to Bob → shows in the shared column.
    fireEvent.change(searchInput, { target: { value: 'bob.builder' } });
    expect(screen.getByText('Bob Builder')).toBeInTheDocument();
    expect(screen.queryByText('Dave Jones')).not.toBeInTheDocument();
  });

  test('keeps a share for a directory-omitted user (e.g. disabled) visible and removable', async () => {
    // u9 has a grant but is NOT in the directory (e.g. a now-disabled account).
    getSharesMock.mockImplementation(async () => [{ userId: 'u9', permission: 'read' }]);
    renderModal();

    // The orphan grant is surfaced in the shared column (labelled by id), not silently hidden.
    await screen.findByText('u9');

    // Select and remove it, then save → the persisted set drops the ghost grant.
    fireEvent.click(screen.getByText('u9'));
    fireEvent.click(screen.getByRole('button', { name: /views.unshareSelected/ }));
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() => expect(replaceSharesMock).toHaveBeenCalledTimes(1));
    expect(replaceSharesMock.mock.calls[0][1]).toEqual([]);
  });

  test('surfaces a toast when loading shares fails', async () => {
    getSharesMock.mockImplementation(async () => {
      throw new Error('boom');
    });
    renderModal();

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('views.loadSharesFailed'));
  });
});
