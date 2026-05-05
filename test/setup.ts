import { afterEach, expect } from 'bun:test';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

// biome-ignore lint/suspicious/noExplicitAny: jest-dom matchers shape doesn't align with bun's ExpectExtendMatchers type.
expect.extend(matchers as any);

afterEach(() => {
  cleanup();
});
