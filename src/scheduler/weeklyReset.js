import { EmbedBuilder } from 'discord.js';
import { listAnnouncementChannels } from '../db/guildSettings.js';
import { getLeaderboard, resetLeaderboard } from '../db/guessGame.js';
import { awardBadge } from '../db/guessLeaderboardBadges.js';
import { clearChannel } from '../utils/clearChannel.js';

// Lost Ark's weekly raid-lockout reset — confirmed live: the daily reset is
// a fixed 10:00 UTC across every region (Game Time Master's game-data.js,
// `utcDailyReset: true` — DST-proof, anchored to the UTC instant rather
// than each region's local clock), and Wednesday is the confirmed weekly
// reset day for this bot's purposes.
const RESET_DAY_UTC = 3; // 0=Sun ... 3=Wed ... 6=Sat
const RESET_HOUR_UTC = 10;

const MEDAL_EMOJI = ['🥇', '🥈', '🥉'];

function buildWeeklyChampionsEmbed(topThree) {
  const embed = new EmbedBuilder()
    .setTitle('🏆 Weekly Guess-Parse Champions!')
    .setColor(0xffd700)
    .setFooter({ text: 'The leaderboard has been reset for the new raid week. Good luck!' });

  if (topThree.length === 0) {
    embed.setDescription(
      "This week's raid reset just hit, but nobody scored any guess-parse points this week — get guessing!",
    );
    return embed;
  }

  const lines = topThree.map(
    (entry, i) => `${MEDAL_EMOJI[i]} <@${entry.discord_user_id}> — **${entry.points}** pt${entry.points === 1 ? '' : 's'}`,
  );
  embed.setDescription(`This week's raid reset just hit — here's who dominated the guessing game:\n\n${lines.join('\n')}`);
  return embed;
}

/**
 * The weekly ritual for one guild: read the top 3 (before anything is
 * destroyed), wipe the announcement channel, wipe the leaderboard, award
 * badges for the captured top 3 — kept entirely separate from
 * clear_history's percentile-tier badges, see guessLeaderboardBadges.js —
 * then post the champions embed to the now-empty channel.
 */
export async function runWeeklyReset(discordClient, guildId, channelId) {
  const topThree = await getLeaderboard(guildId, 3);

  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (channel) {
    await clearChannel(channel).catch((err) =>
      console.error(`Weekly reset: failed to clear channel for guild ${guildId}:`, err),
    );
  }

  await resetLeaderboard(guildId);

  for (let i = 0; i < topThree.length; i++) {
    await awardBadge(guildId, topThree[i].discord_user_id, i + 1, topThree[i].points);
  }

  if (channel) {
    await channel
      .send({ embeds: [buildWeeklyChampionsEmbed(topThree)] })
      .catch((err) => console.error(`Weekly reset: failed to post champions embed for guild ${guildId}:`, err));
  }
}

/** One tick — every guild with an announcement channel configured gets the
 * ritual, one at a time, with one guild's failure not blocking the rest
 * (same per-item isolation pattern as poller.js's runPollTick). */
export async function runWeeklyResetForAllGuilds(discordClient) {
  const channels = await listAnnouncementChannels();
  for (const { guildId, channelId } of channels) {
    try {
      await runWeeklyReset(discordClient, guildId, channelId);
    } catch (err) {
      console.error(`Weekly reset failed for guild ${guildId}:`, err);
    }
  }
}

function msUntilNextReset() {
  const now = new Date();
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RESET_HOUR_UTC, 0, 0, 0));
  const daysUntilResetDay = (RESET_DAY_UTC - candidate.getUTCDay() + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + daysUntilResetDay);
  if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 7);
  return candidate.getTime() - now.getTime();
}

/** Same wall-clock-anchored scheduling pattern as poller.js's interval —
 * computes ms until the next Wednesday 10:00 UTC, fires once, then
 * recomputes for the following week, rather than a plain 7-day interval
 * from process start (which would drift out of alignment with the real
 * reset after any restart). */
export function startWeeklyResetSchedule(discordClient) {
  const scheduleNext = () => {
    setTimeout(() => {
      runWeeklyResetForAllGuilds(discordClient).catch((err) => console.error('Weekly reset tick failed:', err));
      scheduleNext();
    }, msUntilNextReset());
  };
  scheduleNext();
}
