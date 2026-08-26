export const shorthands = undefined;

/**
 * Whether a DPS-role clear's actual dps fell below minDps.js's threshold
 * for that boss/difficulty — previously only ever computed on the fly at
 * message-render time (the same ✅/⚠️ badge shown in clear announcements
 * and /guess-parse), never persisted anywhere. Nullable: null covers both
 * "not a DPS-role clear" (support's own dps stat is a different metric
 * entirely, minDps.js was never meant to apply to it) and "no threshold
 * defined for this boss/difficulty yet" — neither case should count as
 * either met or missed.
 */
export async function up(pgm) {
  pgm.addColumn('clear_history', {
    below_min_dps: { type: 'boolean' },
  });
}

export async function down(pgm) {
  pgm.dropColumn('clear_history', 'below_min_dps');
}
