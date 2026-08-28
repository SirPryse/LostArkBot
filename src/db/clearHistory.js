import { pool } from './pool.js';
import { getGoldEarnerKeySet } from './goldEarners.js';
import { lastWednesdayReset } from '../notify/raidWeek.js';
import { ALWAYS_PAYS_GOLD_FAMILY_KEYS } from '../notify/raidFamilies.js';
import { sumTopFamilies, splitGold } from '../notify/goldEstimate.js';

/** `belowMinDps` is null for anything minDps.js doesn't have an opinion on
 * — a non-DPS-role clear, or a DPS clear with no threshold defined for
 * that boss/difficulty yet — never true/false by default. `isBus` is a
 * different signal entirely — lostark.bible's own flag, straight off the
 * log entry — but defaults to null the same way: a caller that forgets to
 * pass it should read as "unknown", not silently record a real `false`
 * (confirmed live this exact mistake happened when the column was first
 * added as NOT NULL DEFAULT false — see the migration that fixed it).
 * raidFamilyKey/estimatedGold are the same "null means not applicable"
 * shape again — see goldEstimate.js and getEstimatedGold() below for how
 * they're actually used. poller.js's call site always passes a real
 * computed value for every one of these. */
export async function recordClear(
  trackedCharacterId,
  percentile,
  contributionPercentile = null,
  died = false,
  belowMinDps = null,
  isBus = null,
  raidFamilyKey = null,
  estimatedGold = null,
) {
  await pool.query(
    `insert into clear_history
       (tracked_character_id, percentile, contribution_percentile, died, below_min_dps, is_bus, raid_family_key, estimated_gold)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [trackedCharacterId, percentile, contributionPercentile, died, belowMinDps, isBus, raidFamilyKey, estimatedGold],
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

/** Plain arithmetic mean over whatever non-null values exist — null (not
 * 0) when there's nothing to average, same "don't invent a fake number"
 * rule formatWinRate/formatPercentile-style N/A handling already follows
 * elsewhere in this codebase. */
function average(values) {
  const real = values.filter((v) => v !== null).map(Number);
  return real.length > 0 ? real.reduce((sum, v) => sum + v, 0) / real.length : null;
}

/**
 * Total clears logged, how many landed in each percentile tier (matches
 * src/notify/percentileTiers.js's TIERS boundaries), how many were marked
 * dead, and the average percentile itself (not just which tier it fell
 * into) — /character-page's "average stat" line, cheap since percentile is
 * already stored per clear, no new API calls needed. Supports get two
 * separate tallies/averages — Uptime (`percentile`) and Contribution
 * (`contribution_percentile`) — since those are tracked as distinct badges;
 * DPS only ever has `percentile`, so the contribution fields will just be
 * null/all-zero for them.
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
    avgPercentile: average(rows.map((r) => r.percentile)),
    avgContributionPercentile: average(rows.map((r) => r.contribution_percentile)),
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

/**
 * Turns a flat list of gold-bearing clears into a lifetime `{ total,
 * character, roster, unbound }` split, applying the two rules that make
 * this an *estimate* rather than a real recorded number (see
 * goldEstimate.js's file comment for why there's no real one):
 *
 * 1. Only clears by a currently-designated Gold Earner count at all — this
 *    uses the *current* gold_earners set applied retroactively across a
 *    character's whole history, not whatever it was at the time (this bot
 *    has no record of when a character's designation changed, so there's
 *    no more accurate option).
 * 2. Within that, only 3 raid families pay out per character per week — a
 *    gold earner might well clear more, so this picks whichever 3 families
 *    summed to the *most* gold that week (assumes a player optimizes which
 *    3 they claim, same assumption RAID_DATA.md's "Optimal weekly gold by
 *    iLvl" table makes) and drops the rest.
 *
 * Extreme raids (ALWAYS_PAYS_GOLD_FAMILY_KEYS) are exempt from both rules —
 * confirmed via patch notes that their gold pays out "regardless of
 * Gold-Earner status" and doesn't touch the 3-family cap (see
 * raidFamilies.js) — so every Extreme clear counts in full, always.
 *
 * The character/roster/unbound split itself is derived per contributing
 * clear from its `raid_family_key` via splitGold() — no separate stored
 * split needed, `estimated_gold` (the total) plus which family it was is
 * enough to classify it (Cathedral = 100% Character-Bound, everything else
 * 50/50 Roster/Unbound — see splitGold's own comment for confirmed-vs-
 * assumed detail).
 */
function computeEstimatedGoldSplit(rows, earnerKeySet) {
  const result = { total: 0, character: 0, roster: 0, unbound: 0 };

  const addSplit = (familyKey, gold) => {
    const split = splitGold(familyKey, gold);
    result.total += gold;
    result.character += split.character;
    result.roster += split.roster;
    result.unbound += split.unbound;
  };

  const nonExtreme = [];
  for (const row of rows) {
    if (ALWAYS_PAYS_GOLD_FAMILY_KEYS.has(row.raid_family_key)) {
      addSplit(row.raid_family_key, row.estimated_gold);
    } else {
      nonExtreme.push(row);
    }
  }

  const eligible = nonExtreme.filter((r) => earnerKeySet.has(`${r.character_name}|${r.region}`));

  // character|region|weekStartMs -> family key -> { sum, familyKey }
  const weeklyFamilyTotals = new Map();
  for (const row of eligible) {
    const weekStartMs = lastWednesdayReset(new Date(row.created_at)).getTime();
    const bucketKey = `${row.character_name}|${row.region}|${weekStartMs}`;
    if (!weeklyFamilyTotals.has(bucketKey)) weeklyFamilyTotals.set(bucketKey, new Map());
    const families = weeklyFamilyTotals.get(bucketKey);
    families.set(row.raid_family_key, (families.get(row.raid_family_key) ?? 0) + row.estimated_gold);
  }

  for (const families of weeklyFamilyTotals.values()) {
    // Which families actually made the top-3-by-value cut this week —
    // sumTopFamilies only returns the total, so the cutoff itself is
    // re-derived here to know *which* entries to split and add.
    const sorted = [...families.entries()].sort((a, b) => b[1] - a[1]);
    for (const [familyKey, gold] of sorted.slice(0, 3)) {
      addSplit(familyKey, gold);
    }
  }

  return result;
}

const GOLD_BEARING_CLEAR_WHERE =
  "ch.estimated_gold is not null and ch.raid_family_key is not null and tc.view_mode = 'competitive'";

const EMPTY_GOLD_SPLIT = { total: 0, character: 0, roster: 0, unbound: 0 };

/** Estimated lifetime gold split across every competitive-view character an
 * account has in one guild — /my-stats' pooled view, same account+guild
 * scoping getAggregateStats() uses. Returns { total, character, roster,
 * unbound }. */
export async function getEstimatedGoldForAccount(linkedAccountId, guildId) {
  const [{ rows }, earnerKeySet] = await Promise.all([
    pool.query(
      `select tc.character_name, tc.region, ch.raid_family_key, ch.estimated_gold, ch.created_at
       from clear_history ch
       join tracked_characters tc on tc.id = ch.tracked_character_id
       where tc.linked_account_id = $1 and tc.guild_id = $2 and ${GOLD_BEARING_CLEAR_WHERE}`,
      [linkedAccountId, guildId],
    ),
    getGoldEarnerKeySet(linkedAccountId),
  ]);

  return computeEstimatedGoldSplit(rows, earnerKeySet);
}

/** Same estimate, scoped to a single tracked character — /character-page's
 * per-character view. Returns { total, character, roster, unbound }. */
export async function getEstimatedGoldForCharacter(trackedCharacterId) {
  const { rows } = await pool.query(
    `select tc.character_name, tc.region, tc.linked_account_id, ch.raid_family_key, ch.estimated_gold, ch.created_at
     from clear_history ch
     join tracked_characters tc on tc.id = ch.tracked_character_id
     where tc.id = $1 and ${GOLD_BEARING_CLEAR_WHERE}`,
    [trackedCharacterId],
  );

  if (rows.length === 0) return { ...EMPTY_GOLD_SPLIT }; // fresh copy -- callers only read, but don't hand out the shared reference

  const earnerKeySet = await getGoldEarnerKeySet(rows[0].linked_account_id);
  return computeEstimatedGoldSplit(rows, earnerKeySet);
}
