export const shorthands = undefined;

export async function up(pgm) {
  pgm.addColumn('tracked_characters', {
    class_name: { type: 'text' },
    role: { type: 'text' },
  });
  pgm.addConstraint('tracked_characters', 'tracked_characters_role_check', {
    check: "role is null or role in ('dps', 'support', 'unknown')",
  });

  pgm.createTable('clear_history', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tracked_character_id: {
      type: 'uuid',
      notNull: true,
      references: 'tracked_characters',
      onDelete: 'cascade',
    },
    percentile: { type: 'numeric' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('clear_history', 'tracked_character_id');
}

export async function down(pgm) {
  pgm.dropTable('clear_history');
  pgm.dropConstraint('tracked_characters', 'tracked_characters_role_check');
  pgm.dropColumn('tracked_characters', ['class_name', 'role']);
}
