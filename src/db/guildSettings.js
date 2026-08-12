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

// Guards weeklyReset.js against double-firing for the same guild — confirmed
// live this can happen (two full runWeeklyReset() cycles landed ~4s apart
// for the same guild, doubling everyone's badge count; exact trigger
// unconfirmed, but a redeploy racing the scheduled reset instant is the
// leading theory). 20 hours is comfortably wider than any plausible race
// window while leaving days of margin before the next legitimate weekly
// reset. This is a real Postgres-level claim, not an in-memory flag —
// an in-memory guard wouldn't help if the double-fire comes from two
// separate processes (e.g. old-dying + newly-deployed) rather than one
// process misbehaving, which is exactly the scenario suspected here.
const RESET_CLAIM_WINDOW_HOURS = 20;

/** Atomically claims the weekly reset for this guild — returns true if this
 * call successfully claimed it (i.e. no reset recorded within the last 20
 * hours), false if another call already claimed it recently and this one
 * should skip. Uses a conditional UPDATE...RETURNING rather than a
 * read-then-write check specifically so two concurrent callers can't both
 * pass the check before either writes — Postgres serializes the two
 * UPDATEs, so only one can match the WHERE clause and return a row. */
export async function claimWeeklyReset(guildId) {
  const { rows } = await pool.query(
    `update guild_settings
     set last_reset_at = now()
     where guild_id = $1 and (last_reset_at is null or last_reset_at < now() - make_interval(hours => $2))
     returning guild_id`,
    [guildId, RESET_CLAIM_WINDOW_HOURS],
  );
  return rows.length > 0;
}
