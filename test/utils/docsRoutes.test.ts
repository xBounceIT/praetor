import { describe, expect, test } from 'bun:test';

import { getTechnicalDocsViewFromPathname } from '../../utils/docsRoutes';

describe('getTechnicalDocsViewFromPathname', () => {
  test('matches root technical docs paths', () => {
    expect(getTechnicalDocsViewFromPathname('/docs/api')).toBe('docs/api');
    expect(getTechnicalDocsViewFromPathname('/docs/api/')).toBe('docs/api');
    expect(getTechnicalDocsViewFromPathname('/docs/frontend')).toBe('docs/frontend');
    expect(getTechnicalDocsViewFromPathname('/docs/frontend/index.html')).toBe('docs/frontend');
  });

  test('matches localized or previously double-prefixed Starlight technical links', () => {
    expect(getTechnicalDocsViewFromPathname('/docs/en/api/')).toBe('docs/api');
    expect(getTechnicalDocsViewFromPathname('/docs/en/frontend/')).toBe('docs/frontend');
    expect(getTechnicalDocsViewFromPathname('/docs/docs/api/')).toBe('docs/api');
    expect(getTechnicalDocsViewFromPathname('/docs/docs/frontend/')).toBe('docs/frontend');
  });

  test('does not match ordinary user docs paths', () => {
    expect(getTechnicalDocsViewFromPathname('/docs/')).toBeNull();
    expect(getTechnicalDocsViewFromPathname('/docs/en/getting-started/')).toBeNull();
    expect(getTechnicalDocsViewFromPathname('/docs/apiary/')).toBeNull();
  });
});
