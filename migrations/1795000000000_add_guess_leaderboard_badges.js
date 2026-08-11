export const shorthands = undefined;

/**
 * **Bot-owned.** One row per top-3 finish awarded at each weekly reset —
 * same "one row per event" convention as clear_history, rather than a
 * running counter, so history (and the points they had at the time) is
 * preserved. /roster-page tallies these per rank the same way it already
 * tallies clear_history rows per percentile tier.
 */
export async function up(pgm) {
  pgm.createTable('guess_leaderboard_badges', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    guild_id: { type: 'text', notNull: true },
    discord_user_id: { type: 'text', notNull: true },
    rank: { type: 'integer', notNull: true },
    points: { type: 'integer', notNull: true },
    awarded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('guess_leaderboard_badges', 'guess_leaderboard_badges_rank_check', {
    check: 'rank in (1, 2, 3)',
  });

  pgm.createIndex('guess_leaderboard_badges', ['guild_id', 'discord_user_id']);
}

export async function down(pgm) {
  pgm.dropTable('guess_leaderboard_badges');
}
