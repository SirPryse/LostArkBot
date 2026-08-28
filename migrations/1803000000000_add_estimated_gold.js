export const shorthands = undefined;

/**
 * Two columns powering an *estimated* gold-earned stat (/my-stats,
 * /character-page) — nullable, never backfillable for historical rows, same
 * pattern as below_min_dps/is_bus: raw dps/boss/difficulty was never stored
 * on this table before, and there's still no link back to the source
 * lostark.bible log entry, so old rows simply have no way to know which
 * gate they were.
 *
 * raid_family_key: which raidFamilies.js family this clear belongs to
 * (needed at aggregate time to apply the weekly 3-family gold cap — see
 * getEstimatedGold in clearHistory.js). estimated_gold: that gate's total
 * gold value from RAID_DATA.md's reference table (src/notify/goldEstimate.js),
 * looked up at record time by boss+difficulty, same way below_min_dps looks
 * up minDps.js. Both null together always — set only for competitive-view
 * clears where a gold value is actually known for that boss/difficulty.
 */
export async function up(pgm) {
  pgm.addColumns('clear_history', {
    raid_family_key: { type: 'text' },
    estimated_gold: { type: 'integer' },
  });
}

export async function down(pgm) {
  pgm.dropColumns('clear_history', ['raid_family_key', 'estimated_gold']);
}
