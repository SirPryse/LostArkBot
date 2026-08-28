export const shorthands = undefined;

/**
 * Redesign: a challenge is now one gate, not a whole raid family — "1 gate,
 * one challenge," per explicit request, since a multi-gate challenge could
 * stall forever on a gate the player simply never re-clears (Lost Ark lets
 * you skip a gate you've already cleared, which generates no fresh log
 * entry at all — see git history for the fuller explanation). A character
 * can now have *multiple* active challenges at once (one per gate) —
 * accepting a new one only abandons a still-active *duplicate* (same
 * character + boss + difficulty), not every other active challenge.
 *
 * This also collapses "progress vs. complete" into a single outcome: with
 * exactly one gate, the first matching clear either completes the
 * challenge (met) or fails it (missed) — there's no more intermediate
 * "some gates done" state, so `gates` (a JSONB array, always exactly one
 * element in practice already) is replaced with flat columns.
 *
 * No real data has ever been written to this table outside of tests (this
 * feature isn't deployed yet), so this drops and recreates it rather than
 * an in-place ALTER — simpler, and there's nothing real to preserve.
 */
export async function up(pgm) {
  pgm.dropTable('challenges');

  pgm.createTable('challenges', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tracked_character_id: {
      type: 'uuid',
      notNull: true,
      references: 'tracked_characters',
      onDelete: 'cascade',
    },
    family_key: { type: 'text', notNull: true },
    difficulty: { type: 'text', notNull: true },
    gate_index: { type: 'integer', notNull: true },
    boss_name: { type: 'text', notNull: true },
    role: { type: 'text', notNull: true },
    // { udps } for a DPS gate, or { contribution, buffs: [4 nullable
    // values] } for support — see challenge.js's computeTargets.
    targets: { type: 'jsonb', notNull: true },
    sample_size: { type: 'integer', notNull: true },
    status: { type: 'text', notNull: true, default: 'active' },
    met: { type: 'boolean', notNull: true, default: false },
    met_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz' },
  });

  pgm.addConstraint('challenges', 'challenges_status_check', {
    check: "status in ('active', 'completed', 'abandoned', 'failed')",
  });

  // poller.js fetches every active challenge for a character each tick.
  pgm.createIndex('challenges', ['tracked_character_id', 'status']);
}

export async function down(pgm) {
  pgm.dropTable('challenges');

  pgm.createTable('challenges', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tracked_character_id: {
      type: 'uuid',
      notNull: true,
      references: 'tracked_characters',
      onDelete: 'cascade',
    },
    family_key: { type: 'text', notNull: true },
    difficulty: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'active' },
    gates: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('challenges', 'challenges_status_check', {
    check: "status in ('active', 'completed', 'abandoned', 'failed')",
  });
  pgm.createIndex('challenges', ['tracked_character_id', 'status']);
}
