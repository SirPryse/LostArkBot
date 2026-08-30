import { Client, GatewayIntentBits, Collection, MessageFlags, Events } from 'discord.js';
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
import { goldEarnersCommand } from './commands/goldEarners.js';
import { challengeCommand } from './commands/challenge.js';
import { challengeHistoryCommand } from './commands/challengeHistory.js';
import { helpCommand } from './commands/help.js';

const COMMANDS = [
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
  helpCommand,
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

  // Node's EventEmitter throws (crashing the process) if an 'error' event
  // has zero listeners — and discord.js's Client can emit one on a gateway
  // connection problem. Without this, a transient network blip would take
  // the whole bot down instead of just logging and letting discord.js's own
  // reconnect logic handle it.
  client.on(Events.Error, (err) => console.error('Discord client error:', err));
  client.on(Events.ShardError, (err) => console.error('Discord shard error:', err));

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
