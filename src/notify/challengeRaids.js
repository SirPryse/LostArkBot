import { RAID_FAMILIES, ALWAYS_PAYS_GOLD_FAMILY_KEYS, getBossNameForGateAtDifficulty } from './raidFamilies.js';
import { getMinIlvl } from './minIlvl.js';
import { getGoldEstimate } from './goldEstimate.js';

// Same "best 3 by gold" ranking RAID_DATA.md's "Optimal weekly gold by
// iLvl" table computes by hand, done live here for /challenge instead of a
// static table — given a gear score, which family+difficulty combos
// actually qualify, and which 3 pay the most. Extreme raids are
// deliberately excluded from this ranking (ALWAYS_PAYS_GOLD_FAMILY_KEYS) —
// they don't compete for one of the 3 weekly gold-earner slots, so they're
// not part of "the best 3 raids" in that sense; /challenge only draws from
// the capped, competing pool.
const CHALLENGE_CAP = 3;

/**
 * The hardest difficulty this family offers that a `gearScore` qualifies
 * for, or null if it doesn't qualify for even the easiest. Requires *every*
 * gate to have both a known min iLvl and a known gold value at that
 * difficulty — if any gate's data is missing, that difficulty is skipped
 * (falls back to an easier one) rather than ranking on incomplete
 * information. Returns `{ difficulty, totalGold, gates }` or null.
 */
function bestQualifyingDifficulty(family, gearScore) {
  for (let i = family.difficulties.length - 1; i >= 0; i--) {
    const difficulty = family.difficulties[i];
    const gates = [];
    let qualifies = true;

    for (let gateIndex = 0; gateIndex < family.gates.length; gateIndex++) {
      const bossName = getBossNameForGateAtDifficulty(family, gateIndex, difficulty);
      const minIlvl = bossName ? getMinIlvl(bossName, difficulty) : null;
      const gold = bossName ? getGoldEstimate(bossName, difficulty) : null;

      if (!bossName || minIlvl === null || gold === null || gearScore < minIlvl) {
        qualifies = false;
        break;
      }
      gates.push({ gateIndex, bossName, gold });
    }

    if (qualifies) {
      return { difficulty, totalGold: gates.reduce((sum, g) => sum + g.gold, 0), gates };
    }
  }
  return null;
}

/**
 * The best `CHALLENGE_CAP` (3) raid families a character can currently run,
 * ranked by gold — same rule getEstimatedGold()/RAID_DATA.md's optimal-gold
 * table use elsewhere: "assume an optimizing player claims their
 * highest-paying options." Returns up to 3 `{ family, difficulty, totalGold,
 * gates }` entries, empty if the gear score doesn't qualify for anything
 * tracked yet.
 */
export function getBestRaidsForGearScore(gearScore) {
  const results = [];
  for (const family of RAID_FAMILIES) {
    if (ALWAYS_PAYS_GOLD_FAMILY_KEYS.has(family.key)) continue; // Extreme raids -- not part of this ranking, see file comment
    const best = bestQualifyingDifficulty(family, gearScore);
    if (best) results.push({ family, ...best });
  }
  results.sort((a, b) => b.totalGold - a.totalGold);
  return results.slice(0, CHALLENGE_CAP);
}
