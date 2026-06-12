import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf8');

const sliceCase = (caseName: string) => {
  const start = source.indexOf(`case '${caseName}':`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n          case ', start + 1);
  return source.slice(start, end === -1 ? undefined : end);
};

describe('App.tsx project order option loading', () => {
  test('projects module loads project-scoped order options, not accounting order details', () => {
    const projectsCase = sliceCase('projects');
    expect(projectsCase).toContain('canListProjectOrderOptions');
    expect(projectsCase).toContain('api.projects.listOrderOptions()');
    expect(projectsCase).not.toContain('api.clientsOrders.list()');
  });

  test('accounting module still loads full client orders', () => {
    const accountingCase = sliceCase('accounting');
    expect(accountingCase).toContain('canListOrders');
    expect(accountingCase).toContain('api.clientsOrders.list()');
    expect(accountingCase).not.toContain('api.projects.listOrderOptions()');
  });
});
