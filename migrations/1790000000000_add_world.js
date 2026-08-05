export const shorthands = undefined;

export async function up(pgm) {
  pgm.addColumn('tracked_characters', {
    world: { type: 'text' },
  });
}

export async function down(pgm) {
  pgm.dropColumn('tracked_characters', 'world');
}
