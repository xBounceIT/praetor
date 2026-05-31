import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ServerDashboardView } from '../../../components/projects/dashboardLayout';
import type { UseDashboardLayout } from '../../../components/projects/useDashboardLayout';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

// Stub ShareViewModal so opening it doesn't reach into viewsApi.directory/getShares
// (those live on the real client). This suite only verifies DashboardControls' own
// gating + that Share opens the modal with the correct view id/name.
const shareModalProps: { isOpen: boolean; viewId: string; viewName: string }[] = [];
mock.module('../../../components/shared/ShareViewModal', () => ({
  default: (props: { isOpen: boolean; viewId: string; viewName: string }) => {
    shareModalProps.push({ isOpen: props.isOpen, viewId: props.viewId, viewName: props.viewName });
    return props.isOpen ? (
      <div data-testid="share-view-modal" data-view-id={props.viewId}>
        {props.viewName}
      </div>
    ) : null;
  },
}));

clearSpyStateAfterAll();

const DashboardControls = (await import('../../../components/projects/DashboardControls')).default;

// A server-backed dashboard view at a given access level. The hook maps `access`
// to `isOwner` + `permission`; we build the mapped shape directly here.
const ownedView = (over: Partial<ServerDashboardView> = {}): ServerDashboardView => ({
  id: 'sv-owned',
  name: 'My Owned View',
  layout: [],
  isOwner: true,
  permission: 'write',
  ownerName: 'Me',
  ...over,
});
const writeView = (over: Partial<ServerDashboardView> = {}): ServerDashboardView => ({
  id: 'sv-write',
  name: 'Write Shared View',
  layout: [],
  isOwner: false,
  permission: 'write',
  ownerName: 'Bob',
  ...over,
});
const readView = (over: Partial<ServerDashboardView> = {}): ServerDashboardView => ({
  id: 'sv-read',
  name: 'Read Shared View',
  layout: [],
  isOwner: false,
  permission: 'read',
  ownerName: 'Carol',
  ...over,
});

// Hand-built controls object: every callback is a spy so the test can assert which
// hook action a given menu item fires. Async mutators resolve true by default.
const buildControls = (over: Partial<UseDashboardLayout> = {}): UseDashboardLayout => ({
  layout: [],
  editing: false,
  views: [],
  activeViewId: null,
  viewsLoading: false,
  viewsError: false,
  savingView: false,
  reloadViews: mock(() => {}),
  followingGlobal: true,
  startEditing: mock(() => {}),
  cancelEditing: mock(() => {}),
  doneEditing: mock(() => {}),
  moveWidget: mock(() => {}),
  resizeWidget: mock(() => {}),
  toggleHidden: mock(() => {}),
  saveAsView: mock(async () => true),
  applyView: mock(() => {}),
  deleteView: mock(async () => {}),
  renameView: mock(async () => true),
  resaveView: mock(async () => true),
  duplicateView: mock(async () => true),
  followGlobalDefault: mock(() => {}),
  setAsGlobalDefault: mock(() => {}),
  ...over,
});

const openViewsMenu = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /projects:detail\.dashboard\.views/ }));
  return user;
};

beforeEach(() => {
  shareModalProps.length = 0;
});

afterEach(() => {
  shareModalProps.length = 0;
});

describe('<DashboardControls /> — per-row action gating', () => {
  test('owner row exposes duplicate, rename, share and delete', async () => {
    render(<DashboardControls controls={buildControls({ views: [ownedView()] })} />);
    await openViewsMenu();
    await screen.findByText('My Owned View');

    expect(screen.getByLabelText('common:views.duplicateView')).toBeInTheDocument();
    expect(screen.getByLabelText('common:views.rename')).toBeInTheDocument();
    expect(screen.getByLabelText('common:views.shareView')).toBeInTheDocument();
    expect(screen.getByLabelText('projects:detail.dashboard.deleteView')).toBeInTheDocument();
  });

  test('write row exposes duplicate + rename but no share/delete', async () => {
    render(<DashboardControls controls={buildControls({ views: [writeView()] })} />);
    await openViewsMenu();
    await screen.findByText('Write Shared View');

    // "Shared by" + write chip render for a non-owned view.
    expect(screen.getByText('common:views.sharedBy')).toBeInTheDocument();
    expect(screen.getByText('common:views.permissionWrite')).toBeInTheDocument();

    expect(screen.getByLabelText('common:views.duplicateView')).toBeInTheDocument();
    expect(screen.getByLabelText('common:views.rename')).toBeInTheDocument();
    expect(screen.queryByLabelText('common:views.shareView')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('projects:detail.dashboard.deleteView')).not.toBeInTheDocument();
  });

  test('read row exposes only duplicate (no rename/share/delete)', async () => {
    render(<DashboardControls controls={buildControls({ views: [readView()] })} />);
    await openViewsMenu();
    await screen.findByText('Read Shared View');

    expect(screen.getByText('common:views.sharedBy')).toBeInTheDocument();
    expect(screen.getByText('common:views.permissionRead')).toBeInTheDocument();

    expect(screen.getByLabelText('common:views.duplicateView')).toBeInTheDocument();
    expect(screen.queryByLabelText('common:views.rename')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('common:views.shareView')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('projects:detail.dashboard.deleteView')).not.toBeInTheDocument();
  });

  test('applying a row calls applyView with the row id', async () => {
    const applyView = mock(() => {});
    render(<DashboardControls controls={buildControls({ views: [ownedView()], applyView })} />);
    await openViewsMenu();
    const row = await screen.findByText('My Owned View');

    act(() => {
      fireEvent.click(row.closest('[role="menuitem"]') ?? row);
    });
    expect(applyView).toHaveBeenCalledWith('sv-owned');
  });

  test('deleting an owned row calls deleteView with the row id', async () => {
    const deleteView = mock(async () => {});
    render(<DashboardControls controls={buildControls({ views: [ownedView()], deleteView })} />);
    await openViewsMenu();
    await screen.findByText('My Owned View');

    act(() => {
      fireEvent.click(screen.getByLabelText('projects:detail.dashboard.deleteView'));
    });
    expect(deleteView).toHaveBeenCalledWith('sv-owned');
  });
});

describe('<DashboardControls /> — loading / error / retry rows', () => {
  test('renders the loading row while the library is loading', async () => {
    render(<DashboardControls controls={buildControls({ viewsLoading: true })} />);
    await openViewsMenu();
    expect(await screen.findByText('common:views.loadingViews')).toBeInTheDocument();
  });

  test('renders the error + retry row and reloadViews fires on retry', async () => {
    const reloadViews = mock(() => {});
    render(<DashboardControls controls={buildControls({ viewsError: true, reloadViews })} />);
    await openViewsMenu();

    const failed = await screen.findByText('common:views.loadViewsFailed');
    expect(failed).toBeInTheDocument();
    expect(screen.getByText('common:views.retry')).toBeInTheDocument();

    act(() => {
      fireEvent.click(failed.closest('[role="menuitem"]') ?? failed);
    });
    expect(reloadViews).toHaveBeenCalledTimes(1);
  });
});

describe('<DashboardControls /> — edit-mode save targets', () => {
  test('edit mode without a writable active view offers only "save as new"', async () => {
    render(<DashboardControls controls={buildControls({ editing: true })} />);
    expect(screen.getByText('common:views.saveAsNew')).toBeInTheDocument();
    expect(screen.queryByText('common:views.saveChangesTo')).not.toBeInTheDocument();
  });

  test('edit mode with a writable active view also offers "save changes to {name}"', async () => {
    const resaveView = mock(async () => true);
    render(
      <DashboardControls
        controls={buildControls({
          editing: true,
          views: [ownedView()],
          activeViewId: 'sv-owned',
          resaveView,
        })}
      />,
    );
    const resaveBtn = screen.getByText('common:views.saveChangesTo');
    expect(resaveBtn).toBeInTheDocument();

    act(() => {
      fireEvent.click(resaveBtn);
    });
    await waitFor(() => expect(resaveView).toHaveBeenCalledWith('sv-owned'));
  });

  test('edit mode with a read-only active view hides "save changes to"', async () => {
    render(
      <DashboardControls
        controls={buildControls({
          editing: true,
          views: [readView()],
          activeViewId: 'sv-read',
        })}
      />,
    );
    expect(screen.getByText('common:views.saveAsNew')).toBeInTheDocument();
    expect(screen.queryByText('common:views.saveChangesTo')).not.toBeInTheDocument();
  });
});

describe('<DashboardControls /> — share entry point', () => {
  test('Share opens ShareViewModal with the owned view id + name', async () => {
    render(<DashboardControls controls={buildControls({ views: [ownedView()] })} />);
    await openViewsMenu();
    await screen.findByText('My Owned View');

    act(() => {
      fireEvent.click(screen.getByLabelText('common:views.shareView'));
    });

    const modal = await screen.findByTestId('share-view-modal');
    expect(modal).toHaveAttribute('data-view-id', 'sv-owned');
    expect(modal).toHaveTextContent('My Owned View');

    const lastOpen = shareModalProps.filter((p) => p.isOpen).at(-1);
    expect(lastOpen?.viewId).toBe('sv-owned');
    expect(lastOpen?.viewName).toBe('My Owned View');
  });
});
