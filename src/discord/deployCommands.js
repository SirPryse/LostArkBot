import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { announceChannelCommand } from './commands/announceChannel.js';
import { checkNowCommand } from './commands/checkNow.js';
import { recentRaidsCommand } from './commands/recentRaids.js';
import { registeredUsersCommand } from './commands/registeredUsers.js';
import { trackCharacterCommand } from './commands/trackCharacter.js';
import { untrackCharacterCommand } from './commands/untrackCharacter.js';
import { characterPageCommand } from './commands/characterPage.js';
import { bonkCommand } from './commands/bonk.js';
import { bonkHardCommand } from './commands/bonkHard.js';
import { nukeCommand } from './commands/nuke.js';
import { myStatsCommand } from './commands/myStats.js';
import { guessParseCommand } from './commands/guessParse.js';
import { guessLeaderboardCommand } from './commands/guessLeaderboard.js';
import { untrackAllCommand } from './commands/untrackAll.js';
import { leaveServerCommand } from './commands/leaveServer.js';
import { linkAccountCommand } from './commands/linkAccount.js';

const commands = [
  announceChannelCommand,
  checkNowCommand,
  recentRaidsCommand,
  registeredUsersCommand,
  linkAccountCommand,
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
].map((command) => command.data.toJSON());

const rest = new REST().setToken(config.discordToken);

const data = await rest.put(Routes.applicationCommands(config.discordClientId), { body: commands });

console.log(`Registered ${data.length} global slash command(s).`);
