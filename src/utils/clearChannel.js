import { sleep } from './sleep.js';

const FETCH_BATCH_SIZE = 100; // Discord's max per fetch/bulkDelete call
const MAX_MESSAGES = 10000; // safety cap so a huge channel can't run forever
const INDIVIDUAL_DELETE_DELAY_MS = 1100; // messages >14 days old can't bulk-delete, must go one at a time
// Individual deletes are slow enough (~1.2/sec) that clearing a lot of old
// messages could outlast the ~15min window Discord gives an interaction
// token to edit its reply. Capped well under that so a caller relying on
// that window (e.g. /clear-channel's final status edit) can always still
// send it.
const MAX_INDIVIDUAL_DELETES = 300;

/** Deletes every message in the channel. Bulk-deletes whatever's under
 * Discord's 14-day bulk-delete window in one call per 100; anything older
 * has to be removed one at a time (much slower, rate-limited). Shared by
 * /clear-channel and the weekly reset scheduler — same deletion logic
 * either way, just triggered manually vs. on a timer. */
export async function clearChannel(channel) {
  let deleted = 0;
  let individualDeletes = 0;
  let hitCap = false;

  outer: for (;;) {
    const batch = await channel.messages.fetch({ limit: FETCH_BATCH_SIZE });
    if (batch.size === 0) break;

    const bulkDeleted = await channel.bulkDelete(batch, true); // true = silently skip messages >14 days old
    deleted += bulkDeleted.size;

    const tooOld = batch.filter((m) => !bulkDeleted.has(m.id));
    for (const message of tooOld.values()) {
      if (individualDeletes >= MAX_INDIVIDUAL_DELETES) {
        hitCap = true;
        break outer;
      }
      await message.delete().catch(() => {}); // already gone, permissions changed mid-run, etc.
      deleted += 1;
      individualDeletes += 1;
      await sleep(INDIVIDUAL_DELETE_DELAY_MS);
    }

    if (deleted >= MAX_MESSAGES) {
      hitCap = true;
      break;
    }
  }

  return { deleted, hitCap };
}
