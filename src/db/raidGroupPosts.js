import { pool } from './pool.js';

/**
 * Tries to claim (guild_id, log_id). Returns { won: true } if this call
 * created the row (caller is responsible for posting the message and then
 * calling setMessage), or { won: false } if someone else already has.
 */
export async function claim(guildId, logId) {
  const { rows } = await pool.query(
    `insert into raid_group_posts (guild_id, log_id)
     values ($1, $2)
     on conflict (guild_id, log_id) do nothing
     returning *`,
    [guildId, logId],
  );
  return { won: rows.length > 0 };
}

export async function setMessage(guildId, logId, channelId, messageId) {
  await pool.query(
    'update raid_group_posts set channel_id = $3, message_id = $4 where guild_id = $1 and log_id = $2',
    [guildId, logId, channelId, messageId],
  );
}

/** Drops claims older than `days`. A group post only matters while party
 * members' clears are still arriving (minutes to hours), and the weekly
 * channel clear deletes the messages themselves anyway — without this the
 * table grew forever (2,454 rows by Nov 2026). Returns rows removed. */
export async function pruneOlderThan(days) {
  const { rowCount } = await pool.query(
    'delete from raid_group_posts where created_at < now() - make_interval(days => $1)',
    [days],
  );
  return rowCount;
}

export async function get(guildId, logId) {
  const { rows } = await pool.query(
    'select * from raid_group_posts where guild_id = $1 and log_id = $2',
    [guildId, logId],
  );
  return rows[0] ?? null;
}
