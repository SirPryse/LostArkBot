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

export async function updateLastSeen(id, lastSeenLogId) {
  await pool.query(
    `update tracked_characters
     set last_seen_log_id = $2, last_checked_at = now(), updated_at = now()
     where id = $1`,
    [id, lastSeenLogId],
  );
}

export async function touchLastChecked(id) {
  await pool.query(
    'update tracked_characters set last_checked_at = now(), updated_at = now() where id = $1',
    [id],
  );
}
