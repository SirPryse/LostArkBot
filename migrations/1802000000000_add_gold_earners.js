export const shorthands = undefined;

/**
 * A roster can designate at most 6 characters as "Gold Earners" — only
 * those characters' raid clears actually pay gold (everyone else's clears
 * still happen, just for zero gold), and it's a real in-game per-character
 * flag with no equivalent signal anywhere in lostark.bible's log data. This
 * table is this bot's own record of that designation, set via
 * /gold-earners — entirely separate from tracked_characters (which is
 * guild-scoped; a roster's gold earners are not, the same character tracked
 * in two servers should count as one gold-earner slot, not two).
 *
 * Keyed by (linked_account_id, character_name, region) rather than a FK to
 * tracked_characters.id for the same reason: a gold earner designation
 * should stick even if the character's tracked_characters row in some guild
 * gets removed and re-added, and it applies account-wide regardless of
 * which (if any) guild happens to track it.
 *
 * The max-6 cap is enforced in application code (src/db/goldEarners.js),
 * not a DB constraint — the whole set is replaced at once (delete + insert)
 * every time /gold-earners is run, so there's never a moment a 7th row
 * could be inserted independently.
 */
export async function up(pgm) {
  pgm.createTable('gold_earners', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    linked_account_id: {
      type: 'uuid',
      notNull: true,
      references: 'linked_accounts',
      onDelete: 'cascade',
    },
    character_name: { type: 'text', notNull: true },
    region: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('gold_earners', 'gold_earners_unique', {
    unique: ['linked_account_id', 'character_name', 'region'],
  });
}

export async function down(pgm) {
  pgm.dropTable('gold_earners');
}
