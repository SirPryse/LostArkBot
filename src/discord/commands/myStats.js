import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { getByDiscordUserId } from '../../db/linkedAccounts.js';
import { getAggregateStats, getEstimatedGoldForAccount } from '../../db/clearHistory.js';
import { getBadgeCounts } from '../../db/guessLeaderboardBadges.js';
import { getCompletedChallengeCounts } from '../../db/challenges.js';
import { getLifetimeStats } from '../../db/guessGame.js';
import { TIERS } from '../../notify/percentileTiers.js';
import { FALLBACK_COLOR } from '../../notify/clearMessage.js';
import { deathTierEmoji, deathFlavor } from '../../notify/deathTiers.js';

const VISIBILITY_PREFIX = 'my-stats-vis:';
const WEEKLY_RANK_MEDALS = [
  { rank: 1, emoji: '🥇' },
  { rank: 2, emoji: '🥈' },
  { rank: 3, emoji: '🥉' },
];
// Sword/shield — the same offense/defense convention MMO UIs already lean
// on for role icons generally, distinct from ⚔️ (Battle Record's own
// section icon) and 🎯 (the guess-parse section's own icon) so nothing
// clashes within the same embed.
const CHALLENGE_TYPES = [
  { key: 'dps', emoji: '🗡️' },
  { key: 'support', emoji: '🛡️' },
];
/** Horizontal badge line: `👑 3 · 💗 5 · 🟠 12 …`. Replaced the old
 * one-per-line layout — with three badge groups plus challenge counts the
 * vertical version made the embed ~18 rows tall, and the distinct tier
 * emoji + bold counts stay readable on one line. The `·` separator keeps
 * adjacent emoji/count pairs from visually merging. Wraps naturally if a
 * future tier list outgrows the embed width. */
function badgeLine(entries, counts, keyOf) {
  return entries.map((e) => `${e.emoji} **${counts[keyOf(e)]}**`).join(' · ');
}

/** '—' rather than "0%" or NaN% when nobody's guessed yet — a made-up 0%
 * would misleadingly read as "always wrong" instead of "hasn't played". */
function formatWinRate(correct, total) {
  if (total === 0) return '-';
  return `${Math.round((correct / total) * 100)}%`;
}

function busFlavor(count) {
  if (count === 0) return 'Never once a liability';
  if (count <= 5) return 'Occasional passenger';
  if (count <= 15) return 'Bus regular';
  return 'Has a monthly bus pass 🎫';
}

function winRateFlavor(correct, total) {
  if (total === 0) return '';
  const pct = correct / total;
  if (pct < 0.3) return '🎲 Vibes-based guessing';
  if (pct < 0.6) return 'Coin flip energy';
  if (pct < 0.85) return 'Sharp eye';
  return 'Certified detective 🕵️';
}

/** One roast line for the embed footer — checks the funniest/most notable
 * stat first (highest tiers of deaths/bus rides), falls back to a milder
 * jab, and if genuinely nothing stands out, a backhanded compliment rather
 * than nothing at all. Teasing, not actually mean — matches this bot's
 * existing tone elsewhere (guess-parse's "Wall of Shame" for wrong
 * guesses). */
function buildRoastFooter({ diedCount, busCount, correctGuesses, totalGuesses }) {
  if (diedCount >= 16) return `⚰️ ${diedCount} deaths and counting — the floor missed you.`;
  if (busCount >= 16) return `🎫 ${busCount} bus rides — at this point just get a season pass.`;
  if (diedCount >= 6) return `💀 ${diedCount} deaths this lifetime. Maybe watch a guide?`;
  if (busCount >= 6) return `🚌 ${busCount} bus rides — the carry did the heavy lifting.`;
  if (totalGuesses >= 5 && correctGuesses / totalGuesses < 0.3) {
    return `🎲 ${Math.round((correctGuesses / totalGuesses) * 100)}% win rate on /guess-parse — pure chaos guessing.`;
  }
  if (diedCount === 0 && busCount === 0) return '✨ A flawless record. Suspiciously flawless.';
  return '🤝 A perfectly respectable raider. Nothing more to see here.';
}

/** Layout: exactly three blocks.
 *
 *   ⚔️ Battle Record (inline)  |  🎯 Guess-Parse (inline)
 *   🎖️ Badges (full width)
 *
 * Two inline fields side-by-side render reliably on desktop and stack
 * cleanly on mobile — it's the *third* inline field (and the old
 * zero-width-spacer alignment trick) that Discord's embed grid handles
 * unpredictably, which is what produced the floating Challenge Badges
 * block in the previous 2-inline-plus-1-full-width layout. Every future
 * stat now has an obvious home in one of the three blocks instead of
 * needing a new field.
 *
 * Guess-Parse merges the lifetime stats and the weekly leaderboard medals
 * into one visual block, but they remain distinct data axes: win rate /
 * total guesses come from an unbounded getLifetimeStats() query (no time
 * filter — a permanent record never reset by the weekly leaderboard wipe),
 * while the medals come from guessLeaderboardBadges.js weekly placements.
 * The explicit "Weekly podiums" label on the medal line is what keeps that
 * distinction legible now that they share a field. */
async function buildMyStatsEmbed(linkedAccountId, discordUserId, guildId, user) {
  const [{ total, diedCount, tierCounts, belowMinDpsCount, busCount }, weeklyBadgeCounts, guessStats, estimatedGold, challengeCounts] =
    await Promise.all([
      getAggregateStats(linkedAccountId, guildId, TIERS),
      getBadgeCounts(guildId, discordUserId),
      getLifetimeStats(guildId, discordUserId),
      getEstimatedGoldForAccount(linkedAccountId, guildId),
      getCompletedChallengeCounts(linkedAccountId, guildId),
    ]);

  const { correct_guesses: correctGuesses, total_guesses: totalGuesses } = guessStats;
  const winRateFlavorText = winRateFlavor(correctGuesses, totalGuesses);

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${user.username}'s Stats`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          {
            name: '⚔️ Battle Record',
            value:
              `Total gates cleared: **${total}**\n` +
              // Estimated, not real — lostark.bible's logs have no gold
              // field at all (see goldEstimate.js); this is "what
              // Gold-Earner-designated characters' clears would be worth,
              // capped at 3 families/week" per getEstimatedGoldForAccount.
              // Just the total here (not the character/roster/unbound
              // split /character-page shows) — this is the pooled,
              // multi-character view, where a per-type breakdown would be
              // more clutter than signal. Placed right after the clear
              // count, ahead of deaths/bus/DPS — same positioning as
              // /character-page's Est. Gold line.
              `🪙 Total Est. Gold: **${estimatedGold.total.toLocaleString('en-US')}**\n` +
              `${deathTierEmoji(diedCount)} **${diedCount}** - ${deathFlavor(diedCount)}\n` +
              `🚌 **${busCount}** - ${busFlavor(busCount)}\n` +
              `⚠️ **${belowMinDpsCount}** below Min DPS`,
          },
          {
            name: '🎯 Guess-Parse',
            value:
              `Win Rate: **${formatWinRate(correctGuesses, totalGuesses)}**${winRateFlavorText ? ` - ${winRateFlavorText}` : ''}\n` +
              `Guesses: **${totalGuesses}**\n` +
              `Weekly podiums: ${badgeLine(WEEKLY_RANK_MEDALS, weeklyBadgeCounts, (m) => m.rank)}`,
          },
          {
            // Only counts `completed` challenges, same "badges are
            // achievements, not participation" rule the Raid line follows
            // — a failed/abandoned challenge earns nothing here. See
            // getCompletedChallengeCounts' comment for why this groups by
            // the challenge's own stored role rather than the character's.
            name: '🎖️ Badges',
            value:
              `Raid: ${badgeLine(TIERS, tierCounts, (t) => t.key)}\n` +
              `Challenge: ${badgeLine(CHALLENGE_TYPES, challengeCounts, (t) => t.key)}`,
            inline: false,
          },
        )
        .setColor(FALLBACK_COLOR)
        .setFooter({ text: buildRoastFooter({ diedCount, busCount, correctGuesses, totalGuesses }) }),
    ],
  };
}

export const myStatsCommand = {
  data: new SlashCommandBuilder()
    .setName('my-stats')
    .setDescription('View your combined clear stats across every competitive character in this server'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const account = await getByDiscordUserId(interaction.user.id);
    if (!account) {
      await interaction.editReply("You don't have any tracked characters in this server.");
      return;
    }

    // No early return on zero clears — the weekly guess-parse medals come
    // from guessLeaderboardBadges.js, entirely unrelated to clear_history,
    // so someone with real clears not yet logged (or none at all) can
    // still have those to show.
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${VISIBILITY_PREFIX}self`).setLabel('Only me').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${VISIBILITY_PREFIX}everyone`)
        .setLabel('Post to everyone')
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.editReply({ content: 'Your stats are ready. Who should see it?', components: [buttons] });
  },

  componentHandlers: [
    {
      prefix: VISIBILITY_PREFIX,
      async handle(interaction) {
        const visibility = interaction.customId.slice(VISIBILITY_PREFIX.length);

        const account = await getByDiscordUserId(interaction.user.id);
        if (!account) {
          await interaction.update({ content: "You don't have any tracked characters in this server.", components: [] });
          return;
        }

        const payload = await buildMyStatsEmbed(account.id, interaction.user.id, interaction.guildId, interaction.user);

        await interaction.update({ content: 'Here you go!', components: [] });
        await interaction.followUp({
          ...payload,
          flags: visibility === 'everyone' ? undefined : MessageFlags.Ephemeral,
        });
      },
    },
  ],
};
