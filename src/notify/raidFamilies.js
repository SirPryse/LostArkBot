/**
 * Raid "families" group the gate-boss encounters that share one weekly
 * lockout — e.g. Kazeros' 2 gates count as one raid for `/roster-status`
 * purposes. Keyed by a stable internal id so a new raid (even a 3+ gate one)
 * can be added later by just appending an entry here — nothing else needs
 * to change.
 *
 * Each gate is a list of boss-name aliases, not a single name — some gates
 * rename their boss per difficulty (confirmed: Kazeros' gate 2 shows as
 * "Death Incarnate Kazeros" on Hard but "Archdemon Kazeros" on Normal, same
 * gate). Matching happens by gate identity, so any alias counts toward the
 * same gate instead of needing every difficulty's name listed up front.
 */
export const RAID_FAMILIES = [
  {
    key: 'armoche',
    label: 'Armoche',
    gates: [['Brelshaza, Ember in the Ashes'], ['Armoche, Sentinel of the Abyss']],
  },
  {
    key: 'kazeros',
    label: 'Kazeros',
    gates: [['Abyss Lord Kazeros'], ['Death Incarnate Kazeros', 'Archdemon Kazeros']],
  },
  {
    key: 'serca',
    label: 'Serca',
    gates: [['Witch of Agony, Serca'], ['Corvus Tul Rak']],
  },
  {
    key: 'cathedral',
    label: 'Cathedral',
    gates: [['Archbishop Arcenos'], ['Arcenos, Vanguard of Fanaticism']],
  },
];

// boss name -> { family, gateIndex }
const GATE_BY_BOSS = new Map();
for (const family of RAID_FAMILIES) {
  family.gates.forEach((aliases, gateIndex) => {
    for (const name of aliases) {
      GATE_BY_BOSS.set(name, { family, gateIndex });
    }
  });
}

/** Which raid family (and which of its gates) a boss name belongs to. */
export function getRaidFamilyForBoss(bossName) {
  return GATE_BY_BOSS.get(bossName) ?? null;
}
