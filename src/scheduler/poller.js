import path from 'node:path';
import { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  listEnabledGoldEarnersWithAccount,
  listEnabledNonGoldEarnersWithAccount,
  updateLastSeen,
  getNameAndClassById,
} from '../db/trackedCharacters.js';
import { flagNeedsReauth } from '../notify/reauthNotice.js';
import { getAnnouncementChannel } from '../db/guildSettings.js';
import { recordClear } from '../db/clearHistory.js';
import { getAllActiveChallenges, resolveChallenge } from '../db/challenges.js';
import { getBetCounts } from '../db/challengeBets.js';
import { claim, setMessage, get as getGroupPost } from '../db/raidGroupPosts.js';
import { getCharacterLogs } from '../lostarkbible/client.js';
import { decryptToken } from '../crypto/tokenCipher.js';
import {
  buildInitialClearMessage,
  buildAppendedClearMessage,
  containerHasMember,
  getRole,
  formatStat,
} from '../notify/clearMessage.js';
import { getMinDps } from '../notify/minDps.js';
import { getGoldEstimate } from '../notify/goldEstimate.js';
import { getRaidFamilyForBoss, getFriendlyBossName, ALL_KNOWN_BOSSES } from '../notify/raidFamilies.js';
import { lastWednesdayReset } from '../notify/raidWeek.js';
import { getBossImagePath } from '../notify/bossImages.js';
import { TokenExpiredError, InsufficientScopeError } from '../lostarkbible/errors.js';
import { config } from '../config.js';
import { sleep } from '../utils/sleep.js';
import { BUFF_LABELS, emojiTag } from '../notify/format.js';

// A challenge's raw deadline (see expireStaleChallenges) lands on the
// *exact same instant* weeklyReset.js fires for that guild — both are
// anchored to lastWednesdayReset()'s boundary, one directly, the other one
// week later. Without a buffer, a timeout-failure announcement could win
// the race and post into the announcement channel moments before
// weeklyReset.js's own clearChannel() wipes it — the user would never
// actually see it. Delaying the expiry check itself by this much gives the
// weekly reset (channel wipe + badge awards + champions post, all
// sequential awaits, well under a minute even worst-case) time to finish
// first — the 5-minute expiry sweep (runChallengeExpiryTick) means this buffer spans several
// ticks' worth of margin, not just one.
const CHALLENGE_EXPIRY_BUFFER_MS = 30 * 60 * 1000;

const CLAIM_WAIT_RETRIES = 10;
const CLAIM_WAIT_INTERVAL_MS = 500;
// Stay under lostark.bible's rate limit — previously enforced by BullMQ's
// `limiter: { max: 5, duration: 1000 }`. Polling now runs entirely
// in-process (this is a single-instance bot, a distributed job queue was
// pure Redis-request overhead we didn't need — see the Upstash free-tier
// blowout this replaced), so it's just a flat delay between characters.
const PER_CHARACTER_DELAY_MS = 200;
// Catch-up after a gap (expired link renewed, bot down): clears older than
// this are recorded silently instead of announced — see processCharacter.
const BACKLOG_AGE_MS = 6 * 60 * 60 * 1000;
// 25 entries per page — 10 pages covers far more than a few weeks of clears.
const CATCH_UP_MAX_PAGES = 10;

// setMessage is a plain DB write immediately after a successful Discord
// send — if it fails (a DB blip, not a Discord problem, since we already
// have `sent` at that point), a retry of this same announcement later would
// see the claim already taken but no message_id recorded, and fall back to
// posting a second, duplicate top-level message. A few quick retries close
// that window for what should be a very reliable write.
const SET_MESSAGE_RETRIES = 3;
const SET_MESSAGE_RETRY_DELAY_MS = 300;


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

  const channel = await discordClient.channels.fetch(existing.channel_id).catch(() => null);
  // force: true — this message is likely already cached from a previous
  // poll's edit, and a cached read here would miss whatever the most
  // recent party member's edit just added, silently dropping their block
  // from the next append instead of building on top of it.
  const existingMessage = channel
    ? await channel.messages.fetch({ message: existing.message_id, force: true }).catch((err) => {
        if (err.code === 10008) return null; // Unknown Message — deleted
        throw err;
      })
    : null;

  if (!existingMessage) {
    // The group's post was deleted (a mod, /nuke) or its channel is gone.
    // This used to throw on every tick, so the character's batch never
    // finished and was retried forever (seen live: Unknown Message every
    // 5 min). Start a fresh post in the current announcement channel and
    // re-point the group at it so later party members append there.
    const target = await discordClient.channels.fetch(channelId);
    const sent = await target.send(buildInitialClearMessage(entry, viewMode));
    await setMessageWithRetry(guildId, entry.id, channelId, sent.id);
    return;
  }
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

/** Whether a support challenge's target was met — contribution AND every
 * buff slot that actually *had* a target (null slots had no historical
 * data at challenge-generation time and were never required — see
 * challenge.js's computeTargets). */
function isSupportTargetMet(targets, entry) {
  if ((entry.contributionPercentile ?? 0) < targets.contribution) return false;
  for (let i = 0; i < targets.buffs.length; i++) {
    if (targets.buffs[i] === null) continue;
    const value = (entry.buffs ?? [])[i];
    if (value === undefined || value === null || value < targets.buffs[i]) return false;
  }
  return true;
}

/** One row per stat the challenge actually tracked — a DPS gate is just
 * UDPS; a support gate is contribution plus every buff slot that had a
 * real target (null slots were never required — see challenge.js's
 * computeTargets). `got: null` means the entry is simply missing that
 * field, distinct from "got a real 0". */
function buildStatRows(role, targets, entry) {
  if (role === 'support') {
    const rows = [{ label: 'Contribution', got: entry.contributionPercentile ?? null, target: targets.contribution, percent: true }];
    for (let i = 0; i < targets.buffs.length; i++) {
      if (targets.buffs[i] === null) continue;
      const value = (entry.buffs ?? [])[i];
      rows.push({ label: BUFF_LABELS[i], got: value ?? null, target: targets.buffs[i], percent: true });
    }
    return rows;
  }
  return [{ label: 'UDPS', got: entry.udps ?? null, target: targets.udps, percent: false }];
}

/** The achieved-vs-target comparison, shared by the completion and failure
 * embeds so both frame it the same way — a right-aligned monospace table
 * (Stat / Got / Target / ✅|⚠️), same visual language as /bonk's raid
 * progress tables, instead of a repeated "Label: got (needed ≥ target)"
 * sentence per stat — for a multi-stat support miss especially, this makes
 * it obvious at a glance which specific stat(s) fell short rather than
 * having to re-read every line's parenthetical. */
function formatAchievedVsTarget(role, targets, entry) {
  const rows = buildStatRows(role, targets, entry);
  const fmt = (value, percent) => (value === null ? 'N/A' : percent ? `${(value * 100).toFixed(1)}%` : formatStat(value));

  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const gotWidth = Math.max(...rows.map((r) => fmt(r.got, r.percent).length), 'Got'.length);
  const targetWidth = Math.max(...rows.map((r) => fmt(r.target, r.percent).length), 'Target'.length);

  const line = (label, got, target, marker) =>
    `${label.padEnd(labelWidth)}  ${got.padEnd(gotWidth)}  ${target.padEnd(targetWidth)}  ${marker}`;

  const header = line('Stat', 'Got', 'Target', ' ');
  const body = rows
    .map((r) => {
      const passed = r.got !== null && r.got >= r.target;
      return line(r.label, fmt(r.got, r.percent), fmt(r.target, r.percent), r.got === null ? '❔' : passed ? '✅' : '⚠️');
    })
    .join('\n');

  return `\`\`\`\n${header}\n${body}\n\`\`\``;
}

/** Boss image as a real thumbnail (not just referenced by URL — these are
 * local asset files, so they need attaching, same as clearMessage.js's own
 * announcements). Filename includes the challenge id so concurrent
 * announcements for different challenges in the same tick can never
 * collide on the same attachment name. */
function buildBossThumbnailAttachment(bossName, challengeId) {
  const imagePath = getBossImagePath(bossName);
  const imageFile = `challenge-result-${challengeId}${path.extname(imagePath)}`;
  return { file: new AttachmentBuilder(imagePath, { name: imageFile }), url: `attachment://${imageFile}` };
}

/** `className` is nullable — checkChallengeProgress always has it (off the
 * clear entry itself), but a timeout failure in expireStaleChallenges has
 * no clear to read it from and falls back to a DB lookup that could
 * legitimately come back empty for a character with no clears logged yet.
 * No icon at all (rather than a broken emoji tag) when that happens. */
function buildChallengeCompleteEmbed(characterName, className, gateLabel, difficulty, role, targets, entry, thumbnailUrl) {
  const namePrefix = className ? `${emojiTag(className)} ` : '';
  return new EmbedBuilder()
    .setTitle(`🏆 Challenge Complete: ${gateLabel} — ${difficulty}`)
    .setDescription(`${namePrefix}**${characterName}** beat the target!\n${formatAchievedVsTarget(role, targets, entry)}`)
    .setThumbnail(thumbnailUrl)
    .setColor(0xffd700);
}

function buildChallengeFailedEmbed(characterName, className, gateLabel, difficulty, reason, thumbnailUrl) {
  const namePrefix = className ? `${emojiTag(className)} ` : '';
  return new EmbedBuilder()
    .setTitle(`❌ Challenge Failed: ${gateLabel} — ${difficulty}`)
    .setDescription(`${namePrefix}**${characterName}** ${reason}`)
    .setThumbnail(thumbnailUrl)
    .setColor(0xed4245);
}

async function postChallengeAnnouncement(discordClient, channelId, buildEmbed, bossName, challengeId) {
  if (!channelId) return;
  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  const { file, url } = buildBossThumbnailAttachment(bossName, challengeId);
  await channel.send({ embeds: [buildEmbed(url)], files: [file] }).catch((err) => console.error('Failed to post challenge announcement:', err));
}

/** Locks a challenge's public "place your bet" post once the challenge
 * itself resolves — disables both buttons (no more bets on a decided
 * outcome) and appends the final tally + result. A no-op if this challenge
 * was never posted publicly in the first place (no announcement channel
 * configured at Accept time — see challenge.js) or if the message/channel
 * can no longer be found (channel deleted, message manually removed,
 * etc.) — same "best effort, never block resolution on it" treatment
 * postChallengeAnnouncement gives its own send. `status` is the challenge's
 * *new* status ('completed' or 'failed'), not what's still on the stale
 * `challenge` object passed in — that was fetched before this poll tick
 * resolved it. */
async function finalizeBetMessage(discordClient, challenge, status) {
  if (!challenge.bet_channel_id || !challenge.bet_message_id) return;
  const channel = await discordClient.channels.fetch(challenge.bet_channel_id).catch(() => null);
  if (!channel) return;
  const message = await channel.messages.fetch(challenge.bet_message_id).catch(() => null);
  if (!message) return;

  const counts = await getBetCounts(challenge.id);
  const resultLine = status === 'completed' ? '🏆 Result: **✅ Success**' : '❌ Result: **Failure**';
  const lockedButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('challenge-bet-locked:success').setLabel(`Success (${counts.success})`).setStyle(ButtonStyle.Success).setEmoji('✅').setDisabled(true),
    new ButtonBuilder().setCustomId('challenge-bet-locked:failure').setLabel(`Failure (${counts.failure})`).setStyle(ButtonStyle.Danger).setEmoji('❌').setDisabled(true),
  );

  const existingEmbed = message.embeds[0];
  const lockedEmbed = existingEmbed
    ? EmbedBuilder.from(existingEmbed).addFields({ name: 'Betting closed', value: resultLine })
    : null;

  await message
    .edit({ embeds: lockedEmbed ? [lockedEmbed] : undefined, components: [lockedButtons] })
    .catch((err) => console.error('Failed to lock challenge bet message:', err));
}

/**
 * Fails every challenge in the list that's past its deadline — the *next*
 * raid reset after it was Accepted, not a flat 7 days, since that would
 * let a challenge taken right before Wednesday's reset linger almost a
 * full extra week past everyone else's. `lastWednesdayReset(createdAt)`
 * gives the reset boundary at-or-before creation; the very next one is
 * exactly 7 days after that — resets are always a week apart — plus
 * CHALLENGE_EXPIRY_BUFFER_MS so this check never races weeklyReset.js's
 * own channel wipe for the same guild (see that constant's comment).
 * Called once per character per tick, before any of this tick's entries
 * are checked against the survivors, so a stale challenge never lingers
 * into "still active" territory just because nothing new happened to
 * trigger a check on it. Returns the still-active subset.
 */
export async function expireStaleChallenges(discordClient, channelId, activeChallenges) {
  const survivors = [];
  for (const challenge of activeChallenges) {
    // + CHALLENGE_EXPIRY_BUFFER_MS — see that constant's comment for why
    // this can't just be the raw reset instant.
    const deadline = lastWednesdayReset(new Date(challenge.created_at)).getTime() + 7 * 24 * 60 * 60 * 1000 + CHALLENGE_EXPIRY_BUFFER_MS;
    if (Date.now() < deadline) {
      survivors.push(challenge);
      continue;
    }

    // Already resolved elsewhere (a clear landed at the same moment) — that
    // path owns the announcement.
    if (!(await resolveChallenge(challenge.id, 'failed'))) continue;
    await finalizeBetMessage(discordClient, challenge, 'failed');
    const gateLabel = getFriendlyBossName(challenge.boss_name, challenge.difficulty);
    // Neither is on the challenge row itself — nothing was actually
    // cleared for a timeout failure, so there's no fresh entry to read
    // them off of the way checkChallengeProgress can; this DB lookup is
    // the closest available (can legitimately come back empty for a
    // character with no clears logged yet).
    const identity = await getNameAndClassById(challenge.tracked_character_id);
    await postChallengeAnnouncement(
      discordClient,
      channelId,
      (thumbnailUrl) =>
        buildChallengeFailedEmbed(
          identity?.character_name ?? 'A challenge',
          identity?.class_name ?? null,
          gateLabel,
          challenge.difficulty,
          "ran out of time — wasn't completed before this week's raid reset.",
          thumbnailUrl,
        ),
      challenge.boss_name,
      challenge.id,
    );
  }
  return survivors;
}

// Re-entrancy guard for runChallengeExpiryTick, same pattern as the two
// poll tiers' own flags below.
let tickingChallengeExpiry = false;

/**
 * The decoupled expiry sweep — checks every active challenge across every
 * character in one pass, on its own schedule, independent of either poll
 * tier's cadence. Exists so a challenge's ~30-minute post-reset failure
 * window (CHALLENGE_EXPIRY_BUFFER_MS) doesn't also inherit whichever poll
 * tier its character happens to be in — before this existed, expiry was
 * only checked as a side effect of that character's own poll tick, so a
 * non-Gold-Earner character (the slower, hourly tier) could take up to an
 * extra hour past the buffer to actually get marked failed.
 *
 * Groups by guild_id and resolves each guild's announcement channel once
 * (cached for the rest of this tick) rather than once per challenge — the
 * same "don't re-query the same guild's settings over and over" lesson
 * /bonk's slowness investigation surfaced. Reuses expireStaleChallenges()
 * verbatim per guild's group; that function itself doesn't change at all.
 */
export async function runChallengeExpiryTick(discordClient) {
  if (tickingChallengeExpiry) {
    console.warn('Challenge expiry tick already in progress, skipping this trigger.');
    return;
  }
  tickingChallengeExpiry = true;
  try {
    const allActive = await getAllActiveChallenges();
    if (allActive.length === 0) return;

    const byGuild = new Map(); // guild_id -> challenge[]
    for (const challenge of allActive) {
      if (!byGuild.has(challenge.guild_id)) byGuild.set(challenge.guild_id, []);
      byGuild.get(challenge.guild_id).push(challenge);
    }

    const channelIdByGuild = new Map(); // cached per guild for this tick
    for (const [guildId, challenges] of byGuild) {
      if (!channelIdByGuild.has(guildId)) {
        channelIdByGuild.set(guildId, await getAnnouncementChannel(guildId));
      }
      const channelId = channelIdByGuild.get(guildId);
      await expireStaleChallenges(discordClient, channelId, challenges);
    }
  } finally {
    tickingChallengeExpiry = false;
  }
}

export function startChallengeExpiryChecking(discordClient) {
  const intervalMs = config.challengeExpiryCheckIntervalMinutes * 60 * 1000;
  setInterval(() => {
    runChallengeExpiryTick(discordClient).catch((err) => console.error('Challenge expiry tick failed:', err));
  }, intervalMs);
}

/**
 * Checks one new clear against the character's active challenges (if any)
 * — matches at most one, since createChallenge() already prevents two
 * simultaneously-active challenges for the same character+boss+difficulty.
 * With exactly one gate per challenge (see the migration comment on why),
 * the very first matching clear fully resolves it one way or the other:
 * falling short fails it immediately (real stakes, not unlimited
 * retries), meeting the target completes it. Either way announces to the
 * guild's announcement channel (per the design decision — same channel
 * real clears already post to), and only ever fires for an *Accepted*
 * challenge, since generated-but-not-accepted ones are never persisted at
 * all (see challenge.js).
 *
 * Returns the updated list (the matched entry removed if it just
 * resolved) — callers should keep using this return value for the rest of
 * the same poll tick's entries rather than re-fetching.
 */
export async function checkChallengeProgress(discordClient, guildId, channelId, entry, activeChallenges) {
  const idx = activeChallenges.findIndex((c) => c.boss_name === entry.boss && c.difficulty === entry.difficulty);
  if (idx === -1) return activeChallenges;

  const challenge = activeChallenges[idx];
  const gateLabel = getFriendlyBossName(challenge.boss_name, challenge.difficulty);
  const met = challenge.role === 'support' ? isSupportTargetMet(challenge.targets, entry) : (entry.udps ?? 0) >= challenge.targets.udps;
  const remaining = [...activeChallenges.slice(0, idx), ...activeChallenges.slice(idx + 1)];

  // Already resolved elsewhere (the expiry sweep got there first) — that
  // path owns the announcement.
  if (!(await resolveChallenge(challenge.id, met ? 'completed' : 'failed'))) return remaining;

  if (met) {
    await finalizeBetMessage(discordClient, challenge, 'completed');
    await postChallengeAnnouncement(
      discordClient,
      channelId,
      (thumbnailUrl) =>
        buildChallengeCompleteEmbed(entry.name, entry.class, gateLabel, challenge.difficulty, challenge.role, challenge.targets, entry, thumbnailUrl),
      challenge.boss_name,
      challenge.id,
    );
  } else {
    await finalizeBetMessage(discordClient, challenge, 'failed');
    const comparison = formatAchievedVsTarget(challenge.role, challenge.targets, entry);
    await postChallengeAnnouncement(
      discordClient,
      channelId,
      (thumbnailUrl) => buildChallengeFailedEmbed(entry.name, entry.class, gateLabel, challenge.difficulty, `fell short.\n${comparison}`, thumbnailUrl),
      challenge.boss_name,
      challenge.id,
    );
  }

  return remaining;
}

/**
 * Splits a character's new log entries into `fresh` (announced like any
 * live clear) and `backlog` (older than BACKLOG_AGE_MS: a catch-up after an
 * expired link was renewed or the bot was down — recorded for stats/gold
 * only, never posted or scored against challenges). Before this split, a
 * re-link dumped every missed clear into the channel at once (seen live:
 * 50 posts within the first hour for one account). Pure; exported for
 * tests.
 */
export function splitBacklog(entries, now = Date.now(), backlogAgeMs = BACKLOG_AGE_MS) {
  const cutoff = now - backlogAgeMs;
  return {
    backlog: entries.filter((entry) => entry.timestamp < cutoff),
    fresh: entries.filter((entry) => entry.timestamp >= cutoff),
  };
}

/**
 * One tracked_characters row. `ctx` holds the per-tick caches (see
 * buildTickContext); `getPageOne(accessToken)` returns this character's
 * page-1 logs, shared across every row for the same character (the same
 * character tracked in two servers is fetched once, not twice).
 */
async function processCharacter(discordClient, row, ctx, getPageOne) {
  if (row.account_status !== 'active') return;
  if (new Date(row.token_expires_at) <= new Date()) {
    await flagNeedsReauth(discordClient, row.linked_account_id);
    return;
  }

  const accessToken = decryptToken(row.access_token);

  let entries;
  try {
    entries = await getPageOne(accessToken);
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      await flagNeedsReauth(discordClient, row.linked_account_id);
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

  const seenIndex = entries.findIndex((entry) => entry.id === row.last_seen_log_id);
  const newEntries =
    seenIndex !== -1 ? entries.slice(0, seenIndex) : await fetchEntriesSinceLastSeen(accessToken, row, entries);

  const competitive = row.view_mode === 'competitive';
  const { backlog, fresh } = splitBacklog(newEntries);
  if (backlog.length > 0 && competitive) {
    let added = 0;
    for (const entry of [...backlog].reverse()) if (await recordClearForEntry(row.id, entry)) added++;
    console.log(`Caught up ${added} missed clear(s) for ${row.character_name} without announcing.`);
  }

  // A character can hold several active challenges at once (one per gate)
  // — checkChallengeProgress's return value (the list minus anything it
  // just resolved) is what later entries in the loop check against.
  const channelId = await ctx.announcementChannel(row.guild_id);
  let activeChallenges = competitive ? ctx.activeChallengesFor(row.id) : [];

  for (const entry of [...fresh].reverse()) {
    // Posting needs a channel; recording stats and resolving challenges
    // don't. (Recording used to sit inside the channel check, so a server
    // without /announce-channel silently lost every clear while
    // last_seen_log_id still moved past them.)
    if (channelId) await announceClear(discordClient, row.guild_id, channelId, entry, row.view_mode);
    if (competitive) {
      await recordClearForEntry(row.id, entry);
      activeChallenges = await checkChallengeProgress(discordClient, row.guild_id, channelId, entry, activeChallenges);
    }
  }

  await updateLastSeen(row.id, newest.id, identity);
}

/** One clear_history row for a log entry (competitive view mode only).
 * Idempotent per log id — a retried batch doesn't double-count. Returns
 * whether a row was inserted. */
async function recordClearForEntry(trackedCharacterId, entry) {
  // null (not true/false) for anything minDps.js has no opinion on — a
  // support clear (their own `dps` stat is a different metric entirely,
  // this threshold was never meant to apply to it) or a boss/difficulty
  // with no recorded threshold yet. Same ✅/⚠️ check already used for the
  // live display badge in clearMessage.js/guessParse.js, just persisted
  // here instead of only ever computed on the fly.
  let belowMinDps = null;
  if (getRole(entry) === 'dps') {
    const minDps = getMinDps(entry.boss, entry.difficulty);
    if (minDps !== null) belowMinDps = entry.dps < minDps;
  }

  // Same "not applicable" null-default as belowMinDps above —
  // getRaidFamilyForBoss returns null for anything outside raidFamilies.js's
  // tracked list, and getGoldEstimate returns null for a boss/difficulty
  // RAID_DATA.md has no figure for yet.
  const familyMatch = getRaidFamilyForBoss(entry.boss, entry.difficulty);

  return recordClear(trackedCharacterId, {
    percentile: entry.percentile ?? null,
    contributionPercentile: entry.contributionPercentile ?? null,
    died: Boolean(entry.isDead),
    belowMinDps,
    isBus: entry.isBus ?? null,
    raidFamilyKey: familyMatch?.family.key ?? null,
    estimatedGold: getGoldEstimate(entry.boss, entry.difficulty),
    raidDifficulty: entry.difficulty ?? null,
    logId: entry.id ?? null,
    clearedAt: Number.isFinite(entry.timestamp) ? new Date(entry.timestamp) : null,
  });
}

/**
 * Every entry newer than the character's last-seen clear, when that clear
 * is no longer on page 1 (more than a page of clears since the last
 * successful check — typically after an expired link is renewed). Pages
 * back with the ALL_KNOWN_BOSSES filter (pagination silently no-ops
 * without one, see weeklyLogs.js) until it reaches the last-seen id or a
 * clear older than the last successful check, and merges in page 1's
 * unfiltered entries so clears of not-yet-tracked bosses aren't dropped.
 * Newest-first, like the API. Previously only page 1 was ever looked at,
 * so anything beyond the newest 25 was silently lost.
 */
async function fetchEntriesSinceLastSeen(accessToken, row, pageOne) {
  const boundaryMs = row.last_checked_at ? new Date(row.last_checked_at).getTime() : 0;
  const byId = new Map();
  const isNew = (entry) => entry.id !== row.last_seen_log_id && entry.timestamp > boundaryMs;
  for (const entry of pageOne) if (isNew(entry)) byId.set(entry.id, entry);

  pages: for (let page = 1; page <= CATCH_UP_MAX_PAGES; page++) {
    const batch = await getCharacterLogs(accessToken, row.character_name, row.region, { page, bosses: ALL_KNOWN_BOSSES });
    if (!batch || batch.length === 0) break;
    for (const entry of batch) {
      if (!isNew(entry)) break pages;
      byId.set(entry.id, entry);
    }
    await sleep(PER_CHARACTER_DELAY_MS);
  }

  return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Lookups every character in a tick would otherwise repeat: each guild's
 * announcement channel (memoized on first use) and every active challenge
 * (one query for the whole tick, grouped by character).
 */
async function buildTickContext() {
  const channelByGuild = new Map();
  const challengesByCharacter = new Map();
  for (const challenge of await getAllActiveChallenges()) {
    const list = challengesByCharacter.get(challenge.tracked_character_id) ?? [];
    list.push(challenge);
    challengesByCharacter.set(challenge.tracked_character_id, list);
  }
  return {
    async announcementChannel(guildId) {
      if (!channelByGuild.has(guildId)) channelByGuild.set(guildId, await getAnnouncementChannel(guildId));
      return channelByGuild.get(guildId);
    },
    activeChallengesFor(trackedCharacterId) {
      return [...(challengesByCharacter.get(trackedCharacterId) ?? [])];
    },
  };
}

/**
 * Processes one tier's tracked-character rows. Rows for the same character
 * (same linked account + name + region — tracked in more than one server)
 * share a single page-1 fetch; each row is still processed on its own for
 * its own guild/last-seen. A per-row try/catch keeps one failure from
 * aborting the rest, with a small delay between characters to stay under
 * lostark.bible's rate limit.
 */
async function runTick(discordClient, rows) {
  const ctx = await buildTickContext();

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.linked_account_id}|${row.character_name.toLowerCase()}|${row.region}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const group of groups.values()) {
    let pageOne = null;
    const getPageOne = (accessToken) =>
      (pageOne ??= getCharacterLogs(accessToken, group[0].character_name, group[0].region, { page: 1 }));

    for (const row of group) {
      try {
        await processCharacter(discordClient, row, ctx, getPageOne);
      } catch (err) {
        console.error(`Error polling tracked character ${row.id} (${row.character_name}):`, err);
      }
    }
    await sleep(PER_CHARACTER_DELAY_MS);
  }
}

// Two-tier polling, per explicit design decision: Gold Earner characters
// (see gold_earners table) are checked far more often than everyone else,
// since they're the ones whose clears actually count toward the
// estimated-gold stat and drive /challenge — a delayed announcement there
// is far more noticeable than for an alt nobody's watching closely.
// listEnabledGoldEarnersWithAccount()/listEnabledNonGoldEarnersWithAccount()
// are mutually exclusive by construction (a tracked_characters row can
// never satisfy both queries), so the same character is never processed by
// both tiers at once — that's what makes it safe for these two to run on
// fully independent schedules/locks below, rather than needing to share one.
let tickingGoldEarners = false;
let tickingOthers = false;

export async function runGoldEarnerPollTick(discordClient) {
  if (tickingGoldEarners) {
    console.warn('Gold Earner poll tick already in progress, skipping this trigger.');
    return;
  }
  tickingGoldEarners = true;
  try {
    await runTick(discordClient, await listEnabledGoldEarnersWithAccount());
  } finally {
    tickingGoldEarners = false;
  }
}

export async function runOtherPollTick(discordClient) {
  if (tickingOthers) {
    console.warn('Other poll tick already in progress, skipping this trigger.');
    return;
  }
  tickingOthers = true;
  try {
    await runTick(discordClient, await listEnabledNonGoldEarnersWithAccount());
  } finally {
    tickingOthers = false;
  }
}

/** Triggers both tiers together — /check-now's "check everyone right now"
 * without waiting for either schedule. Each tier still guards itself
 * independently (see above): if one's already mid-run from the automatic
 * schedule, that one simply skips with its own warning. */
export async function runPollTick(discordClient) {
  await Promise.all([runGoldEarnerPollTick(discordClient), runOtherPollTick(discordClient)]);
}

// When each tier's *next automatic* tick is due — read by presence.js to
// show a live countdown in the bot's status. `null` until the first tick
// has been scheduled.
let nextGoldEarnerPollAt = null;
let nextOtherPollAt = null;

/** `{ nextGoldEarnerPollAt, nextOtherPollAt }` — both epoch ms, or null
 * before scheduling. presence.js polls this to redraw the countdown. */
export function getNextPollTimes() {
  return { nextGoldEarnerPollAt, nextOtherPollAt };
}

// Never poll sooner than this after startup — lets the gateway settle and
// keeps a crash-loop from hammering lostark.bible.
const STARTUP_DELAY_MS = 30 * 1000;

/**
 * Delay before a tier's first tick after startup: due when its
 * least-recently-checked active character is due (last_checked_at +
 * interval), clamped to [STARTUP_DELAY_MS, interval]. Previously the first
 * tick was always a full interval after process start, so every deploy or
 * restart pushed the hourly tier back by an hour (four deploys in one
 * evening kept it from running at all). Exported for tests via
 * computeFirstTickDelay.
 */
export function computeFirstTickDelay(lastCheckedTimes, intervalMs, now = Date.now()) {
  if (lastCheckedTimes.length === 0) return intervalMs;
  const oldest = Math.min(...lastCheckedTimes.map((t) => (t ? new Date(t).getTime() : 0)));
  return Math.min(intervalMs, Math.max(STARTUP_DELAY_MS, oldest + intervalMs - now));
}

async function firstTickDelay(listRows, intervalMs) {
  const rows = (await listRows()).filter((r) => r.account_status === 'active');
  return computeFirstTickDelay(rows.map((r) => r.last_checked_at), intervalMs);
}

function scheduleTier({ discordClient, intervalMs, listRows, run, setNextAt, label }) {
  firstTickDelay(listRows, intervalMs)
    .catch((err) => {
      console.error(`Couldn't compute first ${label} poll delay, using the startup default:`, err);
      return STARTUP_DELAY_MS;
    })
    .then((delayMs) => {
      setNextAt(Date.now() + delayMs);
      console.log(`First ${label} poll in ${Math.round(delayMs / 1000)}s.`);
      setTimeout(() => {
        const tick = () => {
          setNextAt(Date.now() + intervalMs);
          run(discordClient).catch((err) => console.error(`${label} poll tick failed:`, err));
        };
        tick();
        setInterval(tick, intervalMs);
      }, delayMs);
    });
}

export function startPolling(discordClient) {
  scheduleTier({
    discordClient,
    intervalMs: config.goldEarnerPollIntervalMinutes * 60 * 1000,
    listRows: listEnabledGoldEarnersWithAccount,
    run: runGoldEarnerPollTick,
    setNextAt: (at) => (nextGoldEarnerPollAt = at),
    label: 'Gold Earner',
  });
  scheduleTier({
    discordClient,
    intervalMs: config.otherPollIntervalMinutes * 60 * 1000,
    listRows: listEnabledNonGoldEarnersWithAccount,
    run: runOtherPollTick,
    setNextAt: (at) => (nextOtherPollAt = at),
    label: 'Other',
  });
}
