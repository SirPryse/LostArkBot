import { pool } from './pool.js';

export async function recordClear(trackedCharacterId, percentile, contributionPercentile = null, died = false) {
  await pool.query(
    'insert into clear_history (tracked_character_id, percentile, contribution_percentile, died) values ($1, $2, $3, $4)',
    [trackedCharacterId, percentile, contributionPercentile, died],
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
 * Total clears logged, how many landed in each percentile tier (matches
 * src/notify/percentileTiers.js's TIERS boundaries), and how many were
 * marked dead. Supports get two separate tallies — Uptime (`percentile`)
 * and Contribution (`contribution_percentile`) — since those are tracked as
 * distinct badges; DPS only ever has `percentile`, so
 * `contributionTierCounts` will just be all zero for them.
 */
export async function getStats(trackedCharacterId, tierMins) {
  const { rows } = await pool.query(
    'select percentile, contribution_percentile, died from clear_history where tracked_character_id = $1',
    [trackedCharacterId],
  );

  return {
    total: rows.length,
    diedCount: rows.filter((r) => r.died).length,
    tierCounts: tallyTiers(rows.map((r) => r.percentile), tierMins),
    contributionTierCounts: tallyTiers(rows.map((r) => r.contribution_percentile), tierMins),
  };
}

/**
 * Same shape as getStats, but pooled across every competitive-view tracked
 * character an account has in one guild instead of a single character —
 * used by /roster-page. DPS and support clears are merged into one `percentile`
 * tally on purpose (that's the whole point of the combined view); contribution
 * percentile isn't part of it since it's a support-only second axis with no
 * DPS equivalent to merge it against.
 */
export async function getAggregateStats(linkedAccountId, guildId, tierMins) {
  const { rows } = await pool.query(
    `select ch.percentile, ch.died
     from clear_history ch
     join tracked_characters tc on tc.id = ch.tracked_character_id
     where tc.linked_account_id = $1 and tc.guild_id = $2 and tc.view_mode = 'competitive'`,
    [linkedAccountId, guildId],
  );

  return {
    total: rows.length,
    diedCount: rows.filter((r) => r.died).length,
    tierCounts: tallyTiers(rows.map((r) => r.percentile), tierMins),
  };
}
