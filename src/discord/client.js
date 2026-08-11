import { Client, GatewayIntentBits, Collection, MessageFlags, Events, ActivityType } from 'discord.js';
import { GatewayOpcodes } from 'discord-api-types/v10';
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
import { clearChannelCommand } from './commands/clearChannel.js';
import { rosterPageCommand } from './commands/rosterPage.js';
import { guessParseCommand } from './commands/guessParse.js';
import { guessLeaderboardCommand } from './commands/guessLeaderboard.js';
import { untrackAllCommand } from './commands/untrackAll.js';
import { leaveServerCommand } from './commands/leaveServer.js';
import { linkAccountCommand } from './commands/linkAccount.js';

const COMMANDS = [
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
  clearChannelCommand,
  rosterPageCommand,
  guessParseCommand,
  guessLeaderboardCommand,
  untrackAllCommand,
  leaveServerCommand,
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

/** "Playing Lost Ark" with a live elapsed-time counter and a custom icon —
 * the kind of thing a real game client's Rich Presence shows.
 * client.user.setActivity() can't do either: discord.js's
 * ClientPresence._parse() only forwards {type, name, state, url} from
 * whatever you pass it, silently dropping `timestamps`/`assets` (confirmed
 * by reading discord.js's own source, not guessed). So this sends a raw
 * Gateway Presence Update directly instead, using WebSocketShard#send —
 * that's actually public API (unlike WebSocketManager#broadcast, which is
 * marked private in discord.js's own typings) — hence going through the
 * single shard directly rather than client.ws.broadcast(). This bot never
 * shards (one small bot, one process), so shard 0 is always the right (and
 * only) one.
 *
 * The icon references a Rich Presence Art Asset uploaded manually via the
 * Developer Portal (named "lostark") — confirmed live against Discord's
 * real API that bots are hard-blocked from the endpoint that would let a
 * bot register an *external* image URL for its own presence ("Bots cannot
 * use this endpoint", code 20001), so a pre-uploaded named asset is the
 * only way to get a custom image in at all. */
export function setPlayingLostArk(client) {
  const shard = client.ws.shards.get(0);
  if (!shard) return;

  shard.send({
    op: GatewayOpcodes.PresenceUpdate,
    d: {
      since: null,
      activities: [
        {
          name: 'Lost Ark',
          type: ActivityType.Playing,
          timestamps: { start: Date.now() },
          assets: { large_image: 'lostark', large_text: 'Lost Ark' },
        },
      ],
      status: 'online',
      afk: false,
    },
  });
}
