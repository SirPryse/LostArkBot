import { Events, ActivityType } from 'discord.js';
import { createDiscordClient, loginDiscordClient } from './discord/client.js';
import { startPolling } from './scheduler/poller.js';
import { startWeeklyResetSchedule } from './scheduler/weeklyReset.js';
import { startOAuthServer } from './web/server.js';
import { config } from './config.js';
import { pool } from './db/pool.js';

// Safety net for anything that slips through a command/poll's own try/catch
// — without this, an uncaught error anywhere crashes the whole process.
// That matters more now than it used to: BullMQ used to give per-job
// failure isolation for free, but polling runs in-process now (see
// poller.js), so there's no queue between "one character's poll throws" and
// "the whole bot goes down" other than the try/catch already in place.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  // Node's own guidance: the process is in an undefined state after this,
  // so exit rather than keep running — Fly restarts it automatically.
  process.exit(1);
});

const client = createDiscordClient();

// Independent of the Discord gateway entirely — only touches lostark.bible
// and Postgres, so it starts (and keeps working) regardless of Discord
// connection state.
const oauthServer = startOAuthServer();

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);

  client.user.setActivity('Lost Ark', { type: ActivityType.Playing });

  startPolling(client);
  console.log(`Polling every ${config.pollIntervalMinutes} minute(s).`);

  startWeeklyResetSchedule(client);
});

// Every Fly deploy sends SIGTERM to the old machine before killing it —
// without this, that's always an abrupt kill mid-request (confirmed live
// in the logs during today's deploys: "Sending signal SIGINT..." followed
// immediately by a restart), never a clean shutdown.
async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  await client.destroy();
  await new Promise((resolve) => oauthServer.close(resolve));
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await loginDiscordClient(client);
