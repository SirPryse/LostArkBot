export const shorthands = undefined;

/**
 * One row per (guild, Discord user) tracking their /guess-parse score —
 * separate from raid-performance data entirely, this is just a leaderboard
 * for the guessing game itself. `points` (not a plain win count) since a
 * correct guess is worth more on a harder difficulty (more info hidden).
 */
export async function up(pgm) {
  pgm.createTable('guess_game_scores', {
    guild_id: { type: 'text', notNull: true },
    discord_user_id: { type: 'text', notNull: true },
    points: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('guess_game_scores', 'guess_game_scores_pkey', {
    primaryKey: ['guild_id', 'discord_user_id'],
  });
}

export async function down(pgm) {
  pgm.dropTable('guess_game_scores');
}
