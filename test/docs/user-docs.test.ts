import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';

const docsSiteDir = path.resolve(import.meta.dir, '..', '..', 'docs-site');
const docsContentDir = path.join(docsSiteDir, 'src', 'content', 'docs');
const englishDocsContentDir = path.join(docsContentDir, 'en');
const astroConfig = readFileSync(path.join(docsSiteDir, 'astro.config.mjs'), 'utf8');
const italianIndex = readFileSync(path.join(docsContentDir, 'index.md'), 'utf8');
const englishIndex = readFileSync(path.join(englishDocsContentDir, 'index.md'), 'utf8');

const expectedPages = [
  'index.md',
  'getting-started.md',
  'time-tracking.md',
  'crm-projects.md',
  'sales-accounting.md',
  'ai-reporting.md',
  'administration.md',
  'faq.md',
];

const walkMarkdownFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const entryPath = path.join(dir, entry);
    if (statSync(entryPath).isDirectory()) return walkMarkdownFiles(entryPath);
    return entry.endsWith('.md') || entry.endsWith('.mdx') ? [entryPath] : [];
  });

describe('Starlight user documentation', () => {
  test('has the expected Italian root pages and English mirrors', () => {
    for (const page of expectedPages) {
      expect(existsSync(path.join(docsContentDir, page))).toBe(true);
      expect(existsSync(path.join(englishDocsContentDir, page))).toBe(true);
    }
  });

  test('uses /docs as the Astro base path', () => {
    expect(astroConfig).toContain("base: '/docs'");
    expect(astroConfig).toContain("trailingSlash: 'always'");
  });

  test('keeps splash hero links inside the /docs base path', () => {
    expect(italianIndex).toContain('link: /docs/getting-started/');
    expect(italianIndex).toContain('link: /docs/faq/');
    expect(englishIndex).toContain('link: /docs/en/getting-started/');
    expect(englishIndex).toContain('link: /docs/en/faq/');
  });

  test('uses base-relative sidebar links for reserved technical docs', () => {
    expect(astroConfig).toContain("link: '/api'");
    expect(astroConfig).toContain("link: '/frontend'");
    expect(astroConfig).not.toContain("link: '/docs/api'");
    expect(astroConfig).not.toContain("link: '/docs/frontend'");
  });

  test('does not create Starlight pages for reserved technical docs routes', () => {
    const markdownFiles = walkMarkdownFiles(docsContentDir);
    const relativeMarkdownFiles = markdownFiles.map((file) =>
      path.relative(docsContentDir, file).replaceAll(path.sep, '/'),
    );

    expect(relativeMarkdownFiles).not.toContain('api.md');
    expect(relativeMarkdownFiles).not.toContain('api.mdx');
    expect(relativeMarkdownFiles).not.toContain('frontend.md');
    expect(relativeMarkdownFiles).not.toContain('frontend.mdx');
    expect(relativeMarkdownFiles).not.toContain('en/api.md');
    expect(relativeMarkdownFiles).not.toContain('en/frontend.md');
  });
});
