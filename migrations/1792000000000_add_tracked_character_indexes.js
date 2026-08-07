export const shorthands = undefined;

/**
 * tracked_characters had no index covering `enabled` or `guild_id` alone —
 * the only composite index (tracked_characters_unique) has
 * linked_account_id as its leftmost column, so queries filtering on just
 * `enabled` (every poll tick, via listEnabledWithAccount) or just
 * `guild_id` (/registered-users, /recent-raids) fell back to a sequential
 * scan. Harmless at current row counts, but the poll-tick query in
 * particular runs forever on a schedule, so it's worth having.
 */
export async function up(pgm) {
  pgm.createIndex('tracked_characters', 'enabled', {
    name: 'tracked_characters_enabled_idx',
    where: 'enabled = true',
  });

  // Expression index (lower(character_name)) — pgm.createIndex's column
  // array doesn't support a raw expression, so this one's raw SQL. Also
  // covers plain guild_id-only lookups via the leftmost-prefix rule
  // (listByGuild), so no separate guild_id-only index is needed.
  pgm.sql(
    'create index tracked_characters_guild_name_lower_idx on tracked_characters (guild_id, lower(character_name))',
  );
}

export async function down(pgm) {
  pgm.sql('drop index if exists tracked_characters_guild_name_lower_idx');
  pgm.dropIndex('tracked_characters', [], { name: 'tracked_characters_enabled_idx' });
}
