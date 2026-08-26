import { pool } from './pool.js';

/** `belowMinDps` is null for anything minDps.js doesn't have an opinion on
 * — a non-DPS-role clear, or a DPS clear with no threshold defined for
 * that boss/difficulty yet — never true/false by default. `isBus` is a
 * different signal entirely — lostark.bible's own flag, straight off the
 * log entry — but defaults to null the same way: a caller that forgets to
 * pass it should read as "unknown", not silently record a real `false`
 * (confirmed live this exact mistake happened when the column was first
 * added as NOT NULL DEFAULT false — see the migration that fixed it).
 * poller.js's call site always passes a real computed value for both. */
export async function recordClear(trackedCharacterId, percentile, contributionPercentile = null, died = false, belowMinDps = null, isBus = null) {
  await pool.query(
    'insert into clear_history (tracked_character_id, percentile, contribution_percentile, died, below_min_dps, is_bus) values ($1, $2, $3, $4, $5, $6)',
    [trackedCharacterId, percentile, contributionPercentile, died, belowMinDps, isBus],
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
 * used by /my-stats. DPS and support clears are merged into one `percentile`
 * tally on purpose (that's the whole point of the combined view); contribution
 * percentile isn't part of it since it's a support-only second axis with no
 * DPS equivalent to merge it against.
 *
 * belowMinDpsCount / minDpsCheckableCount cover the "⚠️ Below Min DPS"
 * badge — checkable is the denominator (how many clears actually had a
 * true/false below_min_dps value, i.e. excludes support clears and
 * boss/difficulty combos with no threshold defined), not just `total`.
 * busCount / busCheckableCount are the same shape for is_bus — checkable
 * excludes historical rows recorded before that column existed (null),
 * not just `total`.
 */
export async function getAggregateStats(linkedAccountId, guildId, tierMins) {
  const { rows } = await pool.query(
    `select ch.percentile, ch.died, ch.below_min_dps, ch.is_bus
     from clear_history ch
     join tracked_characters tc on tc.id = ch.tracked_character_id
     where tc.linked_account_id = $1 and tc.guild_id = $2 and tc.view_mode = 'competitive'`,
    [linkedAccountId, guildId],
  );

  return {
    total: rows.length,
    diedCount: rows.filter((r) => r.died).length,
    tierCounts: tallyTiers(rows.map((r) => r.percentile), tierMins),
    belowMinDpsCount: rows.filter((r) => r.below_min_dps === true).length,
    minDpsCheckableCount: rows.filter((r) => r.below_min_dps !== null).length,
    busCount: rows.filter((r) => r.is_bus === true).length,
    busCheckableCount: rows.filter((r) => r.is_bus !== null).length,
  };
}
