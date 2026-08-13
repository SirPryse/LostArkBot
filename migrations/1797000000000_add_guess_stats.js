export const shorthands = undefined;

/**
 * Lifetime /guess-parse attempt record — deliberately separate from
 * guess_game_scores (weekly leaderboard points, wiped every reset — see
 * weeklyReset.js's resetLeaderboard()). Win rate and total guesses are
 * meant to be a permanent running record on /my-stats, same lifetime
 * treatment as clear_history's percentile badges, not something that
 * resets weekly like the leaderboard itself does.
 */
export async function up(pgm) {
  pgm.createTable('guess_stats', {
    guild_id: { type: 'text', notNull: true },
    discord_user_id: { type: 'text', notNull: true },
    correct_guesses: { type: 'integer', notNull: true, default: 0 },
    total_guesses: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('guess_stats', 'guess_stats_pkey', {
    primaryKey: ['guild_id', 'discord_user_id'],
  });
}

export async function down(pgm) {
  pgm.dropTable('guess_stats');
}
