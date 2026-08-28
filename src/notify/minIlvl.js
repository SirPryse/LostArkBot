/**
 * Minimum character item level (gear score) to enter a raid gate at a given
 * difficulty — same keying convention as minDps.js/goldEstimate.js (boss
 * name, then difficulty string), sourced from RAID_DATA.md's "Min iLvl"
 * column. A boss/difficulty combo not listed here just means it isn't
 * known yet — not "0 required" — matching every other lookup table in this
 * codebase.
 */
const MIN_ILVL = {
  'Akkan, Lord of Death': {
    Normal: 1660,
    Hard: 1680,
  },
  'Aegir, the Oppressor': {
    Normal: 1660,
    Hard: 1680,
    'Extreme Normal': 1720,
    'Extreme Hard': 1750,
    'Extreme Nightmare': 1770,
  },
  'Narok the Butcher': {
    Normal: 1670,
    Hard: 1690,
  },
  'Phantom Manifester Brelshaza': {
    Normal: 1670,
    Hard: 1690,
    'Extreme Normal': 1720,
    'Extreme Hard': 1750,
    'Extreme Nightmare': 1770,
  },
  'Infernas': {
    Normal: 1680,
    Hard: 1700,
  },
  'Blossoming Fear, Naitreya': {
    Normal: 1680,
    Hard: 1700,
  },
  'Mordum, the Abyssal Punisher': {
    Normal: 1680,
    Hard: 1700,
  },
  'Brelshaza, Ember in the Ashes': {
    Normal: 1700,
    Hard: 1720,
  },
  'Armoche, Sentinel of the Abyss': {
    Normal: 1700,
    Hard: 1720,
  },
  'Abyss Lord Kazeros': {
    Normal: 1710,
    Hard: 1730,
  },
  'Archdemon Kazeros': {
    Normal: 1710,
  },
  'Death Incarnate Kazeros': {
    Hard: 1730,
  },
  'Witch of Agony, Serca': {
    Normal: 1710,
    Hard: 1730,
    Nightmare: 1740,
  },
  'Corvus Tul Rak': {
    Normal: 1710,
    Hard: 1730,
    Nightmare: 1740,
  },
  'Archbishop Arcenos': {
    'Level 1': 1700,
    'Level 2': 1720,
    'Level 3': 1750,
  },
  'Arcenos, Vanguard of Fanaticism': {
    'Level 1': 1700,
    'Level 2': 1720,
    'Level 3': 1750,
  },
};

export function getMinIlvl(bossName, difficulty) {
  return MIN_ILVL[bossName]?.[difficulty] ?? null;
}
