// Sanity-checks .env without starting the bot (no Discord gateway login, no
// poller) and without writing anything: the DB checks run inside a
// READ ONLY transaction. Never prints secret values.
//
//   npm run check-env
import 'dotenv/config';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecipheriv } from 'node:crypto';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
let failures = 0;

const ok = (msg) => console.log(`  OK    ${msg}`);
const warn = (msg) => console.log(`  WARN  ${msg}`);
const fail = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};

// --- 1. Presence/format -----------------------------------------------------
console.log('\n[1] Required variables');
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DATABASE_URL', 'ENCRYPTION_KEY', 'LA_BIBLE_CLIENT_ID']) {
  if (env[name]?.trim()) ok(`${name} is set`);
  else fail(`${name} is empty`);
}
if (env.ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_KEY.trim())) {
  fail('ENCRYPTION_KEY must be exactly 64 hex characters');
}
if (env.DISCORD_CLIENT_ID && !/^\d{17,20}$/.test(env.DISCORD_CLIENT_ID.trim())) {
  fail('DISCORD_CLIENT_ID should be a numeric snowflake (17-20 digits)');
}
for (const name of ['GOLD_EARNER_POLL_INTERVAL_MINUTES', 'OTHER_POLL_INTERVAL_MINUTES', 'CHALLENGE_EXPIRY_CHECK_INTERVAL_MINUTES', 'OAUTH_PORT']) {
  if (env[name] && !(Number(env[name]) > 0)) fail(`${name} must be a positive number`);
}

// --- 2. Discord -------------------------------------------------------------
console.log('\n[2] Discord');
if (env.DISCORD_TOKEN) {
  try {
    const res = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
      headers: { Authorization: `Bot ${env.DISCORD_TOKEN.trim()}` },
    });
    if (res.status === 401) fail('DISCORD_TOKEN rejected by Discord (401) — reset it in the Developer Portal');
    else if (!res.ok) fail(`Discord returned ${res.status}`);
    else {
      const app = await res.json();
      ok(`token valid — application "${app.name}", bot user "${app.bot?.username ?? '?'}"`);
      if (env.DISCORD_CLIENT_ID && app.id !== env.DISCORD_CLIENT_ID.trim()) {
        fail(`DISCORD_CLIENT_ID does not match this token's application (token belongs to ${app.id})`);
      } else if (env.DISCORD_CLIENT_ID) ok('DISCORD_CLIENT_ID matches the token');
      warn('if this is the PRODUCTION bot, do not `npm run dev` while Fly is running');
    }
  } catch (err) {
    fail(`could not reach Discord: ${err.message}`);
  }
}

// --- 3. Postgres (read-only) -----------------------------------------------
console.log('\n[3] Database (read-only)');
if (env.DATABASE_URL) {
  const isLocal = /localhost|127\.0\.0\.1/.test(env.DATABASE_URL);
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows: [{ db, version }] } = await client.query(
      `SELECT current_database() AS db, split_part(version(), ' ', 2) AS version`,
    );
    ok(`connected to "${db}" (Postgres ${version})${isLocal ? ' [local]' : ' [remote — probably production]'}`);

    // Migrations applied vs. in repo
    const repoMigrations = fs
      .readdirSync(path.join(__dirname, '..', 'migrations'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => f.replace(/\.js$/, ''));
    const hasTable = (await client.query(`SELECT to_regclass('public.pgmigrations') AS t`)).rows[0].t;
    if (!hasTable) {
      warn('no pgmigrations table — empty DB, run `npm run migrate`');
    } else {
      const applied = new Set((await client.query('SELECT name FROM pgmigrations')).rows.map((r) => r.name));
      const pending = repoMigrations.filter((m) => !applied.has(m));
      if (pending.length) warn(`${pending.length} migration(s) not applied: ${pending.join(', ')}`);
      else ok(`all ${repoMigrations.length} migrations applied`);

      const counts = await client.query(`
        SELECT
          (SELECT count(*) FROM linked_accounts) AS accounts,
          (SELECT count(*) FROM linked_accounts WHERE status = 'active') AS active_accounts,
          (SELECT count(*) FROM tracked_characters) AS characters,
          (SELECT count(*) FROM tracked_characters WHERE enabled) AS enabled_characters
      `);
      const c = counts.rows[0];
      ok(`${c.accounts} linked accounts (${c.active_accounts} active), ${c.characters} tracked characters (${c.enabled_characters} enabled)`);

      // ENCRYPTION_KEY check: try to decrypt one stored token (value never printed)
      const keyOk = env.ENCRYPTION_KEY && /^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_KEY.trim());
      const sample = (await client.query(
        `SELECT access_token FROM linked_accounts WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1`,
      )).rows[0];
      if (!sample) warn('no linked accounts to test ENCRYPTION_KEY against');
      else if (keyOk) {
        try {
          const [iv, tag, data] = sample.access_token.split(':');
          const d = createDecipheriv('aes-256-gcm', Buffer.from(env.ENCRYPTION_KEY.trim(), 'hex'), Buffer.from(iv, 'base64'));
          d.setAuthTag(Buffer.from(tag, 'base64'));
          const token = Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
          ok('ENCRYPTION_KEY decrypts stored access tokens');
          globalThis.__sampleToken = token;
        } catch {
          fail('ENCRYPTION_KEY cannot decrypt stored tokens — it does not match the key this DB was written with');
        }
      }
    }
    await client.query('ROLLBACK');
  } catch (err) {
    fail(`database: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

// --- 4. lostark.bible -------------------------------------------------------
console.log('\n[4] lostark.bible');
const base = env.LA_BIBLE_BASE_URL || 'https://lostark.bible';
try {
  const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
  if (res.ok) ok(`${base} OAuth metadata reachable`);
  else fail(`${base} OAuth metadata returned ${res.status}`);
} catch (err) {
  fail(`could not reach ${base}: ${err.message}`);
}
if (globalThis.__sampleToken) {
  try {
    const res = await fetch(`${base}/api/oauth/rosters`, {
      headers: { Authorization: `Bearer ${globalThis.__sampleToken}` },
    });
    if (res.ok) ok('a stored access token works against /api/oauth/rosters');
    else if (res.status === 401) warn('sampled stored token is expired/revoked (401) — that user needs /link-account');
    else warn(`/api/oauth/rosters returned ${res.status}`);
  } catch (err) {
    fail(`rosters call failed: ${err.message}`);
  }
}

// --- 5. OAuth callback port -------------------------------------------------
console.log('\n[5] OAuth callback server');
const port = Number(env.OAUTH_PORT || 3000);
await new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => {
    fail(`port ${port} is already in use`);
    resolve();
  });
  srv.listen(port, () => srv.close(() => {
    ok(`port ${port} is free`);
    resolve();
  }));
});
const redirect = env.OAUTH_REDIRECT_URI || 'http://localhost:3000/oauth/callback';
if (!redirect.endsWith('/oauth/callback')) warn(`OAUTH_REDIRECT_URI should end with /oauth/callback (got ${redirect})`);
if (/localhost/.test(redirect)) warn('/link-account locally needs this localhost URI registered for LA_BIBLE_CLIENT_ID on lostark.bible');

console.log(failures ? `\n${failures} problem(s) found.\n` : '\nAll checks passed.\n');
process.exit(failures ? 1 : 0);
