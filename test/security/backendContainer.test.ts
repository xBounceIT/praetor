import { describe, expect, test } from 'bun:test';

const dockerfile = await Bun.file(new URL('../../server/Dockerfile', import.meta.url)).text();
const dependabot = await Bun.file(new URL('../../.github/dependabot.yml', import.meta.url)).text();

const baseImages = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((match) => match[1]);
const dockerDependabotUpdate = dependabot
  .split(/\r?\n(?= {2}- package-ecosystem:)/)
  .find((update) => /package-ecosystem:\s*docker/.test(update));

describe('backend container supply-chain safety', () => {
  test('pins every Bun base image to an immutable digest', () => {
    expect(baseImages.length).toBeGreaterThan(0);

    for (const image of baseImages) {
      expect(image).toMatch(/^oven\/bun:[^@\s]+@sha256:[0-9a-f]{64}$/);
    }
  });

  test('keeps pinned Docker image digests current through Dependabot', () => {
    expect(dockerDependabotUpdate).toBeDefined();
    expect(dockerDependabotUpdate).toMatch(/directory:\s*\/server/);
    expect(dockerDependabotUpdate).toMatch(/interval:\s*weekly/);
  });
});
