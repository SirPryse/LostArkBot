export const shorthands = undefined;

/**
 * One row per accepted /challenge — generated-but-not-accepted challenges
 * are never persisted (per explicit design: only an Accepted challenge
 * gets tracked/announced). `gates` is a JSONB array rather than a separate
 * child table — small, fixed shape, always read/written as a whole, and
 * this feature's scope doesn't warrant normalizing it further:
 *
 *   [{ gateIndex, bossName, role, targets, met, metAt }, ...]
 *
 * `targets` shape depends on `role`: `{ dps: number }` for a DPS gate, or
 * `{ contribution: number, buffs: [number|null, number|null, number|null,
 * number|null] }` for support (null buff slots = no historical data to set
 * a target from at generation time, so that slot isn't required to
 * "complete" the gate). All fractions (0-1), matching the raw scale
 * lostark.bible's own percentile/contribution/buff fields use — never the
 * *100 display scale — so poller.js can compare directly against a new
 * entry without re-deriving anything.
 *
 * Only one 'active' challenge per character at a time — enforced in
 * application code (src/db/challenges.js), not a DB constraint: accepting
 * a new challenge for a character marks any still-active one 'abandoned'
 * first.
 */
export async function up(pgm) {
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
    check: "status in ('active', 'completed', 'abandoned')",
  });

  // poller.js looks up "does this character have an active challenge"
  // every relevant clear — one row per character is the common case, but
  // index it anyway since this runs on every poll tick's clear processing.
  pgm.createIndex('challenges', ['tracked_character_id', 'status']);
}

export async function down(pgm) {
  pgm.dropTable('challenges');
}
