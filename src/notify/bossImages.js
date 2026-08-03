import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'bosses');
const PLACEHOLDER = path.join(ASSETS_DIR, 'lostark.png');
const CATHEDRAL = path.join(ASSETS_DIR, 'cathedral.png');
const SERCA = path.join(ASSETS_DIR, 'serca.png');

/**
 * Boss name -> portrait image file. Every entry points at the same
 * placeholder for now — drop a real PNG into assets/bosses/ and change its
 * path here to swap it in for that boss.
 */
const BOSS_IMAGES = {
  'Aegir, the Oppressor': PLACEHOLDER,
  'Death Incarnate Kazeros': PLACEHOLDER,
  'Abyss Lord Kazeros': PLACEHOLDER,
  'Armoche, Sentinel of the Abyss': PLACEHOLDER,
  'Brelshaza, Ember in the Ashes': PLACEHOLDER,
  'Corvus Tul Rak': SERCA,
  'Witch of Agony, Serca': SERCA,
  'Arcenos, Vanguard of Fanaticism': CATHEDRAL,
  'Archbishop Arcenos': CATHEDRAL
};

export function getBossImagePath(bossName) {
  return BOSS_IMAGES[bossName] ?? PLACEHOLDER;
}
