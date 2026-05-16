import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf8');

describe('reports/ai-reporting pending render (issue #520)', () => {
  test('isActiveModulePending stays true while waiting for generalSettings', () => {
    const start = source.indexOf('const isActiveModulePending');
    expect(start).toBeGreaterThan(-1);
    const semicolon = source.indexOf(';', start);
    const declaration = source.slice(start, semicolon);

    // Must extend the pending gate with the ai-reporting-specific wait so the
    // generic loading state covers the gap before generalSettings loads.
    expect(declaration).toMatch(
      /activeView === 'reports\/ai-reporting'[\s\S]*?!hasLoadedGeneralSettings[\s\S]*?!reportsSettingsFailed/,
    );
  });

  test('reportsSettingsFailed is defined before isActiveModulePending so it can be referenced', () => {
    const failedIdx = source.indexOf('const reportsSettingsFailed');
    const pendingIdx = source.indexOf('const isActiveModulePending');
    expect(failedIdx).toBeGreaterThan(-1);
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(failedIdx).toBeLessThan(pendingIdx);
  });

  test('ai-reporting render block no longer renders its own pending spinner', () => {
    // Anchor on the JSX-level render of the AI reporting block; earlier
    // occurrences of `reports/ai-reporting` belong to the routing/access logic.
    const blockStart = source.indexOf("{activeView === 'reports/ai-reporting' &&");
    expect(blockStart).toBeGreaterThan(-1);
    const blockEnd = source.indexOf('))}', blockStart);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const block = source.slice(blockStart, blockEnd);

    expect(block).toContain('reportsSettingsFailed');
    expect(block).toContain('<AiReportingView');
    // The inline ai-reporting spinner used to use this translation key and
    // `fa-circle-notch fa-spin` icon. Both must be gone — pending state now
    // flows through the generic isActiveModulePending spinner instead.
    expect(block).not.toContain("tApp('common:states.loading')");
    expect(block).not.toContain('fa-circle-notch fa-spin');
  });
});
