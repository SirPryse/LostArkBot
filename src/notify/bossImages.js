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
// Sitting in assets/bosses/ but not yet wired to a boss name below:
// mordum-gate1/2/3.webp (not Kazeros/Armoche's art, unclear what they are),
// armoche-gate1.webp (Armoche's other gate), echidna.webp.

/**
 * Boss name -> banner image file. Drop a real image into assets/bosses/ and
 * point its path here to swap it in for that boss.
 */
const BOSS_IMAGES = {
  'Aegir, the Oppressor': AEGIR,
  'Death Incarnate Kazeros': KAZEROS_GATE_2,
  'Abyss Lord Kazeros': KAZEROS_GATE_1,
  'Armoche, Sentinel of the Abyss': ARMOCHE_GATE_2,
  'Brelshaza, Ember in the Ashes': ARMOCHE_GATE_1,
  'Corvus Tul Rak': SERCA,
  'Witch of Agony, Serca': SERCA,
  'Arcenos, Vanguard of Fanaticism': CATHEDRAL,
  'Archbishop Arcenos': CATHEDRAL
};

export function getBossImagePath(bossName) {
  return BOSS_IMAGES[bossName] ?? PLACEHOLDER;
}
