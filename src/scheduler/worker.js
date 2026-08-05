import { Worker } from 'bullmq';
import { connection } from './connection.js';
import { raidPollQueue } from './queue.js';
import { listEnabledWithAccount, getEnabledWithAccountById, updateLastSeen } from '../db/trackedCharacters.js';
import { markNeedsReauth } from '../db/linkedAccounts.js';
import { getAnnouncementChannel } from '../db/guildSettings.js';
import { recordClear } from '../db/clearHistory.js';
import { getCharacterLogs } from '../lostarkbible/client.js';
import { decryptToken } from '../crypto/tokenCipher.js';
import { buildClearMessage, getRole } from '../notify/embed.js';
import { TokenExpiredError, InsufficientScopeError } from '../lostarkbible/errors.js';

const CHECK_JOB_OPTS = { removeOnComplete: true, removeOnFail: true };

async function processTick() {
  const rows = await listEnabledWithAccount();
  for (const row of rows) {
    await raidPollQueue.add('check-character', { trackedCharacterId: row.id }, CHECK_JOB_OPTS);
  }
}

async function processCheckCharacter(discordClient, { trackedCharacterId }) {
  const row = await getEnabledWithAccountById(trackedCharacterId);
  if (!row) return; // disabled/deleted since it was queued

  if (row.account_status !== 'active') return;
  if (new Date(row.token_expires_at) <= new Date()) {
    await markNeedsReauth(row.linked_account_id);
    return;
  }

  const accessToken = decryptToken(row.access_token);

  let entries;
  try {
    entries = await getCharacterLogs(accessToken, row.character_name, row.region, { page: 1 });
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      await markNeedsReauth(row.linked_account_id);
      return;
    }
    if (err instanceof InsufficientScopeError) {
      console.warn(`lostark.bible: missing scope for linked account ${row.linked_account_id}`);
      return;
    }
    throw err;
  }

  if (!entries || entries.length === 0) return; // 404 or no logs yet

  const newest = entries[0];
  const identity = { className: newest.class, role: getRole(newest) };

  if (!row.last_seen_log_id) {
    // First-ever check for this character: record a baseline instead of
    // announcing their entire clear history.
    await updateLastSeen(row.id, newest.id, identity);
    return;
  }

  // If the last-seen id fell off page 1 (more clears happened than one page
  // holds), we can only announce what's visible on this page.
  const seenIndex = entries.findIndex((entry) => entry.id === row.last_seen_log_id);
  const newEntries = seenIndex === -1 ? entries : entries.slice(0, seenIndex);

  if (newEntries.length > 0) {
    const channelId = await getAnnouncementChannel(row.guild_id);
    if (channelId) {
      const channel = await discordClient.channels.fetch(channelId);
      for (const entry of [...newEntries].reverse()) {
        await channel.send(buildClearMessage(entry, row.view_mode));
        if (row.view_mode === 'competitive') {
          await recordClear(row.id, entry.percentile ?? null);
        }
      }
    }
  }

  await updateLastSeen(row.id, newest.id, identity);
}

export function createRaidPollWorker(discordClient) {
  return new Worker(
    'raid-poll',
    async (job) => {
      if (job.name === 'tick') {
        await processTick();
      } else if (job.name === 'check-character') {
        await processCheckCharacter(discordClient, job.data);
      }
    },
    {
      connection,
      // Rate-limit outbound lostark.bible API calls across all check jobs.
      limiter: { max: 5, duration: 1000 },
    },
  );
}
