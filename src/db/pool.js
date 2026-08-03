import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

const isLocal = /localhost|127\.0\.0\.1/.test(config.databaseUrl);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  // Supabase (and most hosted Postgres) requires SSL; local dev typically doesn't.
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});
