/**
 * Minimum individual DPS a solo player needs to reliably clear a raid gate
 * at a given difficulty — DPS-role announcements only (supports don't have
 * an equivalent solo damage threshold). Keyed by boss name exactly as
 * lostark.bible's API returns it (see raidFamilies.js for the same
 * convention), then by the `difficulty` string.
 *
 * Values sourced from a community-maintained spreadsheet ("Lost Ark End
 * Game Fight Data Sheets",
 * https://docs.google.com/spreadsheets/d/19r5A56C8USONYF3AHfCZ8TLgrHuzenEuYH9I21OpTQo).
 * Its method: team DPS = boss total HP / berserk timer, individual = team
 * / number of DPS players (3 in a 4-player raid, 6 in an 8-player one) —
 * a bare-minimum "just barely clears" number that ignores sidereals,
 * synergies and stagger windows. For multi-phase fights the highest
 * phase's figure is used. Every value here was re-checked against the
 * sheet's 2026-11-20 update. A boss/difficulty
 * combo not listed here just means it isn't shown — not "0 required" — so
 * adding a new raid is just appending an entry, same pattern as
 * raidFamilies.js and bossImages.js.
 */
const MIN_DPS = {
  'Witch of Agony, Serca': {
    Normal: 205_511_399,
    Hard: 427_537_749,
    Nightmare: 663_411_863,
  },
  'Corvus Tul Rak': {
    Normal: 264_903_199,
    Hard: 551_094_379,
    Nightmare: 855_134_685,
  },
  'Aegir, the Oppressor': {
    // 'Extreme Normal' has no recorded average yet — leave it null (not a
    // guess) until one's available, same convention as everywhere else in
    // this file.
    Normal: 29_689_773,
    Hard: 47_213_994,
    'Extreme Normal': null,
    'Extreme Hard': 411_003_443,
    'Extreme Nightmare': 737_480_604,
  },
  'Akkan, Lord of Death': {
    Normal: 28_486_222,
    Hard: 45_433_438,
  },
  'Narok the Butcher': {
    Normal: 47_914_216,
    Hard: 104_390_704,
  },
  'Phantom Manifester Brelshaza': {
    Normal: 49_308_883,
    Hard: 96_076_142,
    // Brelshaza Extreme (separate weekly clear, see raidFamilies.js) — no
    // recorded averages yet, same "leave it null, not a guess" convention
    // as Aegir's 'Extreme Normal' above.
    'Extreme Normal': null,
    'Extreme Hard': 439_089_097,
    'Extreme Nightmare': 996_857_662,
  },
  'Infernas': {
    Normal: 58_535_550,
    Hard: 88_144_414,
  },
  'Blossoming Fear, Naitreya': {
    Normal: 53_125_651,
    Hard: 94_825_271,
  },
  'Mordum, the Abyssal Punisher': {
    Normal: 81_330_595,
    Hard: 147_709_013,
    // Mordum Extreme (Act 3 Extreme). The sheet has no Extreme Normal
    // figures yet, and Extreme Hard only has Phase 1 (Mordum) — Phase 2
    // (Heart of Mordum) is blank, so this is the only known phase rather
    // than the max-across-phases the other Extremes use.
    'Extreme Normal': null,
    'Extreme Hard': 836_623_372,
  },
  // Belgardin (Shadow Raid, 8-player so the team requirement is split
  // across 6 DPS). Gate 1 is "Human Form", Gate 2 "Primordial Form" on the
  // sheet; Gate 2 has a 13-minute berserk timer vs Gate 1's 10, which is
  // why it's lower despite more HP.
  'Belgardin, Arbiter of Death': {
    Normal: 483_143_554,
    Hard: 769_045_865,
    Nightmare: 1_375_452_007,
  },
  'Phaetus An Kragma': {
    Normal: 416_790_006,
    Hard: 669_653_288,
    Nightmare: 1_197_674_113,
  },
  'Abyss Lord Kazeros': {
    Normal: 99_279_498,
    Hard: 168_984_796,
  },
  'Death Incarnate Kazeros': {
    Hard: 180_358_221,
  },
  // Same gate as "Death Incarnate Kazeros" above, just renamed on Normal
  // difficulty — see raidFamilies.js's note on this.
  'Archdemon Kazeros': {
    Normal: 105_961_148,
  },
  'Armoche, Sentinel of the Abyss': {
    Normal: 99_893_371,
    Hard: 198_617_140,
  },
  'Brelshaza, Ember in the Ashes': {
    Normal: 92_838_262,
    Hard: 170_642_388,
  },
  'Archbishop Arcenos': {
    'Level 1': 172_893_752,
    'Level 2': 375_823_301,
    'Level 3': 634_625_304,
  },
  'Arcenos, Vanguard of Fanaticism': {
    'Level 1': 173_598_124,
    'Level 2': 386_888_245,
    'Level 3': 665_530_283,
  },
};

export function getMinDps(bossName, difficulty) {
  return MIN_DPS[bossName]?.[difficulty] ?? null;
}
