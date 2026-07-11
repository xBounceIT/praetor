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
  config: {
    schemaVersion: 2,
    hiddenColIds: [],
    columnOrder: ['name', 'age'],
    sortState: null,
    filterState: {},
  },
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
  config: {
    schemaVersion: 2,
    hiddenColIds: ['age'],
    columnOrder: ['age', 'name'],
    sortState: null,
    filterState: {},
  },
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
mock.module('../../contexts/useCurrentUserId', () => ({
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

  test('keeps the persisted active view when the initial load fails (does not clear it)', async () => {
    localStorage.setItem('praetor_table_activeview_people', 'sv-keep');
    // The initial list fails (transient outage / 500).
    listMock.mockImplementationOnce(async () => {
      throw new Error('boom');
    });

    renderTable({ viewKey: 'people.directory' });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    await openCustomViews();
    // The failed load surfaces the error/retry row (so the apply guard has run)...
    await screen.findByText('views.loadViewsFailed');
    // ...and the persisted active marker is NOT cleared — a later retry could still resolve it.
    expect(localStorage.getItem('praetor_table_activeview_people')).toBe('sv-keep');
  });

  test('migrates legacy localStorage views to the server on the first server-backed load', async () => {
    // A view the user created before the upgrade, under the legacy title-slug key.
    localStorage.setItem(
      'praetor_table_customviews_people',
      JSON.stringify([
        {
          id: 'old-1',
          name: 'Legacy View',
          hiddenColIds: ['age'],
          sortState: null,
          filterState: {},
        },
      ]),
    );
    // Server starts empty, then returns the uploaded row on the post-migration re-list.
    let listCalls = 0;
    listMock.mockImplementation(async () => {
      listCalls += 1;
      return listCalls === 1 ? [] : [{ ...OWNED_VIEW, id: 'sv-mig', name: 'Legacy View' }];
    });

    renderTable({ viewKey: 'people.directory' });

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const body = createMock.mock.calls[0][0];
    expect(body.kind).toBe('table');
    expect(body.scopeKey).toBe('people.directory');
    expect(body.name).toBe('Legacy View');
    expect(body.config.schemaVersion).toBe(2);
    expect(body.config.hiddenColIds).toEqual(['age']);
    expect(body.config.columnOrder).toEqual(['name', 'age']);

    await openCustomViews();
    expect(await screen.findByText('Legacy View')).toBeInTheDocument();
  });

  test('leaves migration retryable (pending) when an upload fails, preserving legacy views', async () => {
    localStorage.setItem(
      'praetor_table_customviews_people',
      JSON.stringify([
        { id: 'old-1', name: 'Legacy View', hiddenColIds: [], sortState: null, filterState: {} },
      ]),
    );
    listMock.mockImplementation(async () => []);
    // The (only) upload fails transiently.
    createMock.mockImplementationOnce(async () => {
      throw new Error('network');
    });

    renderTable({ viewKey: 'people.directory' });
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    // The sentinel stays 'pending' (not 'done') and the legacy view is preserved, so a later
    // load retries it instead of stranding the user's pre-upgrade views.
    await waitFor(() =>
      expect(localStorage.getItem('praetor_table_viewsmigrated_people_directory')).toBe('pending'),
    );
    expect(localStorage.getItem('praetor_table_customviews_people')).toContain('Legacy View');
  });

  test('re-points the active view to the new server id when migrating the active legacy view', async () => {
    localStorage.setItem(
      'praetor_table_customviews_people',
      JSON.stringify([
        {
          id: 'old-1',
          name: 'Legacy View',
          hiddenColIds: ['age'],
          sortState: null,
          filterState: {},
        },
      ]),
    );
    // The user had that legacy view active before the upgrade.
    localStorage.setItem('praetor_table_activeview_people', 'old-1');

    let listCalls = 0;
    listMock.mockImplementation(async () => {
      listCalls += 1;
      return listCalls === 1 ? [] : [{ ...OWNED_VIEW, id: 'sv-mig', name: 'Legacy View' }];
    });
    createMock.mockImplementationOnce(async (body) => ({
      ...OWNED_VIEW,
      id: 'sv-mig',
      name: body.name,
    }));

    renderTable({ viewKey: 'people.directory' });
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    // The active marker now points at the new server id, so the preset stays applied after upgrade.
    await waitFor(() =>
      expect(localStorage.getItem('praetor_table_activeview_people')).toBe('sv-mig'),
    );
  });

  test('still migrates when the only server rows are shared (not owned) views', async () => {
    localStorage.setItem(
      'praetor_table_customviews_people',
      JSON.stringify([
        { id: 'old-1', name: 'Legacy View', hiddenColIds: [], sortState: null, filterState: {} },
      ]),
    );
    // The list is non-empty but holds ONLY a shared view — the user has no OWN views, so a
    // shared-with-me row must not suppress migrating their local presets.
    let listCalls = 0;
    listMock.mockImplementation(async () => {
      listCalls += 1;
      return listCalls === 1
        ? [READ_SHARED_VIEW]
        : [READ_SHARED_VIEW, { ...OWNED_VIEW, id: 'sv-mig', name: 'Legacy View' }];
    });

    renderTable({ viewKey: 'people.directory' });
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0].name).toBe('Legacy View');
  });

  test('does not migrate when the server already has views (no duplication)', async () => {
    localStorage.setItem(
      'praetor_table_customviews_people',
      JSON.stringify([
        { id: 'old-1', name: 'Legacy View', hiddenColIds: [], sortState: null, filterState: {} },
      ]),
    );
    // Server is non-empty → migration claims the sentinel but uploads nothing.
    listMock.mockImplementation(async () => [OWNED_VIEW]);

    renderTable({ viewKey: 'people.directory' });
    await openCustomViews();
    await screen.findByText('My Owned View');
    expect(createMock).not.toHaveBeenCalled();
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

  test('editing a view keeps its saved order/sort/filter', async () => {
    const sortedView: SavedViewDto = {
      ...OWNED_VIEW,
      id: 'sv-sorted',
      name: 'Sorted View',
      config: {
        schemaVersion: 2,
        hiddenColIds: [],
        columnOrder: ['age', 'name'],
        sortState: { colId: 'name', px: 'asc' },
        filterState: {},
      },
    };
    listMock.mockImplementation(async () => [sortedView]);
    updateMock.mockImplementation(async (id) => ({ ...sortedView, id }));

    renderTable({ viewKey: 'people.directory' });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    await openCustomViews();
    await screen.findByText('Sorted View');

    // Open the edit modal (the live table is unsorted), change ONLY the name, and save.
    act(() => fireEvent.click(screen.getByLabelText('table.renameView')));
    const nameInput = (await screen.findByPlaceholderText(
      'table.viewNamePlaceholder',
    )) as HTMLInputElement;
    act(() => fireEvent.change(nameInput, { target: { value: 'Renamed' } }));
    act(() => fireEvent.click(screen.getByText('table.save')));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const [, patch] = updateMock.mock.calls.at(-1) as unknown as [
      string,
      { name: string; config: { columnOrder: unknown; sortState: unknown } },
    ];
    expect(patch.name).toBe('Renamed');
    // The view's own layout is preserved — not overwritten with the live table state.
    expect(patch.config.columnOrder).toEqual(['age', 'name']);
    expect(patch.config.sortState).toEqual({ colId: 'name', px: 'asc' });
  });

  test('read recipient sees apply + duplicate but no edit/delete/share', async () => {
    listMock.mockImplementation(async () => [READ_SHARED_VIEW]);
    renderTable({ viewKey: 'people.directory' });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    await openCustomViews();
    await screen.findByText('Bob Shared View');

    // The owner avatar (labelled "Shared by …") and the read chip render for a non-owned view.
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
    expect(body.config.columnOrder).toEqual(['age', 'name']);
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
