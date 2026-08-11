import { pool } from './pool.js';

export async function getAnnouncementChannel(guildId) {
  const { rows } = await pool.query(
    'select announcement_channel_id from guild_settings where guild_id = $1',
    [guildId],
  );
  return rows[0]?.announcement_channel_id ?? null;
}

/** Every guild that has an announcement channel configured — used by the
 * weekly reset scheduler to find every guild it needs to run the ritual
 * for, rather than hardcoding a single guild. */
export async function listAnnouncementChannels() {
  const { rows } = await pool.query(
    'select guild_id, announcement_channel_id from guild_settings where announcement_channel_id is not null',
  );
  return rows.map((row) => ({ guildId: row.guild_id, channelId: row.announcement_channel_id }));
}

export async function setAnnouncementChannel(guildId, channelId) {
  await pool.query(
    `insert into guild_settings (guild_id, announcement_channel_id)
     values ($1, $2)
     on conflict (guild_id) do update
       set announcement_channel_id = excluded.announcement_channel_id, updated_at = now()`,
    [guildId, channelId],
  );
}
