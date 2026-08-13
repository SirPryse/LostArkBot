import { pool } from './pool.js';

/** Records one guess attempt (right or wrong) — lifetime, never reset by
 * the weekly leaderboard reset, unlike guess_game_scores. total_guesses
 * always increments; correct_guesses only increments when `correct` is
 * true. */
export async function recordGuess(guildId, discordUserId, correct) {
  await pool.query(
    `insert into guess_stats (guild_id, discord_user_id, correct_guesses, total_guesses)
     values ($1, $2, $3, 1)
     on conflict (guild_id, discord_user_id) do update
       set correct_guesses = guess_stats.correct_guesses + excluded.correct_guesses,
           total_guesses = guess_stats.total_guesses + 1,
           updated_at = now()`,
    [guildId, discordUserId, correct ? 1 : 0],
  );
}

/** Defaults to all-zero rather than null when nobody's guessed yet in this
 * guild — matches getBadgeCounts()'s "always return a usable shape"
 * convention in guessLeaderboardBadges.js. */
export async function getGuessStats(guildId, discordUserId) {
  const { rows } = await pool.query(
    `select correct_guesses, total_guesses from guess_stats where guild_id = $1 and discord_user_id = $2`,
    [guildId, discordUserId],
  );
  return rows[0] ?? { correct_guesses: 0, total_guesses: 0 };
}
