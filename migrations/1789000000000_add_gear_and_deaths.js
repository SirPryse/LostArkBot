export const shorthands = undefined;

export async function up(pgm) {
  pgm.addColumn('tracked_characters', {
    gear_score: { type: 'numeric' },
    combat_power: { type: 'numeric' },
  });

  pgm.addColumn('clear_history', {
    died: { type: 'boolean', notNull: true, default: false },
  });
}

export async function down(pgm) {
  pgm.dropColumn('clear_history', 'died');
  pgm.dropColumn('tracked_characters', ['gear_score', 'combat_power']);
}
