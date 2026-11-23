// Loaded before any test (`node --import ./test/env.js --test`). Modules
// that read src/config.js need these to exist; setting them here first
// also means dotenv never fills them from a real .env, so tests can't reach
// the production database, Discord or lostark.bible. Nothing here connects
// anywhere — pg's pool only connects on the first query.
const DUMMY = {
  DISCORD_TOKEN: 'test-token',
  DISCORD_CLIENT_ID: '000000000000000000',
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  ENCRYPTION_KEY: '0'.repeat(64),
  LA_BIBLE_CLIENT_ID: 'test-client',
  LA_BIBLE_BASE_URL: 'http://localhost:1',
};
for (const [key, value] of Object.entries(DUMMY)) process.env[key] = value;
