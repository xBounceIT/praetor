import { expect, test } from 'bun:test';
import './happydom';
import './setup';

test('frontend test environment preloads are registered', () => {
  expect(globalThis.IS_REACT_ACT_ENVIRONMENT).toBe(true);
  expect(window.location.href).toEqual(expect.any(String));
});
