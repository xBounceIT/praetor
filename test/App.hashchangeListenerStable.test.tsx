import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import type { User, View } from '../types';
import { resolveHashChange, stripHashPrefix } from '../utils/hashCanonicalization';
import { clearSpyStateAfterAll } from './helpers/mockCleanup.ts';

// App.tsx is too tangled to mount the full tree (see test/App.notifications.test.tsx),
// so we mirror the hashchange-sync effect 1:1 and assert it mounts once.

clearSpyStateAfterAll();

const VALID_VIEWS: View[] = ['timesheets/tracker', 'crm/clients', 'crm/suppliers'];

const useHashSync = (initialView: View | '404', initialUser: Pick<User, 'id'> | null) => {
  const [activeView, setActiveView] = useState<View | '404'>(initialView);
  const programmaticHashRef = useRef<string | null>(null);

  const activeViewRef = useRef<View | '404'>(activeView);
  activeViewRef.current = activeView;
  const currentUserRef = useRef(initialUser);
  currentUserRef.current = initialUser;

  useEffect(() => {
    const handleHashChange = () => {
      if (programmaticHashRef.current === window.location.hash) {
        programmaticHashRef.current = null;
        return;
      }
      programmaticHashRef.current = null;
      const outcome = resolveHashChange({
        rawHash: stripHashPrefix(window.location.hash),
        activeView: activeViewRef.current,
        validViews: VALID_VIEWS,
        hasUser: !!currentUserRef.current,
      });
      if (outcome.kind === 'noop') return;
      if (outcome.kind === 'rewrite-hash') {
        programmaticHashRef.current = outcome.newHash;
        window.location.hash = outcome.newHash.slice(1);
      }
      setActiveView(outcome.view);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return { activeView, setActiveView };
};

afterAll(() => {
  window.location.hash = '';
});

describe('App hashchange listener', () => {
  test('listener is attached exactly once and survives navigation', () => {
    const addSpy = spyOn(window, 'addEventListener');
    const removeSpy = spyOn(window, 'removeEventListener');
    addSpy.mockClear();
    removeSpy.mockClear();

    const { result, unmount } = renderHook(() => useHashSync('timesheets/tracker', { id: 'u1' }));

    act(() => result.current.setActiveView('crm/clients'));
    act(() => result.current.setActiveView('crm/suppliers'));
    act(() => result.current.setActiveView('timesheets/tracker'));

    expect(addSpy.mock.calls.filter((c) => c[0] === 'hashchange').length).toBe(1);
    expect(removeSpy.mock.calls.filter((c) => c[0] === 'hashchange').length).toBe(0);

    unmount();
    expect(removeSpy.mock.calls.filter((c) => c[0] === 'hashchange').length).toBe(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  test('handler reads the latest activeView via ref after navigation', () => {
    window.location.hash = '';

    const { result } = renderHook(() => useHashSync('timesheets/tracker', { id: 'u1' }));

    act(() => result.current.setActiveView('crm/clients'));

    act(() => {
      window.location.hash = '#/crm/suppliers';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(result.current.activeView).toBe('crm/suppliers');
  });
});
