import { describe, expect, test } from 'bun:test';

const dockerfile = await Bun.file(new URL('../Dockerfile', import.meta.url)).text();
const baseImages = dockerfile
  .split(/\r?\n/)
  .map((line) => line.match(/^\s*FROM(?:\s+--\S+)*\s+(\S+)/i)?.[1])
  .filter((image): image is string => image !== undefined);

describe('Dockerfile base images', () => {
  test('pins every image tag to an immutable SHA-256 digest', () => {
    expect(baseImages).not.toHaveLength(0);

    for (const image of baseImages) {
      expect(image).toMatch(/^[^@\s]+:[^@\s]+@sha256:[a-f0-9]{64}$/);
    }
  });
});
