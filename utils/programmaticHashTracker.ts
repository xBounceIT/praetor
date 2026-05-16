// Tracks how many programmatic hash writes are still waiting for their
// corresponding hashchange event. A single-value flag (the previous design)
// races under rapid navigation: a second write overwrites the marker before
// the first event fires, the listener sees `marker === window.location.hash`
// for the first (older) event, short-circuits it, and then mis-classifies
// the second event as user-initiated. See issue #623.
//
// A pending-write counter avoids the race because each programmatic write
// registers exactly one expected event, and each event consumes exactly one
// pending write, regardless of how their hash values shift between writes.
export type ProgrammaticHashTracker = {
  registerWrite: () => void;
  consumeIfPending: () => boolean;
};

export const createProgrammaticHashTracker = (): ProgrammaticHashTracker => {
  let pending = 0;
  return {
    registerWrite: () => {
      pending += 1;
    },
    consumeIfPending: () => {
      if (pending > 0) {
        pending -= 1;
        return true;
      }
      return false;
    },
  };
};
