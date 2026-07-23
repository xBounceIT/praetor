import { describe, expect, test } from 'bun:test';

const dockerfile = await Bun.file(new URL('../Dockerfile', import.meta.url)).text();

describe('backend production image', () => {
  test('sets NODE_ENV=production in the release stage', () => {
    const releaseStage = dockerfile.split(/^FROM .+ AS release$/m)[1];

    expect(releaseStage).toBeDefined();
    expect(releaseStage).toMatch(/^ENV NODE_ENV=production$/m);
  });
});
