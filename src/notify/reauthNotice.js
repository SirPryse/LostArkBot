import { EmbedBuilder } from 'discord.js';
import { listAnnouncementChannels, getReauthNoticeMessageId, setReauthNoticeMessageId } from '../db/guildSettings.js';
import { listReauthCandidatesForGuild, markNeedsReauth } from '../db/linkedAccounts.js';

// lostark.bible tokens last 90 days with no refresh token, and the poller
// used to just flip an expired account to needs_reauth silently — nobody
// noticed until their announcements had stopped for weeks (Nov 2026: 7 of
// 10 accounts had lapsed). This keeps one status post per guild in the
// announcement channel listing who needs to re-run /link-account.
//
// One post, edited in place: mentions in the message content ping when the
// post is first sent (and again when it's re-posted after the weekly
// channel clear), but edits never re-ping, so updates as people expire or
// re-link don't spam anyone.
const WARN_WITHIN_DAYS = 3;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const NOTICE_COLOR = 0xfee75c; // Discord yellow

export function buildNotice(candidates) {
  const expired = candidates.filter((c) => c.expired);
  const expiring = candidates.filter((c) => !c.expired);
  const ts = (d) => Math.floor(new Date(d).getTime() / 1000);
  const chars = (n) => `${n} character${n === 1 ? '' : 's'}`;

  const sections = [];
  if (expired.length) {
    sections.push(
      `**Expired — not being tracked**\n` +
        expired.map((c) => `<@${c.discord_user_id}> — ${chars(c.character_count)}, expired <t:${ts(c.token_expires_at)}:R>`).join('\n'),
    );
  }
  if (expiring.length) {
    sections.push(
      `**Expiring soon**\n` +
        expiring.map((c) => `<@${c.discord_user_id}> — ${chars(c.character_count)}, expires <t:${ts(c.token_expires_at)}:R>`).join('\n'),
    );
  }

  const embed = new EmbedBuilder()
    .setTitle('🔗 lostark.bible re-link needed')
    .setColor(NOTICE_COLOR)
    .setDescription(
      `Run \`/link-account\` to renew your link — your tracked characters pick up again right away.\n\n${sections.join('\n\n')}`,
    )
    .setFooter({ text: "lostark.bible logins last 90 days and can't be renewed automatically." });

  const mentionIds = candidates.map((c) => c.discord_user_id);
  return {
    content: mentionIds.map((id) => `<@${id}>`).join(' '),
    embeds: [embed],
    allowedMentions: { users: mentionIds },
  };
}

async function refreshGuild(discordClient, guildId, channelId, { forceNewPost = false } = {}) {
  const candidates = await listReauthCandidatesForGuild(guildId, WARN_WITHIN_DAYS);
  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const storedId = forceNewPost ? null : await getReauthNoticeMessageId(guildId);
  const existing = storedId ? await channel.messages.fetch(storedId).catch(() => null) : null;

  if (candidates.length === 0) {
    if (existing) await existing.delete().catch(() => {});
    if (storedId) await setReauthNoticeMessageId(guildId, null);
    return;
  }

  const notice = buildNotice(candidates);
  if (existing) {
    const unchanged =
      existing.content === notice.content && existing.embeds[0]?.description === notice.embeds[0].data.description;
    if (!unchanged) await existing.edit(notice);
    return;
  }

  // No post yet, or it was deleted (weekly clear, /clear-channel, a mod).
  const sent = await channel.send(notice);
  await setReauthNoticeMessageId(guildId, sent.id);
}

// Serializes refreshes per guild — the hourly tick, a poller-detected
// expiry and a /link-account callback can all land at once, and two
// concurrent refreshes that both see "no post yet" would each send one.
const queues = new Map();
function enqueue(guildId, task) {
  const next = (queues.get(guildId) ?? Promise.resolve()).then(task, task);
  queues.set(guildId, next.catch(() => {}));
  return next;
}

/** Re-sync the notice in every guild's announcement channel. Safe to call
 * any time; a no-op edit is skipped. Errors are logged per guild. */
export async function refreshAllReauthNotices(discordClient) {
  if (!discordClient.isReady()) return;
  const channels = await listAnnouncementChannels();
  await Promise.all(
    channels.map(({ guildId, channelId }) =>
      enqueue(guildId, () => refreshGuild(discordClient, guildId, channelId)).catch((err) =>
        console.error(`Re-link notice refresh failed for guild ${guildId}:`, err),
      ),
    ),
  );
}

/** The one way to flag an expired/401'd link: marks the account
 * needs_reauth and, only if that actually changed its status, refreshes
 * the notices in the background (never blocks or fails the caller). Used by
 * the poller and every command that can discover an expired token. */
export async function flagNeedsReauth(discordClient, linkedAccountId) {
  const changed = await markNeedsReauth(linkedAccountId);
  if (changed) {
    refreshAllReauthNotices(discordClient).catch((err) => console.error('Re-link notice refresh failed:', err));
  }
  return changed;
}

/** After the weekly channel clear wiped the old post — always sends a
 * fresh one (with a fresh ping) if anyone still needs to re-link. */
export function repostReauthNotice(discordClient, guildId, channelId) {
  return enqueue(guildId, () => refreshGuild(discordClient, guildId, channelId, { forceNewPost: true }));
}

/** Once at startup, then hourly — catches accounts drifting into the
 * "expiring soon" window and expiries flagged outside the poller (e.g. by
 * /bonk or /challenge hitting a 401). */
export function startReauthNoticeUpdates(discordClient) {
  const tick = () => refreshAllReauthNotices(discordClient).catch((err) => console.error('Re-link notice tick failed:', err));
  tick();
  setInterval(tick, REFRESH_INTERVAL_MS);
}
