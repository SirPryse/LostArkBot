import { listEnabledWithAccount, updateLastSeen } from '../db/trackedCharacters.js';
import { markNeedsReauth } from '../db/linkedAccounts.js';
import { getAnnouncementChannel } from '../db/guildSettings.js';
import { recordClear } from '../db/clearHistory.js';
import { claim, setMessage, get as getGroupPost } from '../db/raidGroupPosts.js';
import { getCharacterLogs } from '../lostarkbible/client.js';
import { decryptToken } from '../crypto/tokenCipher.js';
import {
  buildInitialClearMessage,
  buildAppendedClearMessage,
  containerHasMember,
  getRole,
} from '../notify/clearMessage.js';
import { TokenExpiredError, InsufficientScopeError } from '../lostarkbible/errors.js';
import { config } from '../config.js';

const CLAIM_WAIT_RETRIES = 10;
const CLAIM_WAIT_INTERVAL_MS = 500;
// Stay under lostark.bible's rate limit — previously enforced by BullMQ's
// `limiter: { max: 5, duration: 1000 }`. Polling now runs entirely
// in-process (this is a single-instance bot, a distributed job queue was
// pure Redis-request overhead we didn't need — see the Upstash free-tier
// blowout this replaced), so it's just a flat delay between characters.
const PER_CHARACTER_DELAY_MS = 200;

// setMessage is a plain DB write immediately after a successful Discord
// send — if it fails (a DB blip, not a Discord problem, since we already
// have `sent` at that point), a retry of this same announcement later would
// see the claim already taken but no message_id recorded, and fall back to
// posting a second, duplicate top-level message. A few quick retries close
// that window for what should be a very reliable write.
const SET_MESSAGE_RETRIES = 3;
const SET_MESSAGE_RETRY_DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setMessageWithRetry(guildId, logId, channelId, messageId) {
  for (let attempt = 1; attempt <= SET_MESSAGE_RETRIES; attempt++) {
    try {
      await setMessage(guildId, logId, channelId, messageId);
      return;
    } catch (err) {
      if (attempt === SET_MESSAGE_RETRIES) throw err;
      await sleep(SET_MESSAGE_RETRY_DELAY_MS);
    }
  }
}

/**
 * lostark.bible's log `id` is shared across every tracked character who
 * cleared the same raid together (confirmed: identical id + identical
 * millisecond timestamp across different accounts). Whoever's poll job gets
 * here first for a given (guild, log id) claims it and posts a fresh
 * message; everyone else appends their own block onto that same message's
 * Container instead of posting a separate one — see clearMessage.js for
 * the actual layout/append logic, this is just the claim/fetch/send
 * orchestration around it.
 */
export async function announceClear(discordClient, guildId, channelId, entry, viewMode) {
  const { won } = await claim(guildId, entry.id);

  if (won) {
    const channel = await discordClient.channels.fetch(channelId);
    const sent = await channel.send(buildInitialClearMessage(entry, viewMode));
    await setMessageWithRetry(guildId, entry.id, channelId, sent.id);
    return;
  }

  // Someone else claimed it — wait for them to finish posting, then append.
  let existing = await getGroupPost(guildId, entry.id);
  for (let i = 0; i < CLAIM_WAIT_RETRIES && !existing?.message_id; i++) {
    await sleep(CLAIM_WAIT_INTERVAL_MS);
    existing = await getGroupPost(guildId, entry.id);
  }

  if (!existing?.message_id) {
    // Whoever claimed it never finished (crashed mid-post?) — don't block
    // this announcement on them forever.
    const channel = await discordClient.channels.fetch(channelId);
    await channel.send(buildInitialClearMessage(entry, viewMode));
    return;
  }

  const channel = await discordClient.channels.fetch(existing.channel_id);
  // force: true — this message is likely already cached from a previous
  // poll's edit, and a cached read here would miss whatever the most
  // recent party member's edit just added, silently dropping their block
  // from the next append instead of building on top of it.
  const existingMessage = await channel.messages.fetch({ message: existing.message_id, force: true });
  const existingContainerJson = existingMessage.components[0]?.toJSON();

  if (existingContainerJson && containerHasMember(existingContainerJson, entry.name)) {
    // Already recorded — this poll tick is retrying a batch where this
    // character's clear was appended successfully before a later failure
    // (in this same tick or an earlier one) kept `updateLastSeen` from
    // running. Appending again would duplicate this member's block.
    return;
  }

  const appended = existingContainerJson
    ? buildAppendedClearMessage(existingContainerJson, entry, viewMode)
    : null;

  if (!appended) {
    // Either the container is missing (shouldn't happen) or it's already
    // at the component-count safety cap — post a fresh message instead of
    // forcing an append.
    await channel.send(buildInitialClearMessage(entry, viewMode));
    return;
  }

  await existingMessage.edit(appended);
}

async function processCharacter(discordClient, row) {
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
  const identity = {
    className: newest.class,
    role: getRole(newest),
    gearScore: newest.gearScore,
    combatPower: newest.combatPower,
  };

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
      for (const entry of [...newEntries].reverse()) {
        await announceClear(discordClient, row.guild_id, channelId, entry, row.view_mode);
        if (row.view_mode === 'competitive') {
          await recordClear(
            row.id,
            entry.percentile ?? null,
            entry.contributionPercentile ?? null,
            Boolean(entry.isDead),
          );
        }
      }
    }
  }

  await updateLastSeen(row.id, newest.id, identity);
}

let ticking = false;

/**
 * One full pass over every enabled tracked character, sequentially with a
 * small delay between each to stay under lostark.bible's rate limit. A
 * per-character try/catch keeps one character's failure from aborting the
 * rest of the tick (BullMQ used to give this isolation for free via
 * per-job failure handling — now it's explicit).
 */
export async function runPollTick(discordClient) {
  if (ticking) {
    console.warn('Poll tick already in progress, skipping this trigger.');
    return;
  }
  ticking = true;
  try {
    const rows = await listEnabledWithAccount();
    for (const row of rows) {
      try {
        await processCharacter(discordClient, row);
      } catch (err) {
        console.error(`Error polling tracked character ${row.id} (${row.character_name}):`, err);
      }
      await sleep(PER_CHARACTER_DELAY_MS);
    }
  } finally {
    ticking = false;
  }
}

export function startPolling(discordClient) {
  const intervalMs = config.pollIntervalMinutes * 60 * 1000;
  setInterval(() => {
    runPollTick(discordClient).catch((err) => console.error('Poll tick failed:', err));
  }, intervalMs);
}
