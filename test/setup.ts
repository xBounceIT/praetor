import { afterEach, expect } from 'bun:test';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

// biome-ignore lint/suspicious/noExplicitAny: jest-dom matchers shape doesn't align with bun's ExpectExtendMatchers type.
expect.extend(matchers as any);

afterEach(() => {
  cleanup();
});

// Guardrail against a footgun that previously broke CI cross-file: a test must never replace
// window.location wholesale (e.g. `{ ...window.location, assign }`). happy-dom exposes
// href/pathname/etc. as prototype getters with no own-enumerable properties, so such a spread
// strips `href` and makes `new URL(window.location.href)` throw in unrelated suites that run
// later in the same process. Stub individual location methods in place instead. This fires
// after every test, so it pins the regression even when the offending test lives elsewhere.
afterEach(() => {
  if (typeof window.location.href !== 'string') {
    throw new Error(
      'window.location.href is no longer a string — a test replaced window.location instead of ' +
        'stubbing a property in place. Override the specific method via ' +
        'Object.defineProperty(window.location, <method>, ...) and restore it afterward.',
    );
  }
});
