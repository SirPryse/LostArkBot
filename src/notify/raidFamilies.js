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
 *
 * An alias can also be `{ name, difficulties }` instead of a plain string —
 * needed when the *same* boss name is shared by two different weekly
 * clears, disambiguated only by difficulty. Confirmed live: "Aegir, the
 * Oppressor" is the exact same boss name for both the regular raid
 * (Normal/Hard) and Extreme Aegir (Extreme Normal/Hard/Nightmare), but
 * those are two separate weekly lockouts, not one gate with harder modes —
 * so they're two separate families below, each restricted to its own
 * difficulty set on that shared name.
 */
// Order here is display order in /bonk and /bonk-hard (both iterate this
// array directly) — newest/highest-priority raid first, oldest last. Not
// alphabetical and not gate-count order, just whatever's most relevant to
// check progress on right now.
export const RAID_FAMILIES = [
  {
    key: 'aegir-extreme',
    label: 'Aegir Extreme',
    // Extreme raids aren't gated the way regular raids are — just one
    // encounter, not a numbered sequence — so the friendly name is just
    // the label with no "Gate N" suffix. See getFriendlyBossName().
    hideGateNumber: true,
    // Same boss name as regular Aegir Gate 2 below, but a separate weekly
    // clear — see the file-level comment on why this needs the
    // difficulty-restricted alias form instead of a plain string.
    gates: [
      [{ name: 'Aegir, the Oppressor', difficulties: ['Extreme Normal', 'Extreme Hard', 'Extreme Nightmare'] }],
    ],
  },
  {
    key: 'cathedral',
    label: 'Cathedral',
    gates: [['Archbishop Arcenos'], ['Arcenos, Vanguard of Fanaticism']],
  },
  {
    key: 'serca',
    label: 'Serca',
    gates: [['Witch of Agony, Serca'], ['Corvus Tul Rak']],
  },
  {
    key: 'kazeros',
    label: 'Kazeros',
    gates: [['Abyss Lord Kazeros'], ['Death Incarnate Kazeros', 'Archdemon Kazeros']],
  },
  {
    key: 'armoche',
    label: 'Armoche',
    gates: [['Brelshaza, Ember in the Ashes'], ['Armoche, Sentinel of the Abyss']],
  },
  {
    key: 'mordum',
    label: 'Mordum',
    gates: [
      ['Infernas'],
      ['Blossoming Fear, Naitreya'],
      ['Mordum, the Abyssal Punisher'],
    ],
  },
  {
    key: 'brelshaza',
    label: 'Brelshaza',
    // Not the same raid as "Brelshaza, Ember in the Ashes" above (that's
    // Armoche Gate 1) — the game reused the name for a different raid.
    gates: [['Narok the Butcher'], ['Phantom Manifester Brelshaza']],
  },
  {
    key: 'aegir',
    label: 'Aegir',
    // Akkan is back as Gate 1 for Normal/Hard (2/2 total) — this used to be
    // just Gate 2 while Akkan was excluded from a limited-time event
    // window; see git history for that state if it ever needs restoring.
    // Extreme Aegir (separate family above) is unaffected — it's still
    // just the one encounter, no Akkan equivalent there.
    gates: [
      ['Akkan, Lord of Death'],
      [{ name: 'Aegir, the Oppressor', difficulties: ['Normal', 'Hard'] }],
    ],
  },
];

// boss name -> candidate matches (usually exactly one; more than one only
// for a name shared across two difficulty-disambiguated families, e.g.
// Aegir Gate 2 vs Aegir Extreme Gate 1 above).
const CANDIDATES_BY_BOSS = new Map();
for (const family of RAID_FAMILIES) {
  family.gates.forEach((aliases, gateIndex) => {
    for (const alias of aliases) {
      const { name, difficulties } = typeof alias === 'string' ? { name: alias, difficulties: null } : alias;
      if (!CANDIDATES_BY_BOSS.has(name)) CANDIDATES_BY_BOSS.set(name, []);
      CANDIDATES_BY_BOSS.get(name).push({ family, gateIndex, difficulties });
    }
  });
}

// Every known raid boss name, flattened across every gate of every family —
// the `bosses` filter to pass to getCharacterLogs(). Confirmed live:
// lostark.bible's /api/oauth/logs/{name} pagination silently no-ops
// without a `bosses` filter (every page returns the same most-recent-25
// window regardless of `page`), but paginates correctly *with* one — so
// any caller that wants real history beyond the most recent 25 entries
// needs to pass this.
export const ALL_KNOWN_BOSSES = [...CANDIDATES_BY_BOSS.keys()];

/**
 * Which raid family (and which of its gates) a boss name belongs to.
 * `difficulty` is required to disambiguate the rare case of a boss name
 * shared across two families (see the file-level comment) — for every
 * other boss it's simply ignored, since a Normal or Hard clear counts
 * toward the same gate either way.
 */
export function getRaidFamilyForBoss(bossName, difficulty) {
  const candidates = CANDIDATES_BY_BOSS.get(bossName);
  if (!candidates) return null;
  const match = candidates.find((c) => c.difficulties === null || c.difficulties.includes(difficulty));
  return match ? { family: match.family, gateIndex: match.gateIndex } : null;
}

/** Friendlier "{Raid} Gate {N}" label for a boss name (e.g. "Archbishop
 * Arcenos" -> "Cathedral Gate 1") — falls back to the raw boss name for
 * anything not in a known family. Families marked `hideGateNumber` (e.g.
 * Extreme raids, which aren't a numbered gate sequence) just get the
 * label with no "Gate N" suffix. */
export function getFriendlyBossName(bossName, difficulty) {
  const match = getRaidFamilyForBoss(bossName, difficulty);
  if (!match) return bossName;
  if (match.family.hideGateNumber) return match.family.label;
  return `${match.family.label} Gate ${match.gateIndex + 1}`;
}
