import { pool } from './pool.js';

/** Records one top-3 finish at a weekly reset — called once per awarded
 * rank, right before the leaderboard itself gets wiped. */
export async function awardBadge(guildId, discordUserId, rank, points) {
  await pool.query(
    'insert into guess_leaderboard_badges (guild_id, discord_user_id, rank, points) values ($1, $2, $3, $4)',
    [guildId, discordUserId, rank, points],
  );
}

/** How many times this account has placed 1st/2nd/3rd in this guild's
 * weekly guess-parse leaderboard, all-time — kept as its own tally, wholly
 * separate from clear_history's percentile-tier badges (/roster-page shows
 * them as two distinct fields, not merged). */
export async function getBadgeCounts(guildId, discordUserId) {
  const { rows } = await pool.query(
    'select rank, count(*)::int as count from guess_leaderboard_badges where guild_id = $1 and discord_user_id = $2 group by rank',
    [guildId, discordUserId],
  );

  const counts = { 1: 0, 2: 0, 3: 0 };
  for (const row of rows) counts[row.rank] = row.count;
  return counts;
}
