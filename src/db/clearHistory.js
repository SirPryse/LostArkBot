import { pool } from './pool.js';

export async function recordClear(trackedCharacterId, percentile, contributionPercentile = null) {
  await pool.query(
    'insert into clear_history (tracked_character_id, percentile, contribution_percentile) values ($1, $2, $3)',
    [trackedCharacterId, percentile, contributionPercentile],
  );
}

function tallyTiers(values, tierMins) {
  const tierCounts = Object.fromEntries(tierMins.map(({ key }) => [key, 0]));
  for (const value of values) {
    if (value === null) continue;
    const p = Number(value) * 100;
    const tier = tierMins.find((t) => p >= t.min) ?? tierMins[tierMins.length - 1];
    tierCounts[tier.key] += 1;
  }
  return tierCounts;
}

/**
 * Total clears logged, plus how many landed in each percentile tier
 * (matches src/notify/percentileTiers.js's TIERS boundaries). Supports get
 * two separate tallies — Uptime (`percentile`) and Contribution
 * (`contribution_percentile`) — since those are tracked as distinct badges;
 * DPS only ever has `percentile`, so `contributionTierCounts` will just be
 * all zero for them.
 */
export async function getStats(trackedCharacterId, tierMins) {
  const { rows } = await pool.query(
    'select percentile, contribution_percentile from clear_history where tracked_character_id = $1',
    [trackedCharacterId],
  );

  return {
    total: rows.length,
    tierCounts: tallyTiers(rows.map((r) => r.percentile), tierMins),
    contributionTierCounts: tallyTiers(rows.map((r) => r.contribution_percentile), tierMins),
  };
}
