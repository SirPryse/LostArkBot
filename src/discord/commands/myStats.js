import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { getByDiscordUserId } from '../../db/linkedAccounts.js';
import { getAggregateStats } from '../../db/clearHistory.js';
import { getBadgeCounts } from '../../db/guessLeaderboardBadges.js';
import { getLifetimeStats } from '../../db/guessGame.js';
import { TIERS } from '../../notify/percentileTiers.js';
import { FALLBACK_COLOR } from '../../notify/clearMessage.js';

const VISIBILITY_PREFIX = 'my-stats-vis:';
const WEEKLY_RANK_MEDALS = [
  { rank: 1, emoji: '🥇' },
  { rank: 2, emoji: '🥈' },
  { rank: 3, emoji: '🥉' },
];

/** One tier/rank per line so the counts are actually readable. */
function badgeLines(entries, counts, keyOf) {
  return entries.map((e) => `${e.emoji} **${counts[keyOf(e)]}**`).join('\n');
}

/** '—' rather than "0%" or NaN% when nobody's guessed yet — a made-up 0%
 * would misleadingly read as "always wrong" instead of "hasn't played". */
function formatWinRate(correct, total) {
  if (total === 0) return '—';
  return `${Math.round((correct / total) * 100)}%`;
}

/** Weekly guess-parse leaderboard placements — deliberately its own field,
 * not merged into the percentile-tier Raid Badges above (different game,
 * different achievement). See guessLeaderboardBadges.js. Guess-Parse Stats
 * (win rate / total guesses) is a third, separate axis again — an unbounded
 * getLifetimeStats() query (no time filter, unlike the weekly leaderboard),
 * so it's a permanent record never reset by the weekly leaderboard wipe. */
async function buildMyStatsEmbed(linkedAccountId, discordUserId, guildId, user) {
  const [{ total, diedCount, tierCounts }, weeklyBadgeCounts, guessStats] = await Promise.all([
    getAggregateStats(linkedAccountId, guildId, TIERS),
    getBadgeCounts(guildId, discordUserId),
    getLifetimeStats(guildId, discordUserId),
  ]);

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${user.username}'s Stats`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          {
            // Both this and Guess-Parse Stats below are non-inline and
            // placed first — each forces its own row, so the reading order
            // is raid stats, then guess-parse stats, then the badges row,
            // rather than description text floating above everything.
            name: '⚔️ Raid Stats',
            value: `Total gates cleared: **${total}**\nDied in **${diedCount}** gate${diedCount === 1 ? '' : 's'}`,
          },
          {
            name: '🎯 Guess-Parse Stats',
            value: `Win Rate: **${formatWinRate(guessStats.correct_guesses, guessStats.total_guesses)}**\nTotal Guesses: **${guessStats.total_guesses}**`,
          },
          { name: '🎖️ Raid Badges', value: badgeLines(TIERS, tierCounts, (t) => t.key), inline: true },
          { name: '🏆 Guess-Parse Badges', value: badgeLines(WEEKLY_RANK_MEDALS, weeklyBadgeCounts, (m) => m.rank), inline: true },
        )
        .setColor(FALLBACK_COLOR),
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

    // No early return on zero clears — Guess-Parse Badges (the weekly
    // leaderboard field) come from guessLeaderboardBadges.js, entirely
    // unrelated to clear_history, so someone with real clears not yet
    // logged (or none at all) can still have those to show.
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
