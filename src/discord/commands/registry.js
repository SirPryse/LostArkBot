import { announceChannelCommand } from './announceChannel.js';
import { checkNowCommand } from './checkNow.js';
import { recentRaidsCommand } from './recentRaids.js';
import { registeredUsersCommand } from './registeredUsers.js';
import { trackCharacterCommand } from './trackCharacter.js';
import { untrackCharacterCommand } from './untrackCharacter.js';
import { characterPageCommand } from './characterPage.js';
import { bonkCommand } from './bonk.js';
import { bonkHardCommand } from './bonkHard.js';
import { nukeCommand } from './nuke.js';
import { myStatsCommand } from './myStats.js';
import { guessParseCommand } from './guessParse.js';
import { guessLeaderboardCommand } from './guessLeaderboard.js';
import { untrackAllCommand } from './untrackAll.js';
import { leaveServerCommand } from './leaveServer.js';
import { linkAccountCommand } from './linkAccount.js';
import { goldEarnersCommand } from './goldEarners.js';
import { challengeCommand } from './challenge.js';
import { challengeHistoryCommand } from './challengeHistory.js';

/** Every slash command except /help. Split out from index.js so help.js
 * can list them without importing itself (help.js -> index.js -> help.js
 * would be a load-order cycle). index.js adds /help to make the full list
 * that client.js and deployCommands.js use. */
export const CORE_COMMANDS = [
  announceChannelCommand,
  checkNowCommand,
  recentRaidsCommand,
  registeredUsersCommand,
  linkAccountCommand,
  goldEarnersCommand,
  challengeCommand,
  challengeHistoryCommand,
  trackCharacterCommand,
  untrackCharacterCommand,
  characterPageCommand,
  bonkCommand,
  bonkHardCommand,
  nukeCommand,
  myStatsCommand,
  guessParseCommand,
  guessLeaderboardCommand,
  untrackAllCommand,
  leaveServerCommand,
];
