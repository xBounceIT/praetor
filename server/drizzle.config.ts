import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { getDbConnectionConfig, getDbSslConfig } from './db/config.ts';

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    ...getDbConnectionConfig(),
    ssl: getDbSslConfig(),
  },
});
