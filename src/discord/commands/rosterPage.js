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
import { TIERS } from '../../notify/percentileTiers.js';
import { FALLBACK_COLOR } from '../../notify/clearMessage.js';

const VISIBILITY_PREFIX = 'roster-page-vis:';
const WEEKLY_RANK_MEDALS = [
  { rank: 1, emoji: '🥇' },
  { rank: 2, emoji: '🥈' },
  { rank: 3, emoji: '🥉' },
];

/** One tier/rank per line so the counts are actually readable. */
function badgeLines(entries, counts, keyOf) {
  return entries.map((e) => `${e.emoji} **${counts[keyOf(e)]}**`).join('\n');
}

/** Weekly guess-parse leaderboard placements — deliberately its own field,
 * not merged into the percentile-tier Parse Badges above (different game,
 * different achievement). See guessLeaderboardBadges.js. */
async function buildRosterPageEmbed(linkedAccountId, discordUserId, guildId, user) {
  const [{ total, diedCount, tierCounts }, weeklyBadgeCounts] = await Promise.all([
    getAggregateStats(linkedAccountId, guildId, TIERS),
    getBadgeCounts(guildId, discordUserId),
  ]);

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${user.username}'s Roster`)
        .setThumbnail(user.displayAvatarURL())
        .setDescription(
          `Total gates cleared: **${total}**\n` + `Died in **${diedCount}** raid${diedCount === 1 ? '' : 's'}`,
        )
        .addFields(
          { name: '🎖️ Parse Badges', value: badgeLines(TIERS, tierCounts, (t) => t.key), inline: true },
          { name: '🏆 Guess-Parse Badges', value: badgeLines(WEEKLY_RANK_MEDALS, weeklyBadgeCounts, (m) => m.rank), inline: true },
        )
        .setColor(FALLBACK_COLOR),
    ],
  };
}

export const rosterPageCommand = {
  data: new SlashCommandBuilder()
    .setName('roster-page')
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

    await interaction.editReply({ content: 'Your roster page is ready. Who should see it?', components: [buttons] });
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

        const payload = await buildRosterPageEmbed(account.id, interaction.user.id, interaction.guildId, interaction.user);

        await interaction.update({ content: 'Here you go!', components: [] });
        await interaction.followUp({
          ...payload,
          flags: visibility === 'everyone' ? undefined : MessageFlags.Ephemeral,
        });
      },
    },
  ],
};
