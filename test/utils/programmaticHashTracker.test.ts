import { describe, expect, test } from 'bun:test';
import { createProgrammaticHashTracker } from '../../utils/programmaticHashTracker';

describe('createProgrammaticHashTracker', () => {
  test('starts with no pending writes', () => {
    const tracker = createProgrammaticHashTracker();
    expect(tracker.consumeIfPending()).toBe(false);
  });

  test('registerWrite then consumeIfPending pairs symmetrically', () => {
    const tracker = createProgrammaticHashTracker();
    tracker.registerWrite();
    expect(tracker.consumeIfPending()).toBe(true);
    expect(tracker.consumeIfPending()).toBe(false);
  });

  test('rapid back-to-back writes consume in order — regression for issue #623', () => {
    // The pre-fix single-ref design silently dropped the first hashchange
    // when a second programmatic write overwrote the marker before the
    // first event fired. A counter must consume one pending entry per event
    // regardless of how many writes have queued up.
    const tracker = createProgrammaticHashTracker();
    tracker.registerWrite();
    tracker.registerWrite();
    expect(tracker.consumeIfPending()).toBe(true);
    expect(tracker.consumeIfPending()).toBe(true);
    expect(tracker.consumeIfPending()).toBe(false);
  });

  test('interleaved writes and consumes do not lose events', () => {
    const tracker = createProgrammaticHashTracker();
    tracker.registerWrite();
    expect(tracker.consumeIfPending()).toBe(true);
    tracker.registerWrite();
    tracker.registerWrite();
    expect(tracker.consumeIfPending()).toBe(true);
    tracker.registerWrite();
    expect(tracker.consumeIfPending()).toBe(true);
    expect(tracker.consumeIfPending()).toBe(true);
    expect(tracker.consumeIfPending()).toBe(false);
  });

  test('a user-initiated event between programmatic writes is not swallowed', () => {
    // Programmatic write → its hashchange fires and is consumed → counter
    // back to 0 → next event (user-initiated) sees consumeIfPending → false
    // and is processed normally.
    const tracker = createProgrammaticHashTracker();
    tracker.registerWrite();
    expect(tracker.consumeIfPending()).toBe(true);
    expect(tracker.consumeIfPending()).toBe(false);
  });

  test('separate tracker instances do not share state', () => {
    const a = createProgrammaticHashTracker();
    const b = createProgrammaticHashTracker();
    a.registerWrite();
    expect(b.consumeIfPending()).toBe(false);
    expect(a.consumeIfPending()).toBe(true);
  });
});
