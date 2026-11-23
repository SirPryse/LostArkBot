import { Client, GatewayIntentBits, Collection, MessageFlags, Events } from 'discord.js';
import { config } from '../config.js';
import { COMMANDS } from './commands/index.js';

async function replyWithError(interaction, err, label) {
  console.error(`Error handling ${label}:`, err);
  const reply = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
  // The error reply itself can fail too (interaction token expired after 15
  // min, message deleted, Discord hiccup) — log it rather than letting it
  // escape as an unhandled rejection from the event listener.
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  } catch (replyErr) {
    console.error(`Couldn't send the error reply for ${label}:`, replyErr.message);
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
