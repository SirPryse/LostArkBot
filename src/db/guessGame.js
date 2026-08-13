import { pool } from './pool.js';

/** Records one guess attempt (right or wrong) as its own event row — one
 * row per guess, same "one row per event" convention clear_history and
 * guess_leaderboard_badges already use. Both the weekly leaderboard and
 * lifetime stats (see getLeaderboard/getLifetimeStats below) read off this
 * same table, just with a different time window, rather than two separate
 * counters that could drift out of sync with each other. */
export async function recordAttempt(guildId, discordUserId, correct, points) {
  await pool.query(
    'insert into guess_attempts (guild_id, discord_user_id, correct, points) values ($1, $2, $3, $4)',
    [guildId, discordUserId, correct, points],
  );
}

/** Points + guess count per user, highest points first — `since` scopes
 * the window: pass a guild's current week boundary (guild_settings's
 * last_reset_at) for "this week's" leaderboard, or null for no lower bound
 * (all-time). No explicit "reset" needed between weeks — once
 * claimWeeklyReset() moves the boundary forward, the next call with the
 * new `since` naturally excludes everything before it. */
export async function getLeaderboard(guildId, since, limit = 10) {
  const { rows } = await pool.query(
    `select discord_user_id, sum(points)::int as points, count(*)::int as guesses
     from guess_attempts
     where guild_id = $1 and ($2::timestamptz is null or created_at >= $2)
     group by discord_user_id
     order by points desc, min(created_at) asc
     limit $3`,
    [guildId, since, limit],
  );
  return rows;
}

/** Lifetime win rate / total guesses for one user — no time bound, unlike
 * getLeaderboard()'s weekly scoping, matching /my-stats' "permanent
 * record" framing (see myStats.js). */
export async function getLifetimeStats(guildId, discordUserId) {
  const { rows } = await pool.query(
    `select
       count(*) filter (where correct)::int as correct_guesses,
       count(*)::int as total_guesses
     from guess_attempts
     where guild_id = $1 and discord_user_id = $2`,
    [guildId, discordUserId],
  );
  return rows[0] ?? { correct_guesses: 0, total_guesses: 0 };
}
