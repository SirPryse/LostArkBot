import {
  getRaidFamilyForBoss,
  ALWAYS_PAYS_GOLD_FAMILY_KEYS,
  CHARACTER_BOUND_GOLD_FAMILY_KEYS,
  FULLY_UNBOUND_GOLD_KEYS,
  ALWAYS_FULLY_UNBOUND_GOLD_FAMILY_KEYS,
} from './raidFamilies.js';

/**
 * Estimated gold for one gate clear, by boss name then difficulty — same
 * keying convention as minDps.js/raidFamilies.js, sourced directly from
 * RAID_DATA.md's "Total Gold" column (see that file for per-source
 * confidence notes and the character/roster/unbound split, which isn't
 * tracked here — this is a total-only estimate).
 *
 * This is an ESTIMATE, not a real recorded value: lostark.bible's log data
 * has no gold field at all (confirmed — no field resembling gold has ever
 * turned up on any entry across clearMessage.js/guessParse.js, which
 * between them render or redact every field an entry has). What's stored
 * here is "what this gate is worth if it counts as one of this week's
 * gold-earning clears" — getEstimatedGold() in clearHistory.js is what
 * actually decides which clears count (gold-earner status + the weekly
 * 3-family cap), this file only answers "how much, if it does."
 *
 * A boss/difficulty combo not listed here just means it isn't estimated —
 * not "0 gold" — matching every other lookup table in this codebase.
 */
const GOLD_ESTIMATE = {
  'Akkan, Lord of Death': {
    Normal: 3_500,
    Hard: 5_500,
  },
  'Aegir, the Oppressor': {
    Normal: 8_000,
    Hard: 12_500,
    'Extreme Normal': 20_000,
    'Extreme Hard': 45_000,
    'Extreme Nightmare': 45_000,
  },
  'Narok the Butcher': {
    Normal: 5_500,
    Hard: 7_500,
  },
  'Phantom Manifester Brelshaza': {
    Normal: 11_000,
    Hard: 15_500,
    'Extreme Normal': 20_000,
    'Extreme Hard': 45_000,
    'Extreme Nightmare': 45_000,
  },
  'Infernas': {
    Normal: 4_000,
    Hard: 5_000,
  },
  'Blossoming Fear, Naitreya': {
    Normal: 7_000,
    Hard: 8_000,
  },
  'Mordum, the Abyssal Punisher': {
    Normal: 10_000,
    Hard: 14_000,
  },
  'Brelshaza, Ember in the Ashes': {
    Normal: 12_500,
    Hard: 15_000,
  },
  'Armoche, Sentinel of the Abyss': {
    Normal: 20_500,
    Hard: 27_000,
  },
  'Abyss Lord Kazeros': {
    Normal: 14_000,
    Hard: 17_000,
  },
  'Archdemon Kazeros': {
    Normal: 26_000,
  },
  'Death Incarnate Kazeros': {
    Hard: 35_000,
  },
  'Witch of Agony, Serca': {
    Normal: 14_000,
    Hard: 17_500,
    Nightmare: 21_000,
  },
  'Corvus Tul Rak': {
    Normal: 21_000,
    Hard: 26_500,
    Nightmare: 33_000,
  },
  'Archbishop Arcenos': {
    'Level 1': 13_500,
    'Level 2': 16_000,
    'Level 3': 20_000,
  },
  'Arcenos, Vanguard of Fanaticism': {
    'Level 1': 16_500,
    'Level 2': 24_000,
    'Level 3': 30_000,
  },
};

export function getGoldEstimate(bossName, difficulty) {
  return GOLD_ESTIMATE[bossName]?.[difficulty] ?? null;
}

// A weekly gold-earner cap of 3 families, same rule getEstimatedGold() in
// clearHistory.js applies to clear_history rows — this file's helpers below
// let /bonk and /bonk-hard apply the exact same logic to a *live* batch of
// this-week's log entries instead, without needing a DB round-trip.
const WEEKLY_FAMILY_CAP = 3;

/**
 * What one log entry is worth toward the estimated-gold stat, or null if
 * it's not a known raid/no gold figure exists for it yet. `alwaysCounts`
 * mirrors ALWAYS_PAYS_GOLD_FAMILY_KEYS — Extreme raids pay out regardless
 * of Gold-Earner status and don't touch the weekly cap, so callers should
 * add `gold` to their running total unconditionally when this is true,
 * rather than folding it into the top-3-families ranking.
 */
export function classifyClearGold(entry) {
  const match = getRaidFamilyForBoss(entry.boss, entry.difficulty);
  if (!match) return null;
  const gold = getGoldEstimate(entry.boss, entry.difficulty);
  if (gold === null) return null;
  return {
    familyKey: match.family.key,
    gold,
    alwaysCounts: ALWAYS_PAYS_GOLD_FAMILY_KEYS.has(match.family.key),
  };
}

/**
 * Splits one family's gold total into { character, roster, unbound }:
 *
 * 1. Cathedral pays 100% Character-Bound (confirmed) — checked first,
 *    regardless of difficulty.
 * 2. Both Extreme raids pay 100% Unbound at *every* difficulty tier
 *    (confirmed) — see ALWAYS_FULLY_UNBOUND_GOLD_FAMILY_KEYS. Checked by
 *    family alone, before `difficulty` is even considered, specifically
 *    so a clear whose exact Extreme tier is unknown/ambiguous (e.g. an
 *    old row where Extreme Hard vs. Nightmare can't be told apart by gold
 *    value alone — both are 45,000) still gets the correct split, since
 *    every possible difficulty for these two families lands the same way
 *    regardless.
 * 3. Serca Hard/Nightmare and Kazeros Hard also pay 100% Unbound
 *    (confirmed) — see FULLY_UNBOUND_GOLD_KEYS. Unlike step 2, these
 *    families mix fully-unbound and 50/50 difficulties, so `difficulty`
 *    is required to tell them apart from their own Normal counterpart; a
 *    `null` difficulty (an older clear recorded before raid_difficulty
 *    was tracked — see the add_raid_difficulty migration, and its
 *    genuinely-ambiguous-value carve-outs) can't be checked against this
 *    set at all and falls through to the 50/50 default rather than
 *    guessing.
 * 4. Everything else pays 50/50 Roster/Unbound. That figure is
 *    patch-note-confirmed for most raids' rows in RAID_DATA.md, and a
 *    consistent-pattern *assumption* for the handful whose split wasn't
 *    directly confirmed there (Armoche Hard) — every split that *was*
 *    confirmed came out exactly 50/50, so extrapolating the same ratio
 *    for its still-unconfirmed sibling is a reasonable estimate, not a
 *    guess pulled from nowhere.
 */
export function splitGold(familyKey, difficulty, total) {
  if (CHARACTER_BOUND_GOLD_FAMILY_KEYS.has(familyKey)) {
    return { character: total, roster: 0, unbound: 0 };
  }
  if (ALWAYS_FULLY_UNBOUND_GOLD_FAMILY_KEYS.has(familyKey)) {
    return { character: 0, roster: 0, unbound: total };
  }
  if (difficulty != null && FULLY_UNBOUND_GOLD_KEYS.has(`${familyKey}|${difficulty}`)) {
    return { character: 0, roster: 0, unbound: total };
  }
  const roster = Math.round(total / 2);
  return { character: 0, roster, unbound: total - roster };
}

/** Sums whichever `cap` families summed to the *most* gold — the "assume
 * an optimizing player claims their highest-paying raids" rule this
 * codebase uses everywhere the weekly cap applies (see clearHistory.js's
 * getEstimatedGold and RAID_DATA.md's "Optimal weekly gold by iLvl"). */
export function sumTopFamilies(familyGoldValues, cap = WEEKLY_FAMILY_CAP) {
  return [...familyGoldValues].sort((a, b) => b - a).slice(0, cap).reduce((sum, v) => sum + v, 0);
}
