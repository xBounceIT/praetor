import { describe, expect, test } from 'bun:test';

const workflow = await Bun.file(new URL('../../.github/workflows/ci.yml', import.meta.url)).text();
const dependabot = await Bun.file(new URL('../../.github/dependabot.yml', import.meta.url)).text();
const scanStepMarker = '      - name: Scan postgres logs for FATAL/PANIC';
const scanStepIndex = workflow.indexOf(scanStepMarker);
if (scanStepIndex < 0) throw new Error('Postgres log scan step not found');
const nextStepIndex = workflow.indexOf('\n      - name:', scanStepIndex + scanStepMarker.length);
const scanStep = workflow.slice(scanStepIndex, nextStepIndex < 0 ? undefined : nextStepIndex);
const remoteActionReferences = [
  ...workflow.matchAll(/^[ \t]*(?:-[ \t]+)?uses:[ \t]+([^ \t#\r\n]+)/gm),
]
  .map((match) => match[1])
  .filter((reference) => !reference.startsWith('./'));

describe('CI action supply-chain safety', () => {
  test('pins every remote action to a full commit SHA', () => {
    expect(remoteActionReferences.length).toBeGreaterThan(0);

    for (const reference of remoteActionReferences) {
      expect(reference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    }
  });

  test('keeps pinned actions current through Dependabot', () => {
    expect(dependabot).toMatch(/package-ecosystem:\s*github-actions/);
    expect(dependabot).toMatch(/interval:\s*weekly/);
  });
});

describe('CI Postgres log scan', () => {
  test('ignores expected startup and shutdown FATAL messages', () => {
    expect(scanStep).toContain(`grep -vF 'the database system is starting up'`);
    expect(scanStep).toContain(`grep -vF 'the database system is shutting down'`);
  });

  test('still fails on other FATAL or PANIC messages', () => {
    expect(scanStep).toContain(`grep -nE '\\b(FATAL|PANIC):' logs/postgres.log`);
    expect(scanStep).toContain('Postgres logged an unexpected FATAL or PANIC');
    expect(scanStep).toContain('exit 1');
  });
});
