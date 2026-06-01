import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '../../../services/api/client';
import type { CreateViewBody, SavedViewDto, UpdateViewPatch } from '../../../services/api/views';

// ---------------------------------------------------------------------------
// Controllable viewsApi mock. The hook's named-view library is now server-backed
// (kind `'dashboard'`); these spies stand in for the network round-trips so the
// local-tier behavior (global default / per-project override / activeView) can be
// asserted alongside the new async library lifecycle. Each spy reads from the
// module-level `backing` config so individual tests can inject lists, make a call
// reject, or assert call arguments without re-installing the module mock.
// ---------------------------------------------------------------------------
type Backing = {
  list: () => Promise<SavedViewDto[]>;
  create: (body: CreateViewBody) => Promise<SavedViewDto>;
  update: (id: string, patch: UpdateViewPatch) => Promise<SavedViewDto>;
  remove: (id: string) => Promise<void>;
};

let idSeq = 0;
const makeDto = (over: Partial<SavedViewDto> & { name: string }): SavedViewDto => ({
  id: over.id ?? `sv-${++idSeq}`,
  ownerId: over.ownerId ?? 'user-1',
  ownerName: over.ownerName ?? 'Alice',
  kind: 'dashboard',
  scopeKey: over.scopeKey ?? 'project-analytics-test',
  config: over.config ?? { layout: [] },
  access: over.access ?? 'owner',
  createdAt: over.createdAt ?? 0,
  updatedAt: over.updatedAt ?? 0,
  ...over,
});

const defaultBacking = (): Backing => ({
  list: async () => [],
  // The hook waits for the server id before inserting the new row, so `create`
  // must echo back a DTO whose config drives the mapped layout.
  create: async (body: CreateViewBody) =>
    makeDto({ name: body.name, scopeKey: body.scopeKey, config: body.config, access: 'owner' }),
  update: async (id: string, patch: UpdateViewPatch) =>
    makeDto({ id, name: patch.name ?? 'View', config: patch.config ?? { layout: [] } }),
  remove: async () => {},
});

let backing: Backing = defaultBacking();

const listSpy = mock((..._args: unknown[]) => backing.list());
const createSpy = mock((body: CreateViewBody) => backing.create(body));
const updateSpy = mock((id: string, patch: UpdateViewPatch) => backing.update(id, patch));
const removeSpy = mock((id: string) => backing.remove(id));

mock.module('../../../services/api/views', () => ({
  viewsApi: {
    list: listSpy,
    create: createSpy,
    update: updateSpy,
    remove: removeSpy,
    // Unused by the hook (the share picker loads these itself) but present so the
    // mocked module mirrors the real surface.
    getShares: mock(async () => []),
    replaceShares: mock(async () => []),
    directory: mock(async () => []),
  },
}));

const { useDashboardLayout } = await import('../../../components/projects/useDashboardLayout');
type WidgetDef = import('../../../components/projects/dashboardLayout').DashboardWidgetDef;

const WIDGETS: readonly WidgetDef[] = [
  { id: 'hoursByUser', x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
  { id: 'hoursByTask', x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
  { id: 'costVsRevenue', x: 0, y: 4, w: 6, h: 4, minW: 3, minH: 3 },
  { id: 'monthlyActivity', x: 6, y: 4, w: 6, h: 4, minW: 3, minH: 3 },
];

const GLOBAL = 'project-analytics-test';
const PROJECT_A = 'projA';
const PROJECT_B = 'projB';
const USER = 'user-1';

const renderA = (widgets: readonly WidgetDef[] = WIDGETS) =>
  renderHook(() => useDashboardLayout(GLOBAL, PROJECT_A, widgets, USER));
const renderB = (widgets: readonly WidgetDef[] = WIDGETS) =>
  renderHook(() => useDashboardLayout(GLOBAL, PROJECT_B, widgets, USER));
const find = <T extends { id: string }>(layout: T[], id: string): T | undefined =>
  layout.find((w) => w.id === id);

// Mount the hook and wait for the initial server load to settle. The local-tier
// state is available synchronously, but `views` only reflects the server library
// after this resolves — every test that touches `views` must await it first.
const renderAReady = async (widgets: readonly WidgetDef[] = WIDGETS) => {
  const rendered = renderA(widgets);
  await waitFor(() => expect(rendered.result.current.viewsLoading).toBe(false));
  return rendered;
};
const renderBReady = async (widgets: readonly WidgetDef[] = WIDGETS) => {
  const rendered = renderB(widgets);
  await waitFor(() => expect(rendered.result.current.viewsLoading).toBe(false));
  return rendered;
};

const forbidden = () => new ApiError('Forbidden', 403);

beforeEach(() => {
  localStorage.clear();
  idSeq = 0;
  backing = defaultBacking();
  listSpy.mockClear();
  createSpy.mockClear();
  updateSpy.mockClear();
  removeSpy.mockClear();
});

afterEach(() => {
  localStorage.clear();
});

describe('useDashboardLayout — local tiers (global default + per-project override)', () => {
  test('a project starts by following the global default, with no views', async () => {
    const { result } = await renderAReady();
    expect(result.current.editing).toBe(false);
    expect(result.current.views).toEqual([]);
    expect(result.current.activeViewId).toBeNull();
    expect(result.current.followingGlobal).toBe(true);
    expect(result.current.layout.map((w) => w.id)).toEqual([
      'hoursByUser',
      'hoursByTask',
      'costVsRevenue',
      'monthlyActivity',
    ]);
  });

  test('edit mutators change the draft layout while editing', async () => {
    const { result } = await renderAReady();
    act(() => result.current.startEditing());
    expect(result.current.editing).toBe(true);

    act(() => result.current.toggleHidden('hoursByTask'));
    expect(find(result.current.layout, 'hoursByTask')?.hidden).toBe(true);

    act(() => result.current.resizeWidget('costVsRevenue', 12, 5));
    expect(find(result.current.layout, 'costVsRevenue')?.w).toBe(12);
    expect(find(result.current.layout, 'costVsRevenue')?.h).toBe(5);

    act(() => result.current.moveWidget('monthlyActivity', 0, 0));
    expect(find(result.current.layout, 'monthlyActivity')?.x).toBe(0);
    expect(find(result.current.layout, 'monthlyActivity')?.y).toBe(0);
  });

  test('resize is clamped to the widget minimum', async () => {
    const { result } = await renderAReady();
    act(() => result.current.startEditing());
    act(() => result.current.resizeWidget('hoursByUser', 1, 1));
    expect(find(result.current.layout, 'hoursByUser')?.w).toBe(3); // minW
    expect(find(result.current.layout, 'hoursByUser')?.h).toBe(3); // minH
  });

  test('doneEditing creates a per-project override that survives a remount', async () => {
    const { result } = await renderAReady();
    act(() => result.current.startEditing());
    act(() => result.current.toggleHidden('hoursByUser'));
    act(() => result.current.doneEditing());
    expect(result.current.editing).toBe(false);
    expect(result.current.followingGlobal).toBe(false);

    const { result: reloaded } = await renderAReady();
    expect(reloaded.current.followingGlobal).toBe(false);
    expect(find(reloaded.current.layout, 'hoursByUser')?.hidden).toBe(true);
  });

  test("a project's override does NOT affect other projects", async () => {
    const { result: a } = await renderAReady();
    act(() => a.current.startEditing());
    act(() => a.current.toggleHidden('hoursByUser'));
    act(() => a.current.doneEditing());

    // Project B has no override → still follows the (untouched) global default.
    const { result: b } = await renderBReady();
    expect(b.current.followingGlobal).toBe(true);
    expect(find(b.current.layout, 'hoursByUser')?.hidden).toBe(false);
  });

  test('cancelEditing discards the draft', async () => {
    const { result } = await renderAReady();
    act(() => result.current.startEditing());
    act(() => result.current.resizeWidget('hoursByTask', 12, 6));
    act(() => result.current.cancelEditing());
    expect(result.current.editing).toBe(false);
    expect(find(result.current.layout, 'hoursByTask')?.w).toBe(6);
  });

  test('followGlobalDefault drops the override so the project follows global again', async () => {
    const { result } = await renderAReady();
    act(() => result.current.startEditing());
    act(() => result.current.toggleHidden('hoursByUser'));
    act(() => result.current.doneEditing());
    expect(result.current.followingGlobal).toBe(false);

    act(() => result.current.followGlobalDefault());
    expect(result.current.followingGlobal).toBe(true);
    expect(find(result.current.layout, 'hoursByUser')?.hidden).toBe(false);

    const { result: reloaded } = await renderAReady();
    expect(reloaded.current.followingGlobal).toBe(true);
  });

  test('setAsGlobalDefault promotes the layout to the global default for other projects', async () => {
    const { result: a } = await renderAReady();
    act(() => a.current.startEditing());
    act(() => a.current.toggleHidden('costVsRevenue'));
    act(() => a.current.setAsGlobalDefault());

    // A now follows the new global default (its override was cleared).
    expect(a.current.followingGlobal).toBe(true);
    expect(find(a.current.layout, 'costVsRevenue')?.hidden).toBe(true);

    // A different project with no override inherits the promoted global default.
    const { result: b } = await renderBReady();
    expect(b.current.followingGlobal).toBe(true);
    expect(find(b.current.layout, 'costVsRevenue')?.hidden).toBe(true);

    const { result: reloadedA } = await renderAReady();
    expect(find(reloadedA.current.layout, 'costVsRevenue')?.hidden).toBe(true);
  });

  test('a dangling active-view id is reconciled to null after the server load', async () => {
    localStorage.setItem('praetor_dashboard_v2_activeview_projA', 'ghost-view-id');
    // The server returns no view matching the stored id → it drops to null once the
    // load resolves and the reconcile guard runs.
    const { result } = await renderAReady();
    expect(result.current.activeViewId).toBeNull();
    expect(result.current.followingGlobal).toBe(true);
  });

  test('reloading an active view re-saved elsewhere refreshes the override layout', async () => {
    // The viewer applies a shared view (pins it as their per-project override).
    backing.list = async () => [
      makeDto({
        id: 'sv-live',
        name: 'Live',
        config: { layout: [{ id: 'hoursByUser', x: 0, y: 0, w: 6, h: 4, hidden: false }] },
      }),
    ];
    const { result } = await renderAReady();
    act(() => result.current.applyView('sv-live'));
    expect(result.current.activeViewId).toBe('sv-live');
    expect(find(result.current.layout, 'hoursByUser')?.h).toBe(4);

    // The owner (or another write recipient) re-saves it taller. A reload must re-apply
    // the new layout to this viewer's active override, not just the library row —
    // otherwise the stale localStorage override keeps showing the old layout.
    backing.list = async () => [
      makeDto({
        id: 'sv-live',
        name: 'Live',
        config: { layout: [{ id: 'hoursByUser', x: 0, y: 0, w: 6, h: 6, hidden: false }] },
      }),
    ];
    await act(async () => {
      result.current.reloadViews();
    });
    await waitFor(() => expect(find(result.current.views[0].layout, 'hoursByUser')?.h).toBe(6));

    expect(result.current.activeViewId).toBe('sv-live');
    // The rendered (override) layout reflects the re-save — "changes it for everyone".
    expect(find(result.current.layout, 'hoursByUser')?.h).toBe(6);
  });

  test('reloading does NOT disturb the override when no view is active', async () => {
    // A custom (non-view) override must survive a reload untouched.
    backing.list = async () => [makeDto({ id: 'sv-other', name: 'Other' })];
    const { result } = await renderAReady();
    act(() => result.current.startEditing());
    act(() => result.current.resizeWidget('hoursByUser', 6, 6));
    act(() => result.current.doneEditing());
    expect(result.current.activeViewId).toBeNull();
    expect(find(result.current.layout, 'hoursByUser')?.h).toBe(6);

    await act(async () => {
      result.current.reloadViews();
    });
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    // No active marker → reconcile leaves the custom override alone.
    expect(result.current.activeViewId).toBeNull();
    expect(find(result.current.layout, 'hoursByUser')?.h).toBe(6);
  });
});

describe('useDashboardLayout — server-backed view library', () => {
  test('loads the shared library on mount, keyed by the dashboard scope', async () => {
    backing.list = async () => [makeDto({ id: 'sv-shared', name: 'Compact', access: 'owner' })];
    const { result } = await renderAReady();
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith('dashboard', GLOBAL);
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0]).toMatchObject({
      id: 'sv-shared',
      name: 'Compact',
      isOwner: true,
      permission: 'write',
    });
  });

  test('a shared (non-owned) row carries the granted permission + owner name', async () => {
    backing.list = async () => [
      makeDto({ id: 'sv-1', name: 'Read view', access: 'read', ownerName: 'Bob' }),
      makeDto({ id: 'sv-2', name: 'Write view', access: 'write', ownerName: 'Carol' }),
    ];
    const { result } = await renderAReady();
    expect(result.current.views).toEqual([
      expect.objectContaining({
        id: 'sv-1',
        isOwner: false,
        permission: 'read',
        ownerName: 'Bob',
      }),
      expect.objectContaining({
        id: 'sv-2',
        isOwner: false,
        permission: 'write',
        ownerName: 'Carol',
      }),
    ]);
  });

  test('no authenticated user → the library settles empty without calling the API', async () => {
    const { result } = renderHook(() => useDashboardLayout(GLOBAL, PROJECT_A, WIDGETS, undefined));
    await waitFor(() => expect(result.current.viewsLoading).toBe(false));
    expect(result.current.views).toEqual([]);
    expect(listSpy).not.toHaveBeenCalled();
  });
});

describe('useDashboardLayout — saveAsView (create round-trip)', () => {
  test('saveAsView adds to the shared library and pins this project to it', async () => {
    const { result: a } = await renderAReady();
    act(() => a.current.startEditing());
    act(() => a.current.toggleHidden('monthlyActivity'));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await a.current.saveAsView('  Compact  ');
    });

    expect(ok).toBe(true);
    expect(createSpy).toHaveBeenCalledTimes(1);
    // Name is trimmed and the dashboard config wraps the current layout.
    const body = createSpy.mock.calls[0][0] as CreateViewBody;
    expect(body).toMatchObject({ kind: 'dashboard', scopeKey: GLOBAL, name: 'Compact' });
    expect(a.current.editing).toBe(false);
    expect(a.current.views).toHaveLength(1);
    expect(a.current.views[0].name).toBe('Compact');
    expect(a.current.activeViewId).toBe(a.current.views[0].id);
    expect(a.current.followingGlobal).toBe(false);
  });

  test('blank view names are ignored (no server call)', async () => {
    const { result } = await renderAReady();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveAsView('   ');
    });
    expect(ok).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
    expect(result.current.views).toHaveLength(0);
  });

  test('saveAsView returns false and leaves state intact when create rejects', async () => {
    backing.create = async () => {
      throw new ApiError('Server error', 500);
    };
    const { result } = await renderAReady();
    act(() => result.current.startEditing());
    act(() => result.current.toggleHidden('hoursByUser'));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveAsView('Doomed');
    });

    expect(ok).toBe(false);
    // No optimistic row, the project is not pinned, and the draft stays editable
    // so the modal can remain open for a retry.
    expect(result.current.views).toHaveLength(0);
    expect(result.current.activeViewId).toBeNull();
    expect(result.current.editing).toBe(true);
    expect(result.current.savingView).toBe(false);
  });
});

describe('useDashboardLayout — applyView', () => {
  test('applyView sets the project override and marks it active', async () => {
    backing.list = async () => [
      makeDto({
        id: 'sv-tall',
        name: 'Tall tasks',
        config: {
          layout: [
            { id: 'hoursByUser', x: 0, y: 0, w: 6, h: 4, hidden: false },
            { id: 'hoursByTask', x: 6, y: 0, w: 6, h: 6, hidden: false },
            { id: 'costVsRevenue', x: 0, y: 6, w: 6, h: 4, hidden: false },
            { id: 'monthlyActivity', x: 6, y: 6, w: 6, h: 4, hidden: false },
          ],
        },
      }),
    ];
    const { result } = await renderAReady();
    expect(result.current.followingGlobal).toBe(true);
    expect(find(result.current.layout, 'hoursByTask')?.h).toBe(4);

    act(() => result.current.applyView('sv-tall'));
    expect(result.current.followingGlobal).toBe(false);
    expect(result.current.activeViewId).toBe('sv-tall');
    expect(find(result.current.layout, 'hoursByTask')?.h).toBe(6);
  });

  test('applyView against a REDUCED widget set drops the missing widget', async () => {
    // The view was authored against the full four-widget set, but this viewer is
    // only permitted three. normalizeLayout (run on apply) must drop the widget
    // the viewer can't see rather than leaking it into the rendered layout.
    backing.list = async () => [
      makeDto({
        id: 'sv-full',
        name: 'Full',
        config: {
          layout: [
            { id: 'hoursByUser', x: 0, y: 0, w: 6, h: 4, hidden: false },
            { id: 'hoursByTask', x: 6, y: 0, w: 6, h: 4, hidden: false },
            { id: 'costVsRevenue', x: 0, y: 4, w: 6, h: 4, hidden: false },
            { id: 'monthlyActivity', x: 6, y: 4, w: 6, h: 4, hidden: false },
          ],
        },
      }),
    ];
    const reduced = WIDGETS.filter((w) => w.id !== 'monthlyActivity');
    const { result } = await renderAReady(reduced);

    act(() => result.current.applyView('sv-full'));
    const ids = result.current.layout.map((w) => w.id);
    expect(ids).not.toContain('monthlyActivity');
    expect(ids.sort()).toEqual(['costVsRevenue', 'hoursByTask', 'hoursByUser']);
  });
});

describe('useDashboardLayout — deleteView (owner-only, optimistic)', () => {
  test('deleteView optimistically removes the view and clears it when active', async () => {
    backing.list = async () => [makeDto({ id: 'sv-del', name: 'To delete', access: 'owner' })];
    const { result } = await renderAReady();
    act(() => result.current.applyView('sv-del'));
    expect(result.current.activeViewId).toBe('sv-del');

    await act(async () => {
      await result.current.deleteView('sv-del');
    });
    expect(removeSpy).toHaveBeenCalledWith('sv-del');
    expect(result.current.views).toHaveLength(0);
    expect(result.current.activeViewId).toBeNull();
  });

  test('deleteView rolls back the library and active marker on a non-403 failure', async () => {
    backing.list = async () => [makeDto({ id: 'sv-del', name: 'Keep me', access: 'owner' })];
    backing.remove = async () => {
      throw new ApiError('Server error', 500);
    };
    const { result } = await renderAReady();
    act(() => result.current.applyView('sv-del'));

    // deleteView handles failures internally (no throw — callers fire-and-forget).
    await act(async () => {
      await result.current.deleteView('sv-del');
    });

    // The optimistic removal was reverted: the row and its active marker are back.
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].id).toBe('sv-del');
    expect(result.current.activeViewId).toBe('sv-del');
  });

  test('deleteView is a no-op when the view is not in the loaded library', async () => {
    const { result } = await renderAReady();
    await act(async () => {
      await result.current.deleteView('missing');
    });
    expect(removeSpy).not.toHaveBeenCalled();
  });
});

describe('useDashboardLayout — renameView / resaveView (owner or write, optimistic)', () => {
  test('renameView optimistically swaps the name and persists it', async () => {
    backing.list = async () => [makeDto({ id: 'sv-r', name: 'Old', access: 'owner' })];
    const { result } = await renderAReady();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.renameView('sv-r', '  New name  ');
    });
    expect(ok).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith('sv-r', { name: 'New name' });
    expect(result.current.views[0].name).toBe('New name');
  });

  test('renameView rolls the name back on a non-403 failure', async () => {
    backing.list = async () => [makeDto({ id: 'sv-r', name: 'Original', access: 'owner' })];
    backing.update = async () => {
      throw new ApiError('Server error', 500);
    };
    const { result } = await renderAReady();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.renameView('sv-r', 'Doomed name');
    });
    expect(ok).toBe(false);
    expect(result.current.views[0].name).toBe('Original');
  });

  test('renameView reloads (does not silently rollback) on a 403', async () => {
    let listCalls = 0;
    backing.list = async () => {
      listCalls += 1;
      // The reload after the 403 returns the canonical (server-truth) name.
      return [makeDto({ id: 'sv-r', name: listCalls === 1 ? 'Original' : 'Server truth' })];
    };
    backing.update = async () => {
      throw forbidden();
    };
    const { result } = await renderAReady();

    await act(async () => {
      await result.current.renameView('sv-r', 'Optimistic');
    });
    await waitFor(() => expect(result.current.views[0].name).toBe('Server truth'));
    expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('renameView with a blank name is a read no-op (no server call)', async () => {
    backing.list = async () => [makeDto({ id: 'sv-r', name: 'Unchanged', access: 'owner' })];
    const { result } = await renderAReady();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.renameView('sv-r', '   ');
    });
    expect(ok).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.current.views[0].name).toBe('Unchanged');
  });

  test('resaveView optimistically overwrites the stored layout and pins the project', async () => {
    backing.list = async () => [makeDto({ id: 'sv-rs', name: 'Resave', access: 'owner' })];
    const { result } = await renderAReady();
    act(() => result.current.startEditing());
    act(() => result.current.resizeWidget('hoursByUser', 6, 6));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.resaveView('sv-rs');
    });
    expect(ok).toBe(true);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [id, patch] = updateSpy.mock.calls[0] as [string, UpdateViewPatch];
    expect(id).toBe('sv-rs');
    expect(patch.config).toBeDefined();
    expect(result.current.editing).toBe(false);
    expect(result.current.activeViewId).toBe('sv-rs');
    expect(find(result.current.views[0].layout, 'hoursByUser')?.h).toBe(6);
  });

  test('resaveView rolls the layout back on a non-403 failure', async () => {
    backing.list = async () => [makeDto({ id: 'sv-rs', name: 'Resave', access: 'owner' })];
    backing.update = async () => {
      throw new ApiError('Server error', 500);
    };
    const { result } = await renderAReady();
    act(() => result.current.startEditing());
    act(() => result.current.resizeWidget('hoursByUser', 6, 6));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.resaveView('sv-rs');
    });
    expect(ok).toBe(false);
    // The library row reverts to the originally-loaded (4-high) layout.
    expect(find(result.current.views[0].layout, 'hoursByUser')?.h).toBe(4);
  });

  test('resaveView is a no-op when the view is not in the library', async () => {
    const { result } = await renderAReady();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.resaveView('missing');
    });
    expect(ok).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test('resaveView preserves widget states the re-saver cannot render', async () => {
    // The stored view positions costVsRevenue — a card the re-saver's widget set excludes.
    backing.list = async () => [
      makeDto({
        id: 'sv-rs',
        name: 'Full',
        config: {
          layout: [
            { id: 'hoursByUser', x: 0, y: 0, w: 6, h: 4, hidden: false },
            { id: 'costVsRevenue', x: 6, y: 0, w: 6, h: 5, hidden: false },
          ],
        },
      }),
    ];
    // Render with a reduced widget set (e.g. the re-saver lacks the cost-card permission).
    const reduced = WIDGETS.filter((w) => w.id !== 'costVsRevenue');
    const { result } = await renderAReady(reduced);
    act(() => result.current.applyView('sv-rs'));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.resaveView('sv-rs');
    });
    expect(ok).toBe(true);

    // The saved payload still includes costVsRevenue at its stored size — the permission-filtered
    // snapshot did not strip the card this user can't see.
    const [, patch] = updateSpy.mock.calls.at(-1) as [string, UpdateViewPatch];
    const layout = (patch.config?.layout ?? []) as Array<{ id: string; h: number }>;
    expect(layout.map((w) => w.id)).toContain('costVsRevenue');
    expect(layout.find((w) => w.id === 'costVsRevenue')?.h).toBe(5);
  });
});

describe('useDashboardLayout — duplicateView (any access → owned copy)', () => {
  test('duplicateView creates a NEW owned view from the source layout', async () => {
    backing.list = async () => [
      makeDto({
        id: 'sv-src',
        name: 'Shared read',
        access: 'read',
        ownerName: 'Bob',
        config: {
          layout: [
            { id: 'hoursByUser', x: 0, y: 0, w: 6, h: 5, hidden: false },
            { id: 'hoursByTask', x: 6, y: 0, w: 6, h: 4, hidden: false },
            { id: 'costVsRevenue', x: 0, y: 5, w: 6, h: 4, hidden: false },
            { id: 'monthlyActivity', x: 6, y: 4, w: 6, h: 4, hidden: false },
          ],
        },
      }),
    ];
    const { result } = await renderAReady();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.duplicateView('sv-src', '  My copy  ');
    });
    expect(ok).toBe(true);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const body = createSpy.mock.calls[0][0] as CreateViewBody;
    expect(body).toMatchObject({ kind: 'dashboard', scopeKey: GLOBAL, name: 'My copy' });

    // The copy is appended as an owned row and this project is pinned to it.
    expect(result.current.views).toHaveLength(2);
    const copy = result.current.views[1];
    expect(copy.name).toBe('My copy');
    expect(copy.isOwner).toBe(true);
    expect(result.current.activeViewId).toBe(copy.id);
  });

  test('duplicateView returns false on a blank name or unknown source', async () => {
    backing.list = async () => [makeDto({ id: 'sv-src', name: 'Source', access: 'read' })];
    const { result } = await renderAReady();

    let blank: boolean | undefined;
    let missing: boolean | undefined;
    await act(async () => {
      blank = await result.current.duplicateView('sv-src', '   ');
      missing = await result.current.duplicateView('nope', 'Copy');
    });
    expect(blank).toBe(false);
    expect(missing).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('useDashboardLayout — viewsError + reloadViews', () => {
  test('a failed initial load flags viewsError; reloadViews recovers it', async () => {
    backing.list = async () => {
      throw new ApiError('Server error', 500);
    };
    const { result } = await renderAReady();
    expect(result.current.viewsError).toBe(true);
    expect(result.current.views).toEqual([]);

    // Heal the backing source, then retry.
    backing.list = async () => [makeDto({ id: 'sv-ok', name: 'Recovered', access: 'owner' })];
    await act(async () => {
      result.current.reloadViews();
    });
    await waitFor(() => expect(result.current.viewsError).toBe(false));
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].name).toBe('Recovered');
  });
});
