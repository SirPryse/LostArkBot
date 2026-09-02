import { Events } from 'discord.js';
import { createDiscordClient, loginDiscordClient } from './discord/client.js';
import { startPolling, startChallengeExpiryChecking } from './scheduler/poller.js';
import { startWeeklyResetSchedule } from './scheduler/weeklyReset.js';
import { startPresenceUpdates } from './discord/presence.js';
import { startOAuthServer } from './web/server.js';
import { closeAllActiveRounds } from './discord/commands/guessParse.js';
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
  // so exit rather than keep running — Fly restarts it automatically. But
  // a bare process.exit() here orphans any /guess-parse round still open
  // at the moment of the crash — confirmed live: a Discord connectivity
  // blip crashed the process, and since closeAllActiveRounds() previously
  // only ran on the graceful SIGTERM/SIGINT path (see shutdown() below),
  // the round's message was left stuck until the next weekly reset
  // incidentally cleared the channel ~13 hours later. Race against a
  // timeout rather than awaiting it unconditionally — if the crash was
  // itself caused by Discord connectivity trouble (as it was that time),
  // further Discord API calls might also hang, and this still has to exit
  // either way.
  Promise.race([
    closeAllActiveRounds().catch((closeErr) =>
      console.error('Failed to close active guess-parse rounds during crash:', closeErr),
    ),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]).finally(() => process.exit(1));
});

const client = createDiscordClient();

// Independent of the Discord gateway entirely — only touches lostark.bible
// and Postgres, so it starts (and keeps working) regardless of Discord
// connection state.
const oauthServer = startOAuthServer();

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);

  startPolling(client);
  console.log(
    `Polling Gold Earners every ${config.goldEarnerPollIntervalMinutes} minute(s), ` +
      `everyone else every ${config.otherPollIntervalMinutes} minute(s).`,
  );

  startChallengeExpiryChecking(client);
  console.log(`Checking for expired challenges every ${config.challengeExpiryCheckIntervalMinutes} minute(s).`);

  startWeeklyResetSchedule(client);

  startPresenceUpdates(client);
});

// Every Fly deploy sends SIGTERM to the old machine before killing it —
// without this, that's always an abrupt kill mid-request (confirmed live
// in the logs during today's deploys: "Sending signal SIGINT..." followed
// immediately by a restart), never a clean shutdown.
async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  // Before the gateway/REST client goes away — any /guess-parse round still
  // open at this point would otherwise be orphaned (its in-memory state and
  // timeout both wiped by the restart, message left stuck forever). Closing
  // them out first means they resolve early instead, same as a normal
  // timeout reveal. Needs the client to still be usable, hence ahead of
  // client.destroy() below.
  await closeAllActiveRounds().catch((err) => console.error('Failed to close active guess-parse rounds:', err));
  await client.destroy();
  await new Promise((resolve) => oauthServer.close(resolve));
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await loginDiscordClient(client);
