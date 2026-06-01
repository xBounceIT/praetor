import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CreateViewBody,
  SavedViewDto,
  ViewDirectoryUser,
  ViewShare,
} from '../../services/api/views';
import { installI18nMock } from '../helpers/i18n';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';
import { render } from '../helpers/render';

installI18nMock();

const CURRENT_USER_ID = 'me';

// Server DTOs returned by the mocked viewsApi.list. The owned view is editable/deletable/
// shareable; the read-shared view is apply + duplicate only.
const OWNED_VIEW: SavedViewDto = {
  id: 'sv-owned',
  ownerId: CURRENT_USER_ID,
  ownerName: 'Me Owner',
  kind: 'table',
  scopeKey: 'people.directory',
  name: 'My Owned View',
  config: { schemaVersion: 1, hiddenColIds: [], sortState: null, filterState: {} },
  access: 'owner',
  createdAt: 1,
  updatedAt: 1,
};

const READ_SHARED_VIEW: SavedViewDto = {
  id: 'sv-shared',
  ownerId: 'u2',
  ownerName: 'Bob Builder',
  kind: 'table',
  scopeKey: 'people.directory',
  name: 'Bob Shared View',
  config: { schemaVersion: 1, hiddenColIds: ['age'], sortState: null, filterState: {} },
  access: 'read',
  createdAt: 2,
  updatedAt: 2,
};

const listMock = mock(
  async (_kind: string, _scopeKey: string, _signal?: AbortSignal): Promise<SavedViewDto[]> => [],
);
const createMock = mock(
  async (body: CreateViewBody): Promise<SavedViewDto> => ({
    id: `sv-new-${createMock.mock.calls.length}`,
    ownerId: CURRENT_USER_ID,
    ownerName: 'Me Owner',
    kind: body.kind,
    scopeKey: body.scopeKey,
    name: body.name,
    config: body.config,
    access: 'owner',
    createdAt: 99,
    updatedAt: 99,
  }),
);
const updateMock = mock(async (id: string): Promise<SavedViewDto> => ({ ...OWNED_VIEW, id }));
const removeMock = mock(async (_id: string): Promise<void> => {});
// ShareViewModal is rendered for real (not stubbed) so this file never mock.module-replaces a
// component another suite tests — a global override would leak into ShareViewModal.test.tsx. These
// feed the modal's own loads; kept empty since this suite only checks that Share opens the modal
// for the right view (the modal's behavior is covered by ShareViewModal.test.tsx).
const directoryMock = mock(async (_signal?: AbortSignal): Promise<ViewDirectoryUser[]> => []);
const getSharesMock = mock(async (_id: string, _signal?: AbortSignal): Promise<ViewShare[]> => []);
const replaceSharesMock = mock(
  async (_id: string, shares: ViewShare[]): Promise<ViewShare[]> => shares,
);

mock.module('../../services/api/views', () => ({
  viewsApi: {
    list: listMock,
    create: createMock,
    update: updateMock,
    remove: removeMock,
    directory: directoryMock,
    getShares: getSharesMock,
    replaceShares: replaceSharesMock,
  },
}));

let currentUserId: string | undefined = CURRENT_USER_ID;
mock.module('../../contexts/CurrentUserContext', () => ({
  useCurrentUserId: () => currentUserId,
}));

clearSpyStateAfterAll();

const StandardTable = (await import('../../components/shared/StandardTable')).default;

type Row = { id: string; name: string; age: number };

const sampleRows: Row[] = [
  { id: '1', name: 'Alice', age: 30 },
  { id: '2', name: 'Bob', age: 25 },
];

const sampleColumns = [
  { header: 'Name', accessorKey: 'name' as const, id: 'name' },
  { header: 'Age', accessorKey: 'age' as const, id: 'age' },
];

const renderTable = (props: Partial<Parameters<typeof StandardTable<Row>>[0]> = {}) =>
  render(
    <StandardTable<Row> title="People" data={sampleRows} columns={sampleColumns} {...props} />,
  );

const openCustomViews = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('table.columnSettings'));
  await user.click(screen.getByText('table.customViews'));
  return user;
};

// Radix DropdownMenuItem fires `onSelect` on its own pointer/keyboard handling, which
// userEvent.click doesn't reproduce in happy-dom. Mirror the existing StandardTable suite:
// click the resolved `[role="menuitem"]` element directly via fireEvent.
const clickMenuItemByText = (text: string) => {
  const item = screen.getByText(text).closest('[role="menuitem"]') as HTMLElement;
  act(() => fireEvent.click(item));
};

describe('<StandardTable /> server-backed sharing', () => {
  beforeEach(() => {
    localStorage.clear();
    currentUserId = CURRENT_USER_ID;
    listMock.mockClear();
    createMock.mockClear();
    updateMock.mockClear();
    removeMock.mockClear();
    directoryMock.mockClear();
    getSharesMock.mockClear();
    replaceSharesMock.mockClear();
    listMock.mockImplementation(async () => []);
    directoryMock.mockImplementation(async () => []);
    getSharesMock.mockImplementation(async () => []);
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('viewKey set loads server views via viewsApi.list', async () => {
    listMock.mockImplementation(async () => [OWNED_VIEW]);
    renderTable({ viewKey: 'people.directory' });

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    expect(listMock.mock.calls[0][0]).toBe('table');
    expect(listMock.mock.calls[0][1]).toBe('people.directory');

    await openCustomViews();
    expect(await screen.findByText('My Owned View')).toBeInTheDocument();
  });

  test('owner sees edit, delete and share actions on an owned view', async () => {
    listMock.mockImplementation(async () => [OWNED_VIEW]);
    renderTable({ viewKey: 'people.directory' });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    await openCustomViews();
    await screen.findByText('My Owned View');

    expect(screen.getByLabelText('table.renameView')).toBeInTheDocument();
    expect(screen.getByLabelText('table.deleteView')).toBeInTheDocument();
    expect(screen.getByLabelText('views.shareView')).toBeInTheDocument();
    expect(screen.getByLabelText('views.duplicateView')).toBeInTheDocument();
  });

  test('read recipient sees apply + duplicate but no edit/delete/share', async () => {
    listMock.mockImplementation(async () => [READ_SHARED_VIEW]);
    renderTable({ viewKey: 'people.directory' });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    await openCustomViews();
    await screen.findByText('Bob Shared View');

    // The "Shared by" badge and the read chip render for a non-owned view.
    expect(screen.getByText('views.sharedBy')).toBeInTheDocument();
    expect(screen.getByText('views.permissionRead')).toBeInTheDocument();

    // Duplicate is available to everyone; edit/delete/share are owner/write-gated.
    expect(screen.getByLabelText('views.duplicateView')).toBeInTheDocument();
    expect(screen.queryByLabelText('table.renameView')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('table.deleteView')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('views.shareView')).not.toBeInTheDocument();
  });

  test('opening Share mounts the real ShareViewModal for the owned view', async () => {
    listMock.mockImplementation(async () => [OWNED_VIEW]);
    renderTable({ viewKey: 'people.directory' });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    await openCustomViews();
    await screen.findByText('My Owned View');

    act(() => {
      fireEvent.click(screen.getByLabelText('views.shareView'));
    });

    // The real modal mounts (its search box renders) and loads shares for the view it opened on.
    await screen.findByPlaceholderText('views.searchUsers');
    await waitFor(() => expect(getSharesMock).toHaveBeenCalledTimes(1));
    expect(getSharesMock.mock.calls[0][0]).toBe('sv-owned');
  });

  test('duplicate on a read view creates a new owned view via viewsApi.create', async () => {
    listMock.mockImplementation(async () => [READ_SHARED_VIEW]);
    renderTable({ viewKey: 'people.directory' });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    await openCustomViews();
    await screen.findByText('Bob Shared View');

    act(() => {
      fireEvent.click(screen.getByLabelText('views.duplicateView'));
    });

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const body = createMock.mock.calls[0][0];
    expect(body.kind).toBe('table');
    expect(body.scopeKey).toBe('people.directory');
    expect(body.name).toBe('Bob Shared View');
    expect(body.config.hiddenColIds).toEqual(['age']);
  });
});

describe('<StandardTable /> legacy localStorage mode (no viewKey)', () => {
  beforeEach(() => {
    localStorage.clear();
    currentUserId = CURRENT_USER_ID;
    listMock.mockClear();
    createMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('does not call the server and persists a created view to localStorage', async () => {
    renderTable();

    await openCustomViews();
    // Legacy mode never touches the views API.
    expect(listMock).not.toHaveBeenCalled();

    clickMenuItemByText('buttons.add');

    // Name the view in the reused CustomViewModal and save (its footer uses table.save).
    const nameInput = screen.getByPlaceholderText('table.viewNamePlaceholder') as HTMLInputElement;
    act(() => fireEvent.change(nameInput, { target: { value: 'Local Only View' } }));
    act(() => fireEvent.click(screen.getByText('table.save')));

    const stored = localStorage.getItem('praetor_table_customviews_people');
    expect(stored).toContain('Local Only View');
    expect(createMock).not.toHaveBeenCalled();

    // Legacy mode exposes the clipboard export action, never the server-only Share/Duplicate.
    await openCustomViews();
    await screen.findByText('Local Only View');
    expect(screen.getByLabelText('table.exportView')).toBeInTheDocument();
    expect(screen.queryByLabelText('views.shareView')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('views.duplicateView')).not.toBeInTheDocument();
  });
});
