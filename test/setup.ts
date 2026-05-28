import { afterEach, expect } from 'bun:test';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

// biome-ignore lint/suspicious/noExplicitAny: jest-dom matchers shape doesn't align with bun's ExpectExtendMatchers type.
expect.extend(matchers as any);

afterEach(() => {
  cleanup();
  // The whole frontend suite runs in one process against a single registered
  // happy-dom window, so a test that navigates (window.location assign/replace/href
  // or history) leaks its location into the next test file. Components that read
  // `new URL(window.location.href)` on mount (e.g. components/Login.tsx) then throw
  // "Invalid URL" depending on file execution order. Reset to a known-good absolute
  // URL after every test so each test starts from a clean, valid location.
  (window as unknown as { happyDOM?: { setURL?: (url: string) => void } }).happyDOM?.setURL?.(
    'http://localhost/',
  );
});
