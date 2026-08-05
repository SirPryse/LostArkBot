import { pool } from './pool.js';

/**
 * Returns every enabled tracked character joined with its linked account,
 * for the scheduler to fan out one poll job per row.
 */
export async function listEnabledWithAccount() {
  const { rows } = await pool.query(`
    select
      tc.id,
      tc.character_name,
      tc.region,
      tc.guild_id,
      tc.last_seen_log_id,
      tc.view_mode,
      la.id as linked_account_id,
      la.access_token,
      la.token_expires_at,
      la.status as account_status
    from tracked_characters tc
    join linked_accounts la on la.id = tc.linked_account_id
    where tc.enabled = true
  `);
  return rows;
}

export async function getEnabledWithAccountById(id) {
  const { rows } = await pool.query(
    `select
      tc.id,
      tc.character_name,
      tc.region,
      tc.guild_id,
      tc.last_seen_log_id,
      tc.view_mode,
      la.id as linked_account_id,
      la.access_token,
      la.token_expires_at,
      la.status as account_status
    from tracked_characters tc
    join linked_accounts la on la.id = tc.linked_account_id
    where tc.enabled = true and tc.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getEnabledByGuildAndName(guildId, characterName) {
  const { rows } = await pool.query(
    `select
      tc.id,
      tc.character_name,
      tc.region,
      tc.guild_id,
      la.id as linked_account_id,
      la.access_token,
      la.token_expires_at,
      la.status as account_status
    from tracked_characters tc
    join linked_accounts la on la.id = tc.linked_account_id
    where tc.enabled = true and tc.guild_id = $1 and lower(tc.character_name) = lower($2)
    limit 1`,
    [guildId, characterName],
  );
  return rows[0] ?? null;
}

export async function listByGuild(guildId) {
  const { rows } = await pool.query(
    `select
      tc.character_name,
      tc.region,
      tc.enabled,
      la.discord_user_id,
      la.status as account_status
    from tracked_characters tc
    join linked_accounts la on la.id = tc.linked_account_id
    where tc.guild_id = $1
    order by tc.created_at`,
    [guildId],
  );
  return rows;
}

export async function listByLinkedAccountAndGuild(linkedAccountId, guildId) {
  const { rows } = await pool.query(
    `select id, character_name, region, view_mode
     from tracked_characters
     where linked_account_id = $1 and guild_id = $2 and enabled = true
     order by character_name`,
    [linkedAccountId, guildId],
  );
  return rows;
}

/** Ownership-scoped lookup — used before showing anything derived from a
 * specific tracked_characters row, so a user can only ever act on their own. */
export async function getByIdForOwner(id, linkedAccountId) {
  const { rows } = await pool.query(
    'select * from tracked_characters where id = $1 and linked_account_id = $2',
    [id, linkedAccountId],
  );
  return rows[0] ?? null;
}

export async function remove(id, linkedAccountId) {
  await pool.query('delete from tracked_characters where id = $1 and linked_account_id = $2', [
    id,
    linkedAccountId,
  ]);
}

export async function create({ linkedAccountId, characterName, region, guildId, viewMode = 'competitive' }) {
  const { rows } = await pool.query(
    `insert into tracked_characters (linked_account_id, character_name, region, guild_id, view_mode)
     values ($1, $2, $3, $4, $5)
     on conflict (linked_account_id, character_name, region, guild_id) do update
       set enabled = true, view_mode = excluded.view_mode, updated_at = now()
     returning *`,
    [linkedAccountId, characterName, region, guildId, viewMode],
  );
  return rows[0];
}

export async function updateLastSeen(id, lastSeenLogId, { className, role } = {}) {
  await pool.query(
    `update tracked_characters
     set last_seen_log_id = $2, last_checked_at = now(), updated_at = now(),
         class_name = coalesce($3, class_name), role = coalesce($4, role)
     where id = $1`,
    [id, lastSeenLogId, className ?? null, role ?? null],
  );
}

export async function touchLastChecked(id) {
  await pool.query(
    'update tracked_characters set last_checked_at = now(), updated_at = now() where id = $1',
    [id],
  );
}
