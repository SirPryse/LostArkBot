import { pool } from './pool.js';

export async function addPoints(guildId, discordUserId, points) {
  await pool.query(
    `insert into guess_game_scores (guild_id, discord_user_id, points)
     values ($1, $2, $3)
     on conflict (guild_id, discord_user_id) do update
       set points = guess_game_scores.points + excluded.points, updated_at = now()`,
    [guildId, discordUserId, points],
  );
}

export async function getLeaderboard(guildId, limit = 10) {
  const { rows } = await pool.query(
    `select discord_user_id, points
     from guess_game_scores
     where guild_id = $1
     order by points desc, updated_at asc
     limit $2`,
    [guildId, limit],
  );
  return rows;
}

/** Wipes the whole leaderboard for a guild — called at the weekly reset,
 * after the top 3 have already been read out for badge-awarding and the
 * announcement embed. */
export async function resetLeaderboard(guildId) {
  await pool.query('delete from guess_game_scores where guild_id = $1', [guildId]);
}
