import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const parsedDbPort = Number.parseInt(process.env.DB_PORT ?? '5432', 10);
const dbPort = Number.isFinite(parsedDbPort) ? parsedDbPort : 5432;

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: dbPort,
    database: process.env.DB_NAME || 'tempo',
    user: process.env.DB_USER || 'tempo',
    password: process.env.DB_PASSWORD || 'tempo',
  },
});
