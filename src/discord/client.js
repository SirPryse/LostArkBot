import { Client, GatewayIntentBits, Collection, MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { announceChannelCommand } from './commands/announceChannel.js';
import { checkNowCommand } from './commands/checkNow.js';
import { recentRaidsCommand } from './commands/recentRaids.js';
import { registeredUsersCommand } from './commands/registeredUsers.js';
import { trackCharacterCommand } from './commands/trackCharacter.js';
import { untrackCharacterCommand } from './commands/untrackCharacter.js';
import { characterPageCommand } from './commands/characterPage.js';
import { bonkCommand } from './commands/bonk.js';
import { clearChannelCommand } from './commands/clearChannel.js';
import { rosterPageCommand } from './commands/rosterPage.js';

const COMMANDS = [
  announceChannelCommand,
  checkNowCommand,
  recentRaidsCommand,
  registeredUsersCommand,
  trackCharacterCommand,
  untrackCharacterCommand,
  characterPageCommand,
  bonkCommand,
  clearChannelCommand,
  rosterPageCommand,
];

async function replyWithError(interaction, err, label) {
  console.error(`Error handling ${label}:`, err);
  const reply = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(reply);
  } else {
    await interaction.reply(reply);
  }
}

export function createDiscordClient() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.commands = new Collection();
  for (const command of COMMANDS) {
    client.commands.set(command.data.name, command);
  }

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (err) {
        await replyWithError(interaction, err, `command ${interaction.commandName}`);
      }
      return;
    }

    if (interaction.isMessageComponent()) {
      for (const command of COMMANDS) {
        const handler = command.componentHandlers?.find((h) => interaction.customId.startsWith(h.prefix));
        if (!handler) continue;
        try {
          await handler.handle(interaction);
        } catch (err) {
          await replyWithError(interaction, err, `component ${interaction.customId}`);
        }
        return;
      }
    }
  });

  return client;
}

export function loginDiscordClient(client) {
  return client.login(config.discordToken);
}
