import { describe, expect, test } from 'bun:test';

const workflow = await Bun.file(
  new URL('../../.github/workflows/create-release.yml', import.meta.url),
).text();
const metadataStepMarker = '      - name: Resolve image metadata';
const metadataStepIndex = workflow.indexOf(metadataStepMarker);
if (metadataStepIndex < 0) throw new Error('Resolve image metadata step not found');
const nextStepIndex = workflow.indexOf(
  '\n      - name:',
  metadataStepIndex + metadataStepMarker.length,
);
const metadataStep = workflow.slice(
  metadataStepIndex,
  nextStepIndex < 0 ? undefined : nextStepIndex,
);
const metadataScript = metadataStep.slice(metadataStep.indexOf('        run: |'));

describe('release workflow image metadata', () => {
  test('passes the dispatch version through the environment before Bash parses it', () => {
    expect(metadataStep).toContain(`DISPATCH_VERSION: \${{ inputs.version }}`);
    expect(metadataScript).not.toContain(`\${{ inputs.version }}`);
    expect(metadataScript).toContain(`VERSION="\${DISPATCH_VERSION}"`);
  });

  test('rejects versions outside the supported release-tag format', () => {
    expect(metadataScript).toContain(
      `[[ ! "\${VERSION}" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]`,
    );
    expect(metadataScript).toContain('exit 1');
  });

  test('validates the version before privileged release and registry steps', () => {
    expect(metadataStepIndex).toBeLessThan(workflow.indexOf('      - name: Create Release'));
    expect(metadataStepIndex).toBeLessThan(workflow.indexOf('      - name: Login to GHCR'));
  });
});
