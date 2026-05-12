import { expect } from 'bun:test';

export const readComponentSource = (pathFromComponentsRoot: string) =>
  Bun.file(new URL(`../../components/${pathFromComponentsRoot}`, import.meta.url)).text();

export const expectSourceContainsAll = (source: string, snippets: readonly string[]) => {
  for (const snippet of snippets) {
    expect(source).toContain(snippet);
  }
};

export const expectSourceOmitsAll = (source: string, snippets: readonly string[]) => {
  for (const snippet of snippets) {
    expect(source).not.toContain(snippet);
  }
};
