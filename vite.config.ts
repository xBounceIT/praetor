import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import sirv from 'sirv';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import pkg from './package.json';

// Generate build date in yyyymmdd format
const getBuildDate = () => {
  const year = '2026';
  const month = '02';
  const day = '09';
  return `${year}${month}${day}`;
};

const docsFrontendDir = path.resolve(__dirname, 'docs', 'frontend');

const docsFrontendDevPlugin: Plugin = {
  name: 'docs-frontend-dev',
  apply: 'serve',
  configureServer(server) {
    if (!existsSync(docsFrontendDir)) return;
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/docs/frontend' || req.url === '/docs/frontend/') {
        req.url = '/docs/frontend/index.html';
      }
      next();
    });
    server.middlewares.use(
      '/docs/frontend',
      sirv(docsFrontendDir, { dev: true, etag: true, extensions: ['html'] }),
    );
  },
};

const docsFrontendBuildPlugin = (): Plugin => {
  let rootDir = __dirname;
  let outDir = 'dist';
  return {
    name: 'docs-frontend-build',
    apply: 'build',
    configResolved(resolved) {
      rootDir = resolved.root;
      outDir = resolved.build.outDir;
    },
    closeBundle() {
      if (!existsSync(docsFrontendDir)) return;
      const targetDir = path.resolve(rootDir, outDir, 'docs', 'frontend');
      mkdirSync(targetDir, { recursive: true });
      cpSync(docsFrontendDir, targetDir, { recursive: true });
    },
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [tailwindcss(), react(), docsFrontendDevPlugin, docsFrontendBuildPlugin()],
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
    },
  };
});
