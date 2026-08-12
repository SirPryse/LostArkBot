export const shorthands = undefined;

/**
 * Guards against the weekly reset ritual double-firing for the same guild —
 * confirmed live it can (two full runWeeklyReset() cycles landed ~4s apart
 * for the same guild, same top-3, doubling everyone's badge count). Tracked
 * per-guild rather than as a single global timestamp since resets across
 * guilds run independently within one tick anyway.
 */
export async function up(pgm) {
  pgm.addColumn('guild_settings', {
    last_reset_at: { type: 'timestamptz' },
  });
}

export async function down(pgm) {
  pgm.dropColumn('guild_settings', 'last_reset_at');
}
