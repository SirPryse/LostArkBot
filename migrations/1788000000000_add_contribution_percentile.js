export const shorthands = undefined;

export async function up(pgm) {
  pgm.addColumn('clear_history', {
    contribution_percentile: { type: 'numeric' },
  });
}

export async function down(pgm) {
  pgm.dropColumn('clear_history', 'contribution_percentile');
}
