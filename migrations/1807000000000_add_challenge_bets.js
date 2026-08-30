export const shorthands = undefined;

/**
 * Powers the new "others bet on your challenge" mechanic: once a challenge
 * is Accepted it's posted publicly with Success/Failure buttons — anyone
 * *except* the challenger can bet on the outcome (enforced in
 * challenge.js, not here). `bet_channel_id`/`bet_message_id` remember where
 * that public post landed so poller.js can find and lock it (disable the
 * buttons, show the final tally) once the challenge resolves — both null
 * until a challenge is actually Accepted with an announcement channel
 * configured; see challenge.js's Accept handler.
 *
 * challenge_bets is intentionally its own table rather than a column on
 * challenges — one challenge can carry many bets (one per better), and a
 * better can change their mind any time before resolution (the unique
 * constraint below is what makes that an upsert instead of a stack of
 * rows). Accuracy is derived at read time (db/challengeBets.js's
 * getPredictionStats) by comparing predicted_outcome against the parent
 * challenge's resolved status rather than storing a redundant "was this
 * right" flag that could drift out of sync.
 */
export async function up(pgm) {
  pgm.addColumns('challenges', {
    bet_channel_id: { type: 'text' },
    bet_message_id: { type: 'text' },
  });

  pgm.createTable('challenge_bets', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    challenge_id: {
      type: 'uuid',
      notNull: true,
      references: 'challenges',
      onDelete: 'cascade',
    },
    discord_user_id: { type: 'text', notNull: true },
    predicted_outcome: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('challenge_bets', 'challenge_bets_predicted_outcome_check', {
    check: "predicted_outcome in ('success', 'failure')",
  });

  // One bet per person per challenge — re-betting updates this same row
  // (see upsertBet) rather than stacking a new one.
  pgm.addConstraint('challenge_bets', 'challenge_bets_unique_better', {
    unique: ['challenge_id', 'discord_user_id'],
  });

  // getPredictionStats looks up every bet a given Discord user has ever
  // placed, across every challenge.
  pgm.createIndex('challenge_bets', ['discord_user_id']);
}

export async function down(pgm) {
  pgm.dropTable('challenge_bets');
  pgm.dropColumns('challenges', ['bet_channel_id', 'bet_message_id']);
}
