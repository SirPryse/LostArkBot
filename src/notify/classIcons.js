import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'classes');

/**
 * lostark.bible's logs API returns a human-readable class name (e.g.
 * "Bard", "Slayer"), but the icon files use the snake_case roster key (e.g.
 * "bard", "berserker_female") — the two are NOT a simple lowercase
 * transform (e.g. Berserker -> berserker, but Slayer -> berserker_female).
 * This is the inverse of RaidPlanner's src/app/core/utils/class-data.ts
 * CLASS_NAMES map, which is the source of truth for both the mapping and
 * the icon files themselves (copied into assets/classes/ from there).
 */
const DISPLAY_NAME_TO_ICON_KEY = {
  Wildsoul: 'alchemist',
  Arcana: 'arcana',
  Bard: 'bard',
  Wardancer: 'battle_master',
  Striker: 'battle_master_male',
  Berserker: 'berserker',
  Slayer: 'berserker_female',
  Deathblade: 'blade',
  Artillerist: 'blaster',
  Shadowhunter: 'demonic',
  Destroyer: 'destroyer',
  Deadeye: 'devil_hunter',
  Gunslinger: 'devil_hunter_female',
  'Guardian Knight': 'dragon_knight',
  Sorceress: 'elemental_master',
  Soulfist: 'force_master',
  Sharpshooter: 'hawk_eye',
  Paladin: 'holyknight',
  Valkyrie: 'holyknight_female',
  Scrapper: 'infighter',
  Breaker: 'infighter_male',
  Glaivier: 'lance_master',
  Reaper: 'reaper',
  Scouter: 'scouter',
  Souleater: 'soul_eater',
  Summoner: 'summoner',
  Gunlancer: 'warlord',
  Aeromancer: 'weather_artist',
  Artist: 'yinyangshi',
};

export function getClassIconPath(className) {
  const key = DISPLAY_NAME_TO_ICON_KEY[className];
  if (!key) return null;
  return path.join(ASSETS_DIR, `${key}.png`);
}
