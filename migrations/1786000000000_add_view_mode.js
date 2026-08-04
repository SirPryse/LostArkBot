export const shorthands = undefined;

export async function up(pgm) {
  pgm.addColumn('tracked_characters', {
    view_mode: { type: 'text', notNull: true, default: 'competitive' },
  });

  pgm.addConstraint('tracked_characters', 'tracked_characters_view_mode_check', {
    check: "view_mode in ('compact', 'competitive')",
  });
}

export async function down(pgm) {
  pgm.dropConstraint('tracked_characters', 'tracked_characters_view_mode_check');
  pgm.dropColumn('tracked_characters', 'view_mode');
}
