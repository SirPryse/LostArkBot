import 'dotenv/config';
import runner from 'node-pg-migrate';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const direction = process.argv[2] === 'down' ? 'down' : 'up';

await runner({
  databaseUrl: process.env.DATABASE_URL,
  dir: path.join(__dirname, '..', 'migrations'),
  direction,
  migrationsTable: 'pgmigrations',
  count: direction === 'down' ? 1 : Infinity,
});

process.exit(0);
