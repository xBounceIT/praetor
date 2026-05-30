import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import DashboardGrid, { DashboardItem } from '../../../components/projects/DashboardGrid';
import {
  buildDefaultLayout,
  type DashboardLayout,
  type DashboardWidgetDef,
  setWidgetHidden,
} from '../../../components/projects/dashboardLayout';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

const DEFS: readonly DashboardWidgetDef[] = [
  { id: 'a', x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
  { id: 'b', x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
];
const base = buildDefaultLayout(DEFS);

const DRAG_HANDLE = 'projects:detail.dashboard.dragHandle';
const HIDE = 'projects:detail.dashboard.hideWidget';

type Handlers = {
  editing?: boolean;
  layout?: DashboardLayout;
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, w: number, h: number) => void;
  onToggleHidden?: (id: string) => void;
};

const renderGrid = (h: Handlers = {}) =>
  render(
    <DashboardGrid
      layout={h.layout ?? base}
      defs={DEFS}
      editing={h.editing ?? false}
      onMove={h.onMove ?? (() => {})}
      onResize={h.onResize ?? (() => {})}
      onToggleHidden={h.onToggleHidden ?? (() => {})}
    >
      <DashboardItem id="a" title="Alpha">
        <div>content-a</div>
      </DashboardItem>
      <DashboardItem id="b" title="Beta">
        <div>content-b</div>
      </DashboardItem>
    </DashboardGrid>,
  );

describe('DashboardGrid', () => {
  test('renders each item content and no edit chrome outside edit mode', () => {
    renderGrid({ editing: false });
    expect(screen.getByText('content-a')).toBeTruthy();
    expect(screen.getByText('content-b')).toBeTruthy();
    expect(screen.queryAllByLabelText(DRAG_HANDLE)).toHaveLength(0);
    expect(screen.queryAllByLabelText(HIDE)).toHaveLength(0);
  });

  test('shows a drag handle and hide control per item while editing', () => {
    renderGrid({ editing: true });
    expect(screen.getAllByLabelText(DRAG_HANDLE)).toHaveLength(2);
    expect(screen.getAllByLabelText(HIDE)).toHaveLength(2);
  });

  test('arrow keys on the drag handle move the widget by one cell', () => {
    const onMove = mock((_id: string, _x: number, _y: number) => {});
    renderGrid({ editing: true, onMove });
    const handles = screen.getAllByLabelText(DRAG_HANDLE);
    fireEvent.keyDown(handles[0], { key: 'ArrowRight' }); // widget 'a' at (0,0)
    expect(onMove).toHaveBeenCalledWith('a', 1, 0);
  });

  test('shift+arrow on the drag handle resizes the widget by one cell', () => {
    const onResize = mock((_id: string, _w: number, _h: number) => {});
    renderGrid({ editing: true, onResize });
    const handles = screen.getAllByLabelText(DRAG_HANDLE);
    fireEvent.keyDown(handles[0], { key: 'ArrowDown', shiftKey: true }); // 'a' is w6 h4
    expect(onResize).toHaveBeenCalledWith('a', 6, 5);
  });

  test('a hidden widget is omitted outside edit mode', () => {
    renderGrid({ editing: false, layout: setWidgetHidden(base, 'b', true) });
    expect(screen.getByText('content-a')).toBeTruthy();
    expect(screen.queryByText('content-b')).toBeNull();
  });

  test('a hidden widget shows a restore placeholder while editing', () => {
    const onToggleHidden = mock((_id: string) => {});
    renderGrid({ editing: true, layout: setWidgetHidden(base, 'b', true), onToggleHidden });
    // Content replaced by the placeholder (which surfaces the title), so the
    // chart body is gone but the card is still reachable to restore it.
    expect(screen.queryByText('content-b')).toBeNull();
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0);
  });
});
