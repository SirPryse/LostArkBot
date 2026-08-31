# Raid data — ilvl & gold reference

Reference data for challenge/raid tracking, one row per gate+difficulty —
same family/gate structure as `src/notify/raidFamilies.js`, so this table
maps directly onto that code (and eventually onto a `minIlvl.js`/`gold.js`
pair built the same way `minDps.js` already is). Blank cells just mean "not
filled in yet," never "zero" — same convention as `minDps.js`.

Gold has three types, tracked separately:
- **Character gold** — usable only by the character that earned it.
- **Roster gold** — usable by any character on the roster, not tradeable.
- **Unbound gold** — usable for anything, including trading.

A character can gold-claim at most **3 raids (families) per week**; within a
claimed raid, gold is awarded once per gate. **Extreme raids are an
exception**: weekly limit is 1 entry per *roster* (not per character),
shared across all three difficulties (clearing one difficulty uses the
week's only entry), and their gold is awarded regardless of Gold-Earner
status — an Extreme clear doesn't consume any of the 3-raid weekly cap.

## Aegir Extreme

Total gold includes Coin of Fire and Ice tokens (150 on Normal, 200 on
Hard/Nightmare) not reflected in the gold columns below. Patch notes don't
specify a character/roster/unbound split for this total — left blank rather
than guessed; the number itself is confirmed.

| Gate | Boss | Difficulty | Min iLvl | Character Gold | Roster Gold | Unbound Gold | Total Gold |
|---|---|---|---|---|---|---|---|
| — | Aegir, the Oppressor | Extreme Normal | 1720 | | | | 20,000 |
| — | Aegir, the Oppressor | Extreme Hard | 1750 | | | | 45,000 |
| — | Aegir, the Oppressor | Extreme Nightmare | 1770 | | | | 45,000 |

## Brelshaza Extreme

Same caveat as Aegir Extreme above — split not specified, totals confirmed.

| Gate | Boss | Difficulty | Min iLvl | Character Gold | Roster Gold | Unbound Gold | Total Gold |
|---|---|---|---|---|---|---|---|
| — | Phantom Manifester Brelshaza | Extreme Normal | 1720 | | | | 20,000 |
| — | Phantom Manifester Brelshaza | Extreme Hard | 1750 | | | | 45,000 |
| — | Phantom Manifester Brelshaza | Extreme Nightmare | 1770 | | | | 45,000 |

## Cathedral

Confirmed **100% Character-Bound Gold** (not roster/tradeable) — the first
raid in this table with a real, sourced split rather than a guess. Stage =
difficulty level (Stage 1/2/3 = Level 1/2/3), same 2 gates at every stage.

| Gate | Boss | Difficulty | Min iLvl | Character Gold | Roster Gold | Unbound Gold | Total Gold |
|---|---|---|---|---|---|---|---|
| 1 | Archbishop Arcenos | Level 1 | 1700 | 13,500 | 0 | 0 | 13,500 |
| 1 | Archbishop Arcenos | Level 2 | 1720 | 16,000 | 0 | 0 | 16,000 |
| 1 | Archbishop Arcenos | Level 3 | 1750 | 20,000 | 0 | 0 | 20,000 |
| 2 | Arcenos, Vanguard of Fanaticism | Level 1 | 1700 | 16,500 | 0 | 0 | 16,500 |
| 2 | Arcenos, Vanguard of Fanaticism | Level 2 | 1720 | 24,000 | 0 | 0 | 24,000 |
| 2 | Arcenos, Vanguard of Fanaticism | Level 3 | 1750 | 30,000 | 0 | 0 | 30,000 |

## Serca

iLvl confirmed directly from the raid's own release patch notes. Normal
difficulty's 50/50 split is also patch-note-confirmed current (June 2026).
Hard/Nightmare totals are maxroll-sourced, cross-checked against an
independent player-reported total (44,000 Hard / 54,000 Nightmare combined)
that matched exactly — confirmed **100% Unbound Gold** (not the 50/50 that
Normal pays), not the maxroll-default split assumption. See
`fullyUnboundDifficulties` on Serca's family entry in `raidFamilies.js`.

| Gate | Boss | Difficulty | Min iLvl | Character Gold | Roster Gold | Unbound Gold | Total Gold |
|---|---|---|---|---|---|---|---|
| 1 | Witch of Agony, Serca | Normal | 1710 | | 7,000 | 7,000 | 14,000 |
| 1 | Witch of Agony, Serca | Hard | 1730 | | 0 | 17,500 | 17,500 |
| 1 | Witch of Agony, Serca | Nightmare | 1740 | | 0 | 21,000 | 21,000 |
| 2 | Corvus Tul Rak | Normal | 1710 | | 10,500 | 10,500 | 21,000 |
| 2 | Corvus Tul Rak | Hard | 1730 | | 0 | 26,500 | 26,500 |
| 2 | Corvus Tul Rak | Nightmare | 1740 | | 0 | 33,000 | 33,000 |

## Kazeros

Normal difficulty's split (50/50 Roster-Bound/tradeable) is confirmed
current as of the June 2026 patch; Hard's total is maxroll-sourced.
Hard is confirmed **100% Unbound Gold** (not 50/50, and not the same as
Normal's split) — see `fullyUnboundDifficulties` on Kazeros' family entry
in `raidFamilies.js`.

| Gate | Boss | Difficulty | Min iLvl | Character Gold | Roster Gold | Unbound Gold | Total Gold |
|---|---|---|---|---|---|---|---|
| 1 | Abyss Lord Kazeros | Normal | 1710 | | 7,000 | 7,000 | 14,000 |
| 1 | Abyss Lord Kazeros | Hard | 1730 | | 0 | 17,000 | 17,000 |
| 2 | Archdemon Kazeros | Normal | 1710 | | 13,000 | 13,000 | 26,000 |
| 2 | Death Incarnate Kazeros | Hard | 1730 | | 0 | 35,000 | 35,000 |

## Armoche

Same caveat as Kazeros above — Normal's split is patch-note-confirmed
current; Hard's total is maxroll-sourced only, split unknown.

| Gate | Boss | Difficulty | Min iLvl | Character Gold | Roster Gold | Unbound Gold | Total Gold |
|---|---|---|---|---|---|---|---|
| 1 | Brelshaza, Ember in the Ashes | Normal | 1700 | | 6,250 | 6,250 | 12,500 |
| 1 | Brelshaza, Ember in the Ashes | Hard | 1720 | | | | 15,000 |
| 2 | Armoche, Sentinel of the Abyss | Normal | 1700 | | 10,250 | 10,250 | 20,500 |
| 2 | Armoche, Sentinel of the Abyss | Hard | 1720 | | | | 27,000 |

## Mordum

Fully confirmed current as of the June 2026 patch — every gate, both
difficulties, exact 50/50 split given directly in the patch note (this is
the raid the "20,000 → 14,000" example from that note was actually
describing — a split rebalance at unchanged total, not a cut; see Sources).

| Gate | Boss | Difficulty | Min iLvl | Character Gold | Roster Gold | Unbound Gold | Total Gold |
|---|---|---|---|---|---|---|---|
| 1 | Infernas | Normal | 1680 | | 2,000 | 2,000 | 4,000 |
| 1 | Infernas | Hard | 1700 | | 2,500 | 2,500 | 5,000 |
| 2 | Blossoming Fear, Naitreya | Normal | 1680 | | 3,500 | 3,500 | 7,000 |
| 2 | Blossoming Fear, Naitreya | Hard | 1700 | | 4,000 | 4,000 | 8,000 |
| 3 | Mordum, the Abyssal Punisher | Normal | 1680 | | 5,000 | 5,000 | 10,000 |
| 3 | Mordum, the Abyssal Punisher | Hard | 1700 | | 7,000 | 7,000 | 14,000 |

## Brelshaza

Fully confirmed current as of the June 2026 patch — every gate, both
difficulties, exact 50/50 split.

| Gate | Boss | Difficulty | Min iLvl | Character Gold | Roster Gold | Unbound Gold | Total Gold |
|---|---|---|---|---|---|---|---|
| 1 | Narok the Butcher | Normal | 1670 | | 2,750 | 2,750 | 5,500 |
| 1 | Narok the Butcher | Hard | 1690 | | 3,750 | 3,750 | 7,500 |
| 2 | Phantom Manifester Brelshaza | Normal | 1670 | | 5,500 | 5,500 | 11,000 |
| 2 | Phantom Manifester Brelshaza | Hard | 1690 | | 7,750 | 7,750 | 15,500 |

## Aegir

Fully confirmed current as of the June 2026 patch — every gate, both
difficulties, exact 50/50 split.

| Gate | Boss | Difficulty | Min iLvl | Character Gold | Roster Gold | Unbound Gold | Total Gold |
|---|---|---|---|---|---|---|---|
| 1 | Akkan, Lord of Death | Normal | 1660 | | 1,750 | 1,750 | 3,500 |
| 1 | Akkan, Lord of Death | Hard | 1680 | | 2,750 | 2,750 | 5,500 |
| 2 | Aegir, the Oppressor | Normal | 1660 | | 4,000 | 4,000 | 8,000 |
| 2 | Aegir, the Oppressor | Hard | 1680 | | 6,250 | 6,250 | 12,500 |

## Optimal weekly gold by iLvl

**Derived, not sourced** — computed from the Total Gold figures in the
sections above: at each iLvl, whichever 3 families sum to the highest total
(always at the hardest difficulty that iLvl unlocks), plus **both** Extreme
raids that iLvl unlocks (Aegir Extreme and Brelshaza Extreme each have
their own independent roster-wide weekly limit and don't consume the
3-family cap — confirmed they stack for double Extreme gold when both are
run the same week, see the note below the table).

**This table goes stale the moment the data above changes** — a new raid
added to this file, a gold figure corrected, or a new difficulty tier
discovered can all shuffle which 3 families are actually optimal at a given
iLvl (this already happened once while building it: Armoche drops out of
the top 3 at 1750 once Cathedral L3 and Serca Nightmare unlock, despite
Armoche's own numbers not changing). **Whenever any raid/gold/iLvl value
above is added or edited, re-run this ranking by hand and update the table
— don't assume it still holds.**

| iLvl | Best 3 families (difficulty) | Subtotal | Extreme (both, if unlocked) | Extreme gold | Weekly total |
|---|---|---|---|---|---|
| 1660 | Aegir (N) — only one unlocked | 11,500 | — | — | 11,500 |
| 1670 | Brelshaza (N), Aegir (N) — only two | 28,000 | — | — | 28,000 |
| 1680 | Mordum (N), Aegir (H), Brelshaza (N) | 55,500 | — | — | 55,500 |
| 1690 | Brelshaza (H), Mordum (N), Aegir (H) | 62,000 | — | — | 62,000 |
| 1700 | Armoche (N), Cathedral (L1), Mordum (H) | 90,000 | — | — | 90,000 |
| 1710 | Kazeros (N), Serca (N), Armoche (N) | 108,000 | — | — | 108,000 |
| 1720 | Armoche (H), Kazeros (N), Cathedral (L2) | 122,000 | Aegir Extreme (N) + Brelshaza Extreme (N) | 40,000 | 162,000 |
| 1730 | Kazeros (H), Serca (H), Armoche (H) | 138,000 | Aegir Extreme (N) + Brelshaza Extreme (N) | 40,000 | 178,000 |
| 1740 | Serca (NM), Kazeros (H), Armoche (H) | 148,000 | Aegir Extreme (N) + Brelshaza Extreme (N) | 40,000 | 188,000 |
| 1750 | Serca (NM), Kazeros (H), Cathedral (L3) | 156,000 | Aegir Extreme (H) + Brelshaza Extreme (H) | 90,000 | 246,000 |
| 1770 | Serca (NM), Kazeros (H), Cathedral (L3) | 156,000 | Aegir Extreme (NM) + Brelshaza Extreme (NM) | 90,000 | 246,000* |

\* Same gold as 1750 — nothing currently in this file unlocks a
higher-paying tier between 1750 and 1770; Extreme Nightmare only adds
harder content/title rewards at this iLvl, not more gold.

Live-code-verified (2026-08-30): a from-scratch ground-truth
implementation, cross-checked against `challengeRaids.js`'s picker,
`goldEstimate.js`'s live weekly calc (`/bonk`), and `clearHistory.js`'s
DB-backed calc (`/my-stats`/`/character-page`), agreed exactly with every
row above at every gear-score breakpoint from 1600-1800, including the
doubled Extreme total.

Notes:
- Cathedral's gold is 100% Character-Bound (not Roster/Unbound like the
  others) — maximizes raw weekly gold, but that gold can't move to other
  roster characters the way the rest can.
- Kazeros/Armoche Hard totals feeding the 1730+/1720+ rows are the
  maxroll-only figures noted in "Still missing" below — totals are
  consistent enough to rank confidently, just not patch-note-confirmed like
  the rest.
- Below 1660, nothing this file tracks has an unlocked family yet — legacy
  raids (Valtan, Vykas, etc.) exist below that but aren't part of
  `raidFamilies.js`'s tracked raid list, so they're outside this table.
- Aegir Extreme vs. Brelshaza Extreme is a wash (identical gold at every
  tier) — and since each has its own independent 1/roster/week limit, a
  roster could run **both** in the same week for double the Extreme gold
  shown here, if desired.

## Still missing

- **Armoche Hard difficulty split** — totals are maxroll-sourced (15,000 /
  27,000) and consistent with the Normal totals the June 2026 patch
  confirmed unchanged, but the patch note's split breakdown was explicitly
  Normal-difficulty-only, so Hard's Roster/Unbound columns still assume the
  50/50 default rather than being confirmed. (Kazeros Hard was in this same
  situation until confirmed 100% Unbound — see the Kazeros section above —
  so Armoche Hard being 50/50 rather than 100% Unbound too isn't a safe
  assumption either way; it's just the current best guess.)
- **Character Gold column, everywhere except Cathedral** — every standard
  8-player raid gate's gold above is confirmed split only between
  "Roster-Bound" and what the patch notes call "Normal" (read here as
  tradeable/Unbound — see the mapping note where this was decided). No
  source found describes a genuine third *character-only, non-roster*
  pool for these raids the way Cathedral has one — it may simply not exist
  outside solo-mode/Cathedral-style content, but that's an inference, not a
  confirmed absence.
- **Aegir Extreme / Brelshaza Extreme's split** — the total per difficulty
  is confirmed (see those sections above) but patch notes don't break down
  which gold type it's paid in.

## Sources

- [Maxroll — Gear Progression Guide](https://maxroll.gg/lost-ark/resources/gear-progression-guide)
- [Maxroll — Aegir Gate 1](https://maxroll.gg/lost-ark/kazeros-raids/aegir-gate-1) / [Gate 2](https://maxroll.gg/lost-ark/kazeros-raids/aegir-gate-2)
- [Maxroll — Brelshaza Gate 1](https://maxroll.gg/lost-ark/kazeros-raids/kazeros-raid-brelshaza-gate-1) / [Gate 2](https://maxroll.gg/lost-ark/kazeros-raids/kazeros-raid-brelshaza-gate-2)
- [Maxroll — Mordum Gate 1](https://maxroll.gg/lost-ark/kazeros-raids/kazeros-raid-mordum-gate-1) / [Gate 2](https://maxroll.gg/lost-ark/kazeros-raids/kazeros-raid-mordum-gate-2) / [Gate 3](https://maxroll.gg/lost-ark/kazeros-raids/kazeros-raid-mordum-gate-3)
- [Maxroll — Armoche Gate 1](https://maxroll.gg/lost-ark/kazeros-raids/kazeros-raid-armoche-gate-1-guide) / [Gate 2](https://maxroll.gg/lost-ark/kazeros-raids/kazeros-raid-armoche-gate-2-guide)
- [Maxroll — Kazeros Gate 1](https://maxroll.gg/lost-ark/kazeros-raids/kazeros-gate-1-guide) / [Gate 2](https://maxroll.gg/lost-ark/kazeros-raids/kazeros-gate-2-guide)
- [Maxroll — How to Make Gold & Silver](https://maxroll.gg/lost-ark/resources/how-to-make-gold-silver) (source for the "6 gold earners, 3 raids/week each" rule)
- [Official — Summer of Extremes (Jul 2026)](https://www.playlostark.com/en-us/game/releases/summer-of-extremes) — Aegir Extreme
- [Official — The Bitter Cold (Aug 2026)](https://www.playlostark.com/en-us/game/releases/the-bitter-cold) — Brelshaza Extreme
- [Official — The Twilight Isle (Jun 2026)](https://www.playlostark.com/en-us/game/releases/the-twilight-isle) — Horizon Cathedral, gold-reduction patch note
- [Official — The Shadows Rise (Apr 2026)](https://www.playlostark.com/en-us/game/releases/the-shadows-rise) — Serca release iLvl
- [Official — Guardians' Rage (Jan 2026)](https://www.playlostark.com/en-us/game/releases/guardians-rage) — earlier gold-reduction patch note
- [Maxroll — Serca Gate 1](https://maxroll.gg/lost-ark/shadow-raids/shadow-raid-serca-gate-1-guide) / [Gate 2](https://maxroll.gg/lost-ark/shadow-raids/shadow-raid-serca-gate-2-guide)
