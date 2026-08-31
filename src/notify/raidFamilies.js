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
    // Confirmed via patch notes (RAID_DATA.md): Extreme raid gold is paid
    // "regardless of Gold-Earner status" and doesn't consume any of the
    // weekly 3-family cap — see ALWAYS_PAYS_GOLD_FAMILY_KEYS below and
    // getEstimatedGold() in clearHistory.js, which both need this flag to
    // treat Extreme clears as always-counted rather than competing for one
    // of a gold-earner character's 3 weekly slots.
    alwaysPaysGold: true,
    // Confirmed: Extreme raid gold pays 100% Unbound at every difficulty
    // tier — every entry in `difficulties` below, not a subset the way
    // Serca/Kazeros restrict this to just their harder tiers. See
    // ALWAYS_FULLY_UNBOUND_GOLD_FAMILY_KEYS below and splitGold()'s
    // comment in goldEstimate.js — because *every* difficulty here is
    // fully-unbound, a clear from this family is 100% Unbound even when
    // its specific difficulty couldn't be determined (e.g. an old row
    // whose exact Extreme Hard-vs-Nightmare tier is ambiguous by gold
    // value alone — 45,000 either way — doesn't matter for the split).
    // Ordered easiest -> hardest — used by challengeRaids.js to find the
    // hardest difficulty a given gear score qualifies for. Every family
    // below has one of these; see the file-level comment for why it's a
    // flat explicit list rather than derived from the gates' alias
    // `difficulties` restrictions (those exist to disambiguate a *shared*
    // boss name, not to enumerate a family's full difficulty set — several
    // gates have no restriction at all, i.e. apply to every difficulty).
    difficulties: ['Extreme Normal', 'Extreme Hard', 'Extreme Nightmare'],
    fullyUnboundDifficulties: ['Extreme Normal', 'Extreme Hard', 'Extreme Nightmare'],
    // Same boss name as regular Aegir Gate 2 below, but a separate weekly
    // clear — see the file-level comment on why this needs the
    // difficulty-restricted alias form instead of a plain string.
    gates: [
      [{ name: 'Aegir, the Oppressor', difficulties: ['Extreme Normal', 'Extreme Hard', 'Extreme Nightmare'] }],
    ],
  },
  {
    key: 'brelshaza-extreme',
    label: 'Brelshaza Extreme',
    // Same single-encounter shape as Aegir Extreme above — just Gate 2's
    // boss ("Phantom Manifester Brelshaza"), no Extreme equivalent of Gate
    // 1 ("Narok the Butcher").
    hideGateNumber: true,
    // See aegir-extreme's identical comment above (100% Unbound at every
    // difficulty tier).
    alwaysPaysGold: true,
    difficulties: ['Extreme Normal', 'Extreme Hard', 'Extreme Nightmare'],
    fullyUnboundDifficulties: ['Extreme Normal', 'Extreme Hard', 'Extreme Nightmare'],
    // Same boss name as regular Brelshaza Gate 2 below, but a separate
    // weekly clear — see the file-level comment on why this needs the
    // difficulty-restricted alias form instead of a plain string.
    gates: [
      [{ name: 'Phantom Manifester Brelshaza', difficulties: ['Extreme Normal', 'Extreme Hard', 'Extreme Nightmare'] }],
    ],
  },
  {
    key: 'cathedral',
    label: 'Cathedral',
    // Confirmed via patch notes (RAID_DATA.md): Cathedral's gold is 100%
    // Character-Bound, unlike every other tracked raid (50/50 Roster/
    // Unbound) — see CHARACTER_BOUND_GOLD_FAMILY_KEYS below and
    // splitGold() in goldEstimate.js, which use this flag to classify a
    // clear's gold type at aggregation time without needing to store the
    // split per-row.
    paysCharacterBoundGold: true,
    difficulties: ['Level 1', 'Level 2', 'Level 3'],
    gates: [['Archbishop Arcenos'], ['Arcenos, Vanguard of Fanaticism']],
  },
  {
    key: 'serca',
    label: 'Serca',
    difficulties: ['Normal', 'Hard', 'Nightmare'],
    gates: [['Witch of Agony, Serca'], ['Corvus Tul Rak']],
    // Normal's 50/50 split is patch-note-confirmed (RAID_DATA.md); Hard
    // and Nightmare instead pay 100% Unbound — confirmed directly, not
    // the 50/50 default other unconfirmed-split raids fall back to. See
    // FULLY_UNBOUND_GOLD_KEYS/splitGold() in goldEstimate.js.
    fullyUnboundDifficulties: ['Hard', 'Nightmare'],
  },
  {
    key: 'kazeros',
    label: 'Kazeros',
    difficulties: ['Normal', 'Hard'],
    // Normal's 50/50 split is patch-note-confirmed; Hard instead pays
    // 100% Unbound — same confirmed-not-assumed situation as Serca
    // Hard/Nightmare above.
    fullyUnboundDifficulties: ['Hard'],
    // Both aliases used to be unrestricted plain strings — harmless for
    // getRaidFamilyForBoss (any alias identifies the gate regardless of
    // which one matched), but wrong for getBossNameForGateAtDifficulty
    // (would always pick whichever came first, ignoring the requested
    // difficulty). Restricted now that a difficulty -> name direction
    // actually needs to be correct (challengeRaids.js).
    gates: [
      ['Abyss Lord Kazeros'],
      [
        { name: 'Death Incarnate Kazeros', difficulties: ['Hard'] },
        { name: 'Archdemon Kazeros', difficulties: ['Normal'] },
      ],
    ],
  },
  {
    key: 'armoche',
    label: 'Armoche',
    difficulties: ['Normal', 'Hard'],
    gates: [['Brelshaza, Ember in the Ashes'], ['Armoche, Sentinel of the Abyss']],
  },
  {
    key: 'mordum',
    label: 'Mordum',
    difficulties: ['Normal', 'Hard'],
    gates: [
      ['Infernas'],
      ['Blossoming Fear, Naitreya'],
      ['Mordum, the Abyssal Punisher'],
    ],
  },
  {
    key: 'brelshaza',
    label: 'Brelshaza',
    difficulties: ['Normal', 'Hard'],
    // Not the same raid as "Brelshaza, Ember in the Ashes" above (that's
    // Armoche Gate 1) — the game reused the name for a different raid.
    // Gate 2's boss name is shared with Brelshaza Extreme (separate family
    // above) — see the file-level comment on the difficulty-restricted
    // alias form.
    gates: [
      ['Narok the Butcher'],
      [{ name: 'Phantom Manifester Brelshaza', difficulties: ['Normal', 'Hard'] }],
    ],
  },
  {
    key: 'aegir',
    label: 'Aegir',
    difficulties: ['Normal', 'Hard'],
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

/** Family keys whose gold always counts toward the estimated-gold stat,
 * regardless of Gold-Earner status or the weekly 3-family cap — see the
 * `alwaysPaysGold` comment on aegir-extreme/brelshaza-extreme above. */
export const ALWAYS_PAYS_GOLD_FAMILY_KEYS = new Set(
  RAID_FAMILIES.filter((f) => f.alwaysPaysGold).map((f) => f.key),
);

/** Family keys whose gold is 100% Character-Bound rather than the usual
 * 50/50 Roster/Unbound split — see the `paysCharacterBoundGold` comment on
 * cathedral above. */
export const CHARACTER_BOUND_GOLD_FAMILY_KEYS = new Set(
  RAID_FAMILIES.filter((f) => f.paysCharacterBoundGold).map((f) => f.key),
);

/** `"familyKey|difficulty"` combos confirmed to pay 100% Unbound rather
 * than the usual 50/50 Roster/Unbound default — see each family's own
 * `fullyUnboundDifficulties` comment (Serca Hard/Nightmare, Kazeros Hard).
 * Checked by splitGold() before falling back to 50/50; a combo not in
 * here isn't assumed 50/50 vs. 100% unbound one way or the other by this
 * set itself — splitGold() is what actually decides the fallback. */
export const FULLY_UNBOUND_GOLD_KEYS = new Set(
  RAID_FAMILIES.flatMap((f) => (f.fullyUnboundDifficulties ?? []).map((d) => `${f.key}|${d}`)),
);

/** Family keys where *every* difficulty the family offers pays 100%
 * Unbound (currently just the two Extreme families) — as opposed to
 * Serca/Kazeros, where only their harder tiers do and Normal stays 50/50.
 * Because there's no difficulty left that *isn't* fully-unbound, a clear
 * from one of these families is 100% Unbound even when its specific
 * difficulty is unknown/ambiguous (e.g. an old row whose exact Extreme
 * Hard-vs-Nightmare tier can't be told apart by gold value alone — both
 * are 45,000) — splitGold() checks this before falling back to the 50/50
 * default, so a null `difficulty` doesn't wrongly cost these families
 * their confirmed split the way it would for Serca/Kazeros. */
export const ALWAYS_FULLY_UNBOUND_GOLD_FAMILY_KEYS = new Set(
  RAID_FAMILIES.filter(
    (f) => f.fullyUnboundDifficulties && f.difficulties.every((d) => f.fullyUnboundDifficulties.includes(d)),
  ).map((f) => f.key),
);

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

/** The boss name a gate actually goes by at a specific difficulty — needed
 * by challengeRaids.js/challenge.js to know which boss name to query
 * lostark.bible's logs for at a specific difficulty, since some gates
 * rename their boss per difficulty (see the file-level comment). Picks the
 * alias whose `difficulties` restriction includes the target difficulty,
 * or the first unrestricted (plain-string) alias if there's no
 * difficulty-specific one. Returns null if the gate genuinely doesn't have
 * a name for that difficulty (shouldn't happen for any difficulty in the
 * family's own `difficulties` list, but defensive either way). */
export function getBossNameForGateAtDifficulty(family, gateIndex, difficulty) {
  const aliases = family.gates[gateIndex];
  if (!aliases) return null;
  for (const alias of aliases) {
    const { name, difficulties } = typeof alias === 'string' ? { name: alias, difficulties: null } : alias;
    if (difficulties === null || difficulties.includes(difficulty)) return name;
  }
  return null;
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
