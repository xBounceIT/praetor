import { describe, expect, test } from 'bun:test';

const source = await Bun.file(new URL('../App.tsx', import.meta.url)).text();

const getComponentSource = (name: string, nextName: string) => {
  const start = source.indexOf(`const ${name}`);
  const end = source.indexOf(`const ${nextName}`, start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
};

describe('App loading spinner translations', () => {
  test.each([
    ['AppLoadingScreen', 'TechnicalDocsRoute'],
    ['ModulePendingScreen', 'ModuleFailureBanner'],
  ])('%s uses the common loading translation', (componentName, nextComponentName) => {
    const component = getComponentSource(componentName, nextComponentName);

    expect(component).toContain("useTranslation('common')");
    expect(component).toContain("t('common:states.loading')");
    expect(component).not.toContain('Loading…');
  });

  test('technical documentation lazy chunks render inside a loading boundary', () => {
    const component = getComponentSource('TechnicalDocsRoute', 'LoginRoute');

    expect(component).toContain('<Suspense fallback={<AppLoadingScreen />}>');
    expect(component).toContain("view === 'api' ? <ApiDocsView /> : <FrontendDocsView />");
  });
});
