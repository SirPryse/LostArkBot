export const shorthands = undefined;

/**
 * Needed so the gold-split logic can tell Serca Hard/Nightmare and Kazeros
 * Hard apart from their Normal counterparts — those specific difficulties
 * pay 100% Unbound instead of the usual 50/50 Roster/Unbound split (per
 * explicit confirmation; see splitGold()'s updated comment in
 * goldEstimate.js). `raid_family_key`/`estimated_gold` alone were never
 * enough to reconstruct which difficulty a clear was at (a family+gold
 * combination isn't always unique — e.g. Serca's Corvus Tul Rak Normal and
 * Witch of Agony Serca Nightmare are both 21,000), so this can't be
 * safely backfilled for existing rows — nullable, and only ever populated
 * for clears recorded from here on out (see poller.js). Existing rows
 * simply fall back to the pre-existing 50/50 default in splitGold(), same
 * as any other "unknown" case elsewhere in this codebase.
 */
export async function up(pgm) {
  pgm.addColumns('clear_history', {
    raid_difficulty: { type: 'text' },
  });
}

export async function down(pgm) {
  pgm.dropColumns('clear_history', ['raid_difficulty']);
}
