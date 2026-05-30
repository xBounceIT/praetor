import { beforeEach, describe, expect, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import type { DashboardWidgetDef } from '../../../components/projects/dashboardLayout';
import { useDashboardLayout } from '../../../components/projects/useDashboardLayout';

const WIDGETS: readonly DashboardWidgetDef[] = [
  { id: 'hoursByUser', x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
  { id: 'hoursByTask', x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
  { id: 'costVsRevenue', x: 0, y: 4, w: 6, h: 4, minW: 3, minH: 3 },
  { id: 'monthlyActivity', x: 6, y: 4, w: 6, h: 4, minW: 3, minH: 3 },
];

const GLOBAL = 'project-analytics-test';
const PROJECT_A = 'projA';
const PROJECT_B = 'projB';

const renderA = () => renderHook(() => useDashboardLayout(GLOBAL, PROJECT_A, WIDGETS));
const renderB = () => renderHook(() => useDashboardLayout(GLOBAL, PROJECT_B, WIDGETS));
const find = <T extends { id: string }>(layout: T[], id: string): T | undefined =>
  layout.find((w) => w.id === id);

beforeEach(() => {
  localStorage.clear();
});

describe('useDashboardLayout — two tiers (global default + per-project override)', () => {
  test('a project starts by following the global default, with no views', () => {
    const { result } = renderA();
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

  test('edit mutators change the draft layout while editing', () => {
    const { result } = renderA();
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

  test('resize is clamped to the widget minimum', () => {
    const { result } = renderA();
    act(() => result.current.startEditing());
    act(() => result.current.resizeWidget('hoursByUser', 1, 1));
    expect(find(result.current.layout, 'hoursByUser')?.w).toBe(3); // minW
    expect(find(result.current.layout, 'hoursByUser')?.h).toBe(3); // minH
  });

  test('doneEditing creates a per-project override that survives a remount', () => {
    const { result } = renderA();
    act(() => result.current.startEditing());
    act(() => result.current.toggleHidden('hoursByUser'));
    act(() => result.current.doneEditing());
    expect(result.current.editing).toBe(false);
    expect(result.current.followingGlobal).toBe(false);

    const { result: reloaded } = renderA();
    expect(reloaded.current.followingGlobal).toBe(false);
    expect(find(reloaded.current.layout, 'hoursByUser')?.hidden).toBe(true);
  });

  test("a project's override does NOT affect other projects", () => {
    const { result: a } = renderA();
    act(() => a.current.startEditing());
    act(() => a.current.toggleHidden('hoursByUser'));
    act(() => a.current.doneEditing());

    // Project B has no override → still follows the (untouched) global default.
    const { result: b } = renderB();
    expect(b.current.followingGlobal).toBe(true);
    expect(find(b.current.layout, 'hoursByUser')?.hidden).toBe(false);
  });

  test('cancelEditing discards the draft', () => {
    const { result } = renderA();
    act(() => result.current.startEditing());
    act(() => result.current.resizeWidget('hoursByTask', 12, 6));
    act(() => result.current.cancelEditing());
    expect(result.current.editing).toBe(false);
    expect(find(result.current.layout, 'hoursByTask')?.w).toBe(6);
  });

  test('saveAsView adds to the shared library and pins this project to it', () => {
    const { result: a } = renderA();
    act(() => a.current.startEditing());
    act(() => a.current.toggleHidden('monthlyActivity'));
    act(() => a.current.saveAsView('  Compact  '));

    expect(a.current.editing).toBe(false);
    expect(a.current.views).toHaveLength(1);
    expect(a.current.views[0].name).toBe('Compact');
    expect(a.current.activeViewId).toBe(a.current.views[0].id);
    expect(a.current.followingGlobal).toBe(false);

    // The view library is global: project B sees the same view, but is not
    // pinned to it (B keeps following the global default).
    const { result: b } = renderB();
    expect(b.current.views).toHaveLength(1);
    expect(b.current.followingGlobal).toBe(true);
    expect(b.current.activeViewId).toBeNull();
  });

  test('blank view names are ignored', () => {
    const { result } = renderA();
    act(() => result.current.saveAsView('   '));
    expect(result.current.views).toHaveLength(0);
  });

  test('applyView sets the project override and marks it active', () => {
    const { result } = renderA();
    act(() => result.current.startEditing());
    act(() => result.current.resizeWidget('hoursByTask', 6, 6));
    act(() => result.current.saveAsView('Tall tasks'));
    const viewId = result.current.views[0].id;

    // Detach to the global default, then re-apply the saved view.
    act(() => result.current.followGlobalDefault());
    expect(result.current.followingGlobal).toBe(true);
    expect(find(result.current.layout, 'hoursByTask')?.h).toBe(4);

    act(() => result.current.applyView(viewId));
    expect(result.current.followingGlobal).toBe(false);
    expect(result.current.activeViewId).toBe(viewId);
    expect(find(result.current.layout, 'hoursByTask')?.h).toBe(6);
  });

  test('deleteView removes the view and clears it when it was active', () => {
    const { result } = renderA();
    act(() => result.current.saveAsView('To delete'));
    const viewId = result.current.views[0].id;
    expect(result.current.activeViewId).toBe(viewId);

    act(() => result.current.deleteView(viewId));
    expect(result.current.views).toHaveLength(0);
    expect(result.current.activeViewId).toBeNull();

    const { result: reloaded } = renderA();
    expect(reloaded.current.views).toHaveLength(0);
  });

  test('followGlobalDefault drops the override so the project follows global again', () => {
    const { result } = renderA();
    act(() => result.current.startEditing());
    act(() => result.current.toggleHidden('hoursByUser'));
    act(() => result.current.doneEditing());
    expect(result.current.followingGlobal).toBe(false);

    act(() => result.current.followGlobalDefault());
    expect(result.current.followingGlobal).toBe(true);
    expect(find(result.current.layout, 'hoursByUser')?.hidden).toBe(false);

    const { result: reloaded } = renderA();
    expect(reloaded.current.followingGlobal).toBe(true);
  });

  test('setAsGlobalDefault promotes the layout to the global default for other projects', () => {
    const { result: a } = renderA();
    act(() => a.current.startEditing());
    act(() => a.current.toggleHidden('costVsRevenue'));
    act(() => a.current.setAsGlobalDefault());

    // A now follows the new global default (its override was cleared).
    expect(a.current.followingGlobal).toBe(true);
    expect(find(a.current.layout, 'costVsRevenue')?.hidden).toBe(true);

    // A different project with no override inherits the promoted global default.
    const { result: b } = renderB();
    expect(b.current.followingGlobal).toBe(true);
    expect(find(b.current.layout, 'costVsRevenue')?.hidden).toBe(true);

    const { result: reloadedA } = renderA();
    expect(find(reloadedA.current.layout, 'costVsRevenue')?.hidden).toBe(true);
  });

  test('a dangling active-view id is reconciled to null on mount', () => {
    localStorage.setItem('praetor_dashboard_v2_activeview_projA', 'ghost-view-id');
    const { result } = renderA();
    expect(result.current.activeViewId).toBeNull();
    expect(result.current.followingGlobal).toBe(true);
  });
});
