import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
} from 'discord.js';
import { getByDiscordUserId } from '../../db/linkedAccounts.js';
import { listByLinkedAccountAndGuild, getByIdForOwner, getByIdForDiscordUser } from '../../db/trackedCharacters.js';
import { getStats } from '../../db/clearHistory.js';
import { getClassIconPath } from '../../notify/classIcons.js';
import { TIERS } from '../../notify/percentileTiers.js';
import { SUPPORT_COLOR, DPS_COLOR, FALLBACK_COLOR, formatStat } from '../../notify/clearMessage.js';

const SELECT_PREFIX = 'character-page-select:';
const VISIBILITY_PREFIX = 'character-page-vis:';
const MAX_OPTIONS = 25; // Discord select menu limit

function formatOptionalStat(value) {
  return value === null || value === undefined ? 'N/A' : formatStat(Number(value));
}

/** One tier per line (rather than crammed onto one line) so the badge
 * counts are actually readable. */
function badgeLines(counts) {
  return TIERS.map((t) => `${t.emoji} **${counts[t.key]}**`).join('\n');
}

async function buildCharacterPageEmbed(row) {
  const { total, diedCount, tierCounts, contributionTierCounts } = await getStats(row.id, TIERS);

  const color = row.role === 'support' ? SUPPORT_COLOR : row.role === 'dps' ? DPS_COLOR : FALLBACK_COLOR;
  const iconPath = getClassIconPath(row.class_name);
  const worldName = row.world ?? 'Unknown';

  // Supports get Uptime and Contribution badges tracked separately — they're
  // distinct percentile metrics — shown side by side. DPS only ever has one.
  const badgeFields =
    row.role === 'support'
      ? [
          { name: 'Uptime Badges', value: badgeLines(tierCounts), inline: true },
          { name: 'Contribution Badges', value: badgeLines(contributionTierCounts), inline: true },
        ]
      : [{ name: 'Badges', value: badgeLines(tierCounts), inline: false }];

  const embed = new EmbedBuilder()
    .setTitle(`${row.character_name} the ${row.class_name}`)
    .setDescription(
      `Server: **${worldName}**\n` +
        `Gear Score: **${formatOptionalStat(row.gear_score)}**\n` +
        `Combat Power: **${formatOptionalStat(row.combat_power)}**\n` +
        `Total gates cleared: **${total}**\n` +
        `Died in **${diedCount}** raid${diedCount === 1 ? '' : 's'}`,
    )
    .addFields(badgeFields)
    .setColor(color);

  const files = [];
  if (iconPath) {
    files.push(new AttachmentBuilder(iconPath, { name: 'class.png' }));
    embed.setThumbnail('attachment://class.png');
  }

  return { embeds: [embed], files };
}

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
      .setCustomId(`${SELECT_PREFIX}${account.id}`)
      .setPlaceholder('Select a character')
      .addOptions(options);

    await interaction.editReply({
      content: 'Pick a character to view its page.',
      components: [new ActionRowBuilder().addComponents(select)],
    });
  },

  componentHandlers: [
    {
      // Character picked — validate it has stats to show, then ask whether
      // to post it publicly or keep it private before actually building it.
      prefix: SELECT_PREFIX,
      async handle(interaction) {
        const linkedAccountId = interaction.customId.slice(SELECT_PREFIX.length);
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

        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${VISIBILITY_PREFIX}self:${row.id}`)
            .setLabel('Only me')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`${VISIBILITY_PREFIX}everyone:${row.id}`)
            .setLabel('Post to everyone')
            .setStyle(ButtonStyle.Primary),
        );

        await interaction.update({
          content: `**${row.character_name}**'s page is ready. Who should see it?`,
          components: [buttons],
        });
      },
    },
    {
      // Visibility chosen — build the page and either post it publicly
      // (a real followUp, not the ephemeral original) or keep it private.
      prefix: VISIBILITY_PREFIX,
      async handle(interaction) {
        const [visibility, trackedCharacterId] = interaction.customId.slice(VISIBILITY_PREFIX.length).split(':');

        const row = await getByIdForDiscordUser(trackedCharacterId, interaction.user.id);
        if (!row) {
          await interaction.update({ content: 'That character is no longer tracked.', components: [] });
          return;
        }

        const payload = await buildCharacterPageEmbed(row);

        await interaction.update({ content: 'Here you go!', components: [] });
        await interaction.followUp({
          ...payload,
          flags: visibility === 'everyone' ? undefined : MessageFlags.Ephemeral,
        });
      },
    },
  ],
};
