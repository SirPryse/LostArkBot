import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { countByGuild, removeAllByGuild } from '../../db/trackedCharacters.js';

const CONFIRM_PREFIX = 'untrack-all-confirm';
const CANCEL_PREFIX = 'untrack-all-cancel';

export const untrackAllCommand = {
  data: new SlashCommandBuilder()
    .setName('untrack-all')
    .setDescription('Stop tracking every character in this server, for every user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const count = await countByGuild(interaction.guildId);

    if (count === 0) {
      await interaction.reply({
        content: 'No characters are currently tracked in this server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CONFIRM_PREFIX).setLabel('Untrack everything').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(CANCEL_PREFIX).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content: `⚠️ This will stop tracking **${count}** character(s) in this server — for every user, not just yours. This can't be undone. Continue?`,
      components: [buttons],
      flags: MessageFlags.Ephemeral,
    });
  },

  componentHandlers: [
    {
      prefix: CANCEL_PREFIX,
      async handle(interaction) {
        await interaction.update({ content: 'Cancelled — nothing was untracked.', components: [] });
      },
    },
    {
      prefix: CONFIRM_PREFIX,
      async handle(interaction) {
        const removed = await removeAllByGuild(interaction.guildId);
        await interaction.update({
          content: `Untracked ${removed} character(s) in this server.`,
          components: [],
        });
      },
    },
  ],
};
