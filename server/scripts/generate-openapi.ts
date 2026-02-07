import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import buildApp from '../app.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');
const outputDir = path.join(rootDir, 'docs', 'api');
const outputFile = path.join(outputDir, 'openapi.json');

const app = await buildApp();
await app.ready();

const spec = app.swagger();

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputFile, JSON.stringify(spec, null, 2));

await app.close();
