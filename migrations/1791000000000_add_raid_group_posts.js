export const shorthands = undefined;

/**
 * One row per distinct raid clear (guild_id + lostark.bible log id) that's
 * been announced. Whoever's poll job inserts first "claims" it and posts a
 * fresh message; message_id starts null and is filled in right after that
 * message is actually sent. Later pollers for the same clear (other tracked
 * party members) see the conflict, wait for message_id, and append their
 * own embed to that message instead of posting a new one.
 */
export async function up(pgm) {
  pgm.createTable('raid_group_posts', {
    guild_id: { type: 'text', notNull: true },
    log_id: { type: 'text', notNull: true },
    channel_id: { type: 'text' },
    message_id: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('raid_group_posts', 'raid_group_posts_pkey', {
    primaryKey: ['guild_id', 'log_id'],
  });
}

export async function down(pgm) {
  pgm.dropTable('raid_group_posts');
}
