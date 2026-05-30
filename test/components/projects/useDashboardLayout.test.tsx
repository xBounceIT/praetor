import { beforeEach, describe, expect, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import type { DashboardWidgetDef } from '../../../components/projects/dashboardLayout';
import { useDashboardLayout } from '../../../components/projects/useDashboardLayout';

const WIDGETS: readonly DashboardWidgetDef[] = [
  { id: 'hoursByUser', defaultSpan: 2 },
  { id: 'hoursByTask', defaultSpan: 1 },
  { id: 'costVsRevenue', defaultSpan: 1 },
  { id: 'monthlyActivity', defaultSpan: 2 },
];

const GLOBAL = 'project-analytics-test';
const PROJECT_A = 'projA';
const PROJECT_B = 'projB';

const renderA = () => renderHook(() => useDashboardLayout(GLOBAL, PROJECT_A, WIDGETS));
const renderB = () => renderHook(() => useDashboardLayout(GLOBAL, PROJECT_B, WIDGETS));
const ids = (layout: { id: string }[]) => layout.map((w) => w.id);

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
    expect(ids(result.current.layout)).toEqual([
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
    expect(result.current.layout.find((w) => w.id === 'hoursByTask')?.hidden).toBe(true);

    act(() => result.current.setSpan('costVsRevenue', 2));
    expect(result.current.layout.find((w) => w.id === 'costVsRevenue')?.span).toBe(2);

    act(() => result.current.moveWidgetBy('monthlyActivity', -1));
    expect(ids(result.current.layout)).toEqual([
      'hoursByUser',
      'hoursByTask',
      'monthlyActivity',
      'costVsRevenue',
    ]);
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
    expect(reloaded.current.layout.find((w) => w.id === 'hoursByUser')?.hidden).toBe(true);
  });

  test("a project's override does NOT affect other projects", () => {
    const { result: a } = renderA();
    act(() => a.current.startEditing());
    act(() => a.current.toggleHidden('hoursByUser'));
    act(() => a.current.doneEditing());

    // Project B has no override → still follows the (untouched) global default.
    const { result: b } = renderB();
    expect(b.current.followingGlobal).toBe(true);
    expect(b.current.layout.find((w) => w.id === 'hoursByUser')?.hidden).toBe(false);
  });

  test('cancelEditing discards the draft', () => {
    const { result } = renderA();
    act(() => result.current.startEditing());
    act(() => result.current.setSpan('hoursByTask', 2));
    act(() => result.current.cancelEditing());
    expect(result.current.editing).toBe(false);
    expect(result.current.layout.find((w) => w.id === 'hoursByTask')?.span).toBe(1);
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
    act(() => result.current.setSpan('hoursByTask', 2));
    act(() => result.current.saveAsView('Wide tasks'));
    const viewId = result.current.views[0].id;

    // Detach to the global default, then re-apply the saved view.
    act(() => result.current.followGlobalDefault());
    expect(result.current.followingGlobal).toBe(true);
    expect(result.current.layout.find((w) => w.id === 'hoursByTask')?.span).toBe(1);

    act(() => result.current.applyView(viewId));
    expect(result.current.followingGlobal).toBe(false);
    expect(result.current.activeViewId).toBe(viewId);
    expect(result.current.layout.find((w) => w.id === 'hoursByTask')?.span).toBe(2);
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
    expect(result.current.layout.find((w) => w.id === 'hoursByUser')?.hidden).toBe(false);

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
    expect(a.current.layout.find((w) => w.id === 'costVsRevenue')?.hidden).toBe(true);

    // A different project with no override inherits the promoted global default.
    const { result: b } = renderB();
    expect(b.current.followingGlobal).toBe(true);
    expect(b.current.layout.find((w) => w.id === 'costVsRevenue')?.hidden).toBe(true);

    const { result: reloadedA } = renderA();
    expect(reloadedA.current.layout.find((w) => w.id === 'costVsRevenue')?.hidden).toBe(true);
  });

  test('a dangling active-view id is reconciled to null on mount', () => {
    localStorage.setItem('praetor_dashboard_activeview_projA', 'ghost-view-id');
    const { result } = renderA();
    expect(result.current.activeViewId).toBeNull();
    expect(result.current.followingGlobal).toBe(true);
  });
});
