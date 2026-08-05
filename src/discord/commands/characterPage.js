import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
} from 'discord.js';
import { getByDiscordUserId } from '../../db/linkedAccounts.js';
import { listByLinkedAccountAndGuild, getByIdForOwner } from '../../db/trackedCharacters.js';
import { getStats } from '../../db/clearHistory.js';
import { getClassIconPath } from '../../notify/classIcons.js';
import { TIERS } from '../../notify/percentileTiers.js';
import { SUPPORT_COLOR, DPS_COLOR, FALLBACK_COLOR } from '../../notify/embed.js';

const CUSTOM_ID_PREFIX = 'character-page-select:';
const MAX_OPTIONS = 25; // Discord select menu limit

export const characterPageCommand = {
  data: new SlashCommandBuilder()
    .setName('character-page')
    .setDescription('View clear stats for one of your own tracked characters in this server'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const account = await getByDiscordUserId(interaction.user.id);
    if (!account) {
      await interaction.editReply("You don't have any tracked characters in this server.");
      return;
    }

    const tracked = await listByLinkedAccountAndGuild(account.id, interaction.guildId);
    if (tracked.length === 0) {
      await interaction.editReply("You don't have any tracked characters in this server.");
      return;
    }

    const options = tracked.slice(0, MAX_OPTIONS).map((row) => ({
      label: `${row.character_name} (${row.region})`,
      value: row.id,
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}${account.id}`)
      .setPlaceholder('Select a character')
      .addOptions(options);

    await interaction.editReply({
      content: 'Pick a character to view its page.',
      components: [new ActionRowBuilder().addComponents(select)],
    });
  },

  componentHandlers: [
    {
      prefix: CUSTOM_ID_PREFIX,
      async handle(interaction) {
        const linkedAccountId = interaction.customId.slice(CUSTOM_ID_PREFIX.length);
        const trackedCharacterId = interaction.values[0];

        const row = await getByIdForOwner(trackedCharacterId, linkedAccountId);
        if (!row) {
          await interaction.update({ content: 'That character is no longer tracked.', components: [] });
          return;
        }

        if (row.view_mode !== 'competitive') {
          await interaction.update({
            content:
              `**${row.character_name}** is tracked in **compact** view, which doesn't record stats for a ` +
              `character page. Run \`/untrack-character\` then \`/track-character\` again and pick ` +
              `**Competitive** to start collecting stats.`,
            components: [],
          });
          return;
        }

        if (!row.class_name) {
          await interaction.update({
            content: `No competitive clears recorded yet for **${row.character_name}** — check back after its next clear.`,
            components: [],
          });
          return;
        }

        const { total, tierCounts, contributionTierCounts } = await getStats(row.id, TIERS);
        const badgeLine = (counts) => TIERS.map((t) => `${t.emoji}${counts[t.key]}`).join('  ');

        const color = row.role === 'support' ? SUPPORT_COLOR : row.role === 'dps' ? DPS_COLOR : FALLBACK_COLOR;
        const iconPath = getClassIconPath(row.class_name);

        // Supports get Uptime and Contribution badges tracked separately —
        // they're distinct percentile metrics. DPS only ever has one.
        const badgeFields =
          row.role === 'support'
            ? [
                { name: 'Uptime Badges', value: badgeLine(tierCounts) || 'None yet', inline: false },
                { name: 'Contribution Badges', value: badgeLine(contributionTierCounts) || 'None yet', inline: false },
              ]
            : [{ name: 'Badges', value: badgeLine(tierCounts) || 'None yet', inline: false }];

        const embed = new EmbedBuilder()
          .setTitle(row.character_name)
          .setDescription(`**${row.class_name}**\nTotal raids cleared: **${total}**`)
          .addFields(badgeFields)
          .setColor(color);

        const files = [];
        if (iconPath) {
          files.push(new AttachmentBuilder(iconPath, { name: 'class.png' }));
          embed.setThumbnail('attachment://class.png');
        }

        await interaction.update({ content: null, embeds: [embed], components: [], files });
      },
    },
  ],
};
