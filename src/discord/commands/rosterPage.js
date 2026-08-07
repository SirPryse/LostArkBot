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
import { TIERS } from '../../notify/percentileTiers.js';
import { FALLBACK_COLOR } from '../../notify/clearMessage.js';

const VISIBILITY_PREFIX = 'roster-page-vis:';

/** One tier per line so the badge counts are actually readable. */
function badgeLines(counts) {
  return TIERS.map((t) => `${t.emoji} **${counts[t.key]}**`).join('\n');
}

async function buildRosterPageEmbed(linkedAccountId, guildId, user) {
  const { total, diedCount, tierCounts } = await getAggregateStats(linkedAccountId, guildId, TIERS);

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${user.username}'s Roster`)
        .setThumbnail(user.displayAvatarURL())
        .setDescription(
          `Total gates cleared: **${total}**\n` + `Died in **${diedCount}** raid${diedCount === 1 ? '' : 's'}`,
        )
        .addFields({ name: 'Badges', value: badgeLines(tierCounts), inline: false })
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

    const { total } = await getAggregateStats(account.id, interaction.guildId, TIERS);
    if (total === 0) {
      await interaction.editReply(
        "No competitive clears recorded yet across your tracked characters in this server — check back after your next clear.",
      );
      return;
    }

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

        const payload = await buildRosterPageEmbed(account.id, interaction.guildId, interaction.user);

        await interaction.update({ content: 'Here you go!', components: [] });
        await interaction.followUp({
          ...payload,
          flags: visibility === 'everyone' ? undefined : MessageFlags.Ephemeral,
        });
      },
    },
  ],
};
