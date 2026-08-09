import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'bosses');
const asset = (file) => path.join(ASSETS_DIR, file);

const PLACEHOLDER = asset('lostark.png');
const CATHEDRAL = asset('cathedral.webp');
const SERCA = asset('serca.webp');
const AEGIR = asset('aegir.webp');
const BRELSHAZA = asset('brelshaza.webp');
// Kazeros' raid has two forms across its gates — kazeros-gate1 is the
// darker/earlier form, kazeros-gate2 the transformed, lighter final form —
// matched via Maxroll's own guide-page banners for "Kazeros Gate 1/2 Guide".
const KAZEROS_GATE_1 = asset('kazeros-gate1.webp');
const KAZEROS_GATE_2 = asset('kazeros-gate2.webp');
// Armoche's raid, from Maxroll's "Kazeros Raid Armoche Gate 1/2 Guide"
// banners. Gate 2's art is explicitly Armoche (armoche_FI.webp); gate 1's
// art isn't currently wired to a boss name of its own.
const ARMOCHE_GATE_1 = asset('armoche-gate1.webp');
const ARMOCHE_GATE_2 = asset('armoche-gate2.webp');
const MORDUM_GATE_1 = asset('mordum-gate1.webp');
const MORDUM_GATE_2 = asset('mordum-gate2.webp');
const MORDUM_GATE_3 = asset('mordum-gate3.webp');
// Sitting in assets/bosses/ but not yet wired to a boss name below:
// echidna.webp (not a currently-tracked raid).

/**
 * Boss name -> banner image file. Drop a real image into assets/bosses/ and
 * point its path here to swap it in for that boss.
 */
const BOSS_IMAGES = {
  'Aegir, the Oppressor': AEGIR,
  // Maxroll doesn't have gate-specific art for this raid — both the
  // "Aegir Gate 1" (Akkan) and "Aegir Gate 2" (Aegir) guide pages use the
  // identical banner, confirmed by comparing the downloaded images pixel
  // for pixel.
  'Akkan, Lord of Death': AEGIR,
  'Death Incarnate Kazeros': KAZEROS_GATE_2,
  'Archdemon Kazeros': KAZEROS_GATE_2,
  'Abyss Lord Kazeros': KAZEROS_GATE_1,
  'Armoche, Sentinel of the Abyss': ARMOCHE_GATE_2,
  'Brelshaza, Ember in the Ashes': ARMOCHE_GATE_1,
  'Corvus Tul Rak': SERCA,
  'Witch of Agony, Serca': SERCA,
  'Arcenos, Vanguard of Fanaticism': CATHEDRAL,
  'Archbishop Arcenos': CATHEDRAL,
  // The *other* Brelshaza raid (Narok the Butcher / Phantom Manifester
  // Brelshaza, see raidFamilies.js) — not the same raid as "Brelshaza,
  // Ember in the Ashes" above, just a reused in-game name.
  'Narok the Butcher': BRELSHAZA,
  'Phantom Manifester Brelshaza': BRELSHAZA,
  'Infernas': MORDUM_GATE_1,
  'Blossoming Fear, Naitreya': MORDUM_GATE_2,
  'Mordum, the Abyssal Punisher': MORDUM_GATE_3,
};

export function getBossImagePath(bossName) {
  return BOSS_IMAGES[bossName] ?? PLACEHOLDER;
}
