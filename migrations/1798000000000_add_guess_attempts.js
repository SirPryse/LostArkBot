export const shorthands = undefined;

/**
 * Replaces guess_game_scores (weekly leaderboard, aggregate counter reset
 * every week by deleting rows) and guess_stats (lifetime win-rate, a
 * separate aggregate counter) with one event-log table — one row per guess
 * attempt, same "one row per event" convention clear_history and
 * guess_leaderboard_badges already use elsewhere in this schema. Both the
 * weekly leaderboard and the lifetime stats read off the *same* table now,
 * just filtered by a different time window (created_at >= the guild's
 * current week boundary for weekly, no bound at all for lifetime) — one
 * source of truth instead of two counters that could drift out of sync
 * with each other.
 *
 * This also makes the weekly reset's explicit "delete every row" step
 * unnecessary — once claimWeeklyReset() moves guild_settings.last_reset_at
 * forward, the next week's leaderboard query just naturally excludes
 * everything before that boundary. Nothing needs to be deleted at reset
 * time.
 *
 * Backfills real data from both tables being dropped (confirmed with the
 * user rather than silently discarding it) — best-effort, since neither
 * old table tracked real per-guess timestamps:
 *   - guess_game_scores only ever tracked a cumulative point total (no
 *     guess count), so each user's current total becomes one synthetic
 *     lump-sum event.
 *   - guess_stats tracked exact correct/total counts, so it backfills more
 *     faithfully: one synthetic row per real guess it recorded.
 * Every backfilled row is dated "now" — real historical dates were never
 * captured, and the user confirmed that's fine rather than leaving the
 * data out entirely.
 */
export async function up(pgm) {
  pgm.createTable('guess_attempts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    guild_id: { type: 'text', notNull: true },
    discord_user_id: { type: 'text', notNull: true },
    correct: { type: 'boolean', notNull: true },
    points: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Every query filters by (guild_id, created_at) — either the weekly
  // leaderboard's time-windowed GROUP BY or the lifetime stats' unbounded
  // one, both scoped to a single guild first.
  pgm.createIndex('guess_attempts', ['guild_id', 'created_at']);

  pgm.sql(`
    insert into guess_attempts (guild_id, discord_user_id, correct, points, created_at)
    select guild_id, discord_user_id, true, points, now()
    from guess_game_scores
    where points > 0
  `);

  pgm.sql(`
    insert into guess_attempts (guild_id, discord_user_id, correct, points, created_at)
    select guild_id, discord_user_id, true, 0, now()
    from guess_stats, generate_series(1, correct_guesses)
    where correct_guesses > 0
  `);
  pgm.sql(`
    insert into guess_attempts (guild_id, discord_user_id, correct, points, created_at)
    select guild_id, discord_user_id, false, 0, now()
    from guess_stats, generate_series(1, total_guesses - correct_guesses)
    where total_guesses - correct_guesses > 0
  `);

  pgm.dropTable('guess_game_scores');
  pgm.dropTable('guess_stats');
}

/** Not meaningfully reversible — backfilled/aggregated data can't be
 * reconstructed from the event log once collapsed. Recreates both old
 * tables empty, matching their prior shape, just so a rollback leaves a
 * valid schema rather than restoring any data. */
export async function down(pgm) {
  pgm.createTable('guess_game_scores', {
    guild_id: { type: 'text', notNull: true },
    discord_user_id: { type: 'text', notNull: true },
    points: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('guess_game_scores', 'guess_game_scores_pkey', { primaryKey: ['guild_id', 'discord_user_id'] });

  pgm.createTable('guess_stats', {
    guild_id: { type: 'text', notNull: true },
    discord_user_id: { type: 'text', notNull: true },
    correct_guesses: { type: 'integer', notNull: true, default: 0 },
    total_guesses: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('guess_stats', 'guess_stats_pkey', { primaryKey: ['guild_id', 'discord_user_id'] });

  pgm.dropTable('guess_attempts');
}
