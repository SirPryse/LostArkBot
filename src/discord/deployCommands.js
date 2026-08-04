import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { announceChannelCommand } from './commands/announceChannel.js';
import { checkNowCommand } from './commands/checkNow.js';
import { recentRaidsCommand } from './commands/recentRaids.js';
import { registeredUsersCommand } from './commands/registeredUsers.js';
import { trackCharacterCommand } from './commands/trackCharacter.js';

const commands = [
  announceChannelCommand,
  checkNowCommand,
  recentRaidsCommand,
  registeredUsersCommand,
  trackCharacterCommand,
].map((command) => command.data.toJSON());

const rest = new REST().setToken(config.discordToken);

const data = await rest.put(Routes.applicationCommands(config.discordClientId), { body: commands });

console.log(`Registered ${data.length} global slash command(s).`);
