import { Events } from 'discord.js';
import { createDiscordClient, loginDiscordClient } from './discord/client.js';
import { createRaidPollWorker } from './scheduler/worker.js';
import { startTickScheduler } from './scheduler/queue.js';
import { config } from './config.js';

const client = createDiscordClient();

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  createRaidPollWorker(client);
  await startTickScheduler();
  console.log(`Polling every ${config.pollIntervalMinutes} minute(s).`);
});

await loginDiscordClient(client);
