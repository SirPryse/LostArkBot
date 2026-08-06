import { Events } from 'discord.js';
import { createDiscordClient, loginDiscordClient } from './discord/client.js';
import { startPolling } from './scheduler/poller.js';
import { config } from './config.js';

const client = createDiscordClient();

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);

  startPolling(client);
  console.log(`Polling every ${config.pollIntervalMinutes} minute(s).`);
});

await loginDiscordClient(client);
