import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '../..');
const outputDir = mkdtempSync(path.join(tmpdir(), 'praetor-production-build-'));

const run = async (command: string[]) => {
  const process = Bun.spawn(command, {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}\n${stderr}`.trim() };
};

afterAll(() => {
  const relativeToTemp = path.relative(tmpdir(), outputDir);
  if (relativeToTemp.startsWith('..') || path.isAbsolute(relativeToTemp)) {
    throw new Error(`Refusing to remove non-temporary build directory: ${outputDir}`);
  }
  rmSync(outputDir, { recursive: true, force: true });
});

describe('production bundle', () => {
  test('boots far enough to render the login form', async () => {
    const build = await run([
      process.execPath,
      'x',
      'vite',
      'build',
      '--outDir',
      outputDir,
      '--emptyOutDir',
    ]);
    expect(build.exitCode, build.output).toBe(0);

    const smoke = await run([process.execPath, 'scripts/verify-production-build.mjs', outputDir]);
    expect(smoke.exitCode, smoke.output).toBe(0);
    expect(smoke.output).toContain('login form rendered');
  }, 180_000);
});
