import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

const isLocal = /localhost|127\.0\.0\.1/.test(config.databaseUrl);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  // Supabase (and most hosted Postgres) requires SSL; local dev typically doesn't.
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

// An idle pooled connection can be dropped server-side (Supabase restarts,
// network blips). pg reports that as an 'error' event on the pool, and an
// EventEmitter 'error' with no listener throws — which used to take the
// whole bot down via uncaughtException. The broken client is discarded by
// pg itself; the next query just opens a fresh connection.
pool.on('error', (err) => {
  console.error('Postgres pool: idle client error (connection will be replaced):', err.message);
});
