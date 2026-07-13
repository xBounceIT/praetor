import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator/lib/index.js';

const buildDir = path.resolve(process.argv[2] ?? 'dist');
const indexPath = path.join(buildDir, 'index.html');

const waitFor = async (predicate, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
};

const verifyProductionBuild = async () => {
  if (!existsSync(indexPath)) {
    throw new Error(`Production entrypoint not found: ${indexPath}`);
  }

  const indexHtml = readFileSync(indexPath, 'utf8');
  const entrySource = indexHtml.match(
    /<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i,
  )?.[1];
  if (!entrySource) {
    throw new Error(`Module entrypoint not found in ${indexPath}`);
  }

  const entryPath = path.resolve(buildDir, entrySource.replace(/^\/+/, ''));
  if (!existsSync(entryPath)) {
    throw new Error(`Production bundle not found: ${entryPath}`);
  }

  GlobalRegistrator.register({ url: 'http://localhost/' });
  document.body.innerHTML = '<div id="root"></div>';

  // Keep the smoke test independent from a running API. An unauthenticated boot
  // must still render the login form after its public/auth probes settle.
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });

  await import(pathToFileURL(entryPath).href);

  const rendered = await waitFor(
    () =>
      document.querySelector('input[name="username"]') !== null &&
      document.querySelector('input[name="password"]') !== null,
  );
  if (!rendered) {
    throw new Error('Production bundle loaded without rendering the login form');
  }

  console.log('Production bundle smoke test passed: login form rendered.');
};

verifyProductionBuild().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
