import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'classes');

/**
 * lostark.bible's logs API returns a human-readable class name (e.g.
 * "Bard", "Slayer"), but the icon files (and the rosters API's `class`
 * field) use the snake_case roster key (e.g. "bard", "berserker_female") —
 * the two are NOT a simple lowercase transform (e.g. Berserker ->
 * berserker, but Slayer -> berserker_female). This is the inverse of
 * RaidPlanner's src/app/core/utils/class-data.ts CLASS_NAMES map, which is
 * the source of truth for both the mapping and the icon files themselves
 * (copied into assets/classes/ from there).
 */
const ICON_KEY_BY_DISPLAY_NAME = {
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

const DISPLAY_NAME_BY_ICON_KEY = Object.fromEntries(
  Object.entries(ICON_KEY_BY_DISPLAY_NAME).map(([displayName, key]) => [key, displayName]),
);

/**
 * Application emoji IDs — uploaded once via PUT /applications/{id}/emojis
 * from the same assets/classes/*.png files, name = icon key. Application
 * emojis are usable in any server the bot is in and persist across deploys,
 * so these are just hardcoded after that one-time upload.
 */
const EMOJI_ID_BY_ICON_KEY = {
  alchemist: '1534629451713876219',
  arcana: '1534629455979483228',
  bard: '1534629459326668852',
  battle_master: '1534629463466311782',
  battle_master_male: '1534629467761147914',
  berserker: '1534629472580407408',
  berserker_female: '1534629476728570028',
  blade: '1534629480671346719',
  blaster: '1534629484152623154',
  demonic: '1534629488879734836',
  destroyer: '1534629493057257583',
  devil_hunter: '1534629500208287785',
  devil_hunter_female: '1534629510958420038',
  dragon_knight: '1534629516931104798',
  elemental_master: '1534629520643199037',
  force_master: '1534629524564742194',
  hawk_eye: '1534629527903277171',
  holyknight: '1534629532324069557',
  holyknight_female: '1534629537466421409',
  infighter: '1534629540956213409',
  infighter_male: '1534629544877887738',
  lance_master: '1534629548489183422',
  reaper: '1534629552230240346',
  scouter: '1534629555812303049',
  soul_eater: '1534629559604084968',
  summoner: '1534629563378700308',
  warlord: '1534629566822355006',
  weather_artist: '1534629570706149627',
  yinyangshi: '1534629574540001410',
};

/** For a class display name (from the logs API, e.g. "Sorceress"). */
export function getClassIconPath(className) {
  const key = ICON_KEY_BY_DISPLAY_NAME[className];
  return key ? path.join(ASSETS_DIR, `${key}.png`) : null;
}

export function getDisplayNameForIconKey(key) {
  return DISPLAY_NAME_BY_ICON_KEY[key] ?? key;
}

/** For a select menu option's `.setEmoji()` — accepts either a display name
 * (e.g. "Sorceress") or a roster icon key (e.g. "elemental_master"); the
 * rosters API's `class` field is already the icon key, no translation
 * needed there. */
export function getClassEmoji(classNameOrIconKey) {
  const key = ICON_KEY_BY_DISPLAY_NAME[classNameOrIconKey] ?? classNameOrIconKey;
  const id = EMOJI_ID_BY_ICON_KEY[key];
  return id ? { id, name: key } : null;
}
