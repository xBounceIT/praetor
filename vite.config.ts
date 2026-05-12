import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import sirv from 'sirv';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };
import { getBuildDate } from './scripts/build-date.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const docsFrontendDir = path.resolve(__dirname, 'docs', 'frontend');
const docsUserDir = path.resolve(__dirname, 'docs-site', 'dist');

const docsStaticDevPlugin: Plugin = {
  name: 'docs-static-dev',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/docs/frontend' || req.url === '/docs/frontend/') {
        req.url = '/docs/frontend/index.html';
      } else if (req.url === '/docs' || req.url === '/docs/') {
        req.url = '/docs/index.html';
      }
      next();
    });
    if (existsSync(docsFrontendDir)) {
      server.middlewares.use(
        '/docs/frontend',
        sirv(docsFrontendDir, { dev: true, etag: true, extensions: ['html'] }),
      );
    }
    if (existsSync(docsUserDir)) {
      server.middlewares.use(
        '/docs',
        sirv(docsUserDir, { dev: true, etag: true, extensions: ['html'] }),
      );
    }
  },
};

const copyDirectoryIfPresent = (sourceDir: string, targetDir: string) => {
  if (!existsSync(sourceDir)) return;
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true });
};

const docsStaticBuildPlugin = (): Plugin => {
  let rootDir = __dirname;
  let outDir = 'dist';
  return {
    name: 'docs-static-build',
    apply: 'build',
    configResolved(resolved) {
      rootDir = resolved.root;
      outDir = resolved.build.outDir;
    },
    closeBundle() {
      copyDirectoryIfPresent(docsUserDir, path.resolve(rootDir, outDir, 'docs'));
      copyDirectoryIfPresent(docsFrontendDir, path.resolve(rootDir, outDir, 'docs', 'frontend'));
    },
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const preserveSymlinks = env.VITE_PRESERVE_SYMLINKS === 'true';
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [tailwindcss(), react(), docsStaticDevPlugin, docsStaticBuildPlugin()],
    define: {
      'process.env.APP_VERSION': JSON.stringify(pkg.version),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
      'import.meta.env.VITE_BUILD_DATE': JSON.stringify(getBuildDate()),
      'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || '/api'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      preserveSymlinks,
    },
  };
});
