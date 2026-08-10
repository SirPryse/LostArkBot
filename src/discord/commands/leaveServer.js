import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { countByGuild, removeAllByGuild } from '../../db/trackedCharacters.js';

const CONFIRM_PREFIX = 'leave-server-confirm';
const CANCEL_PREFIX = 'leave-server-cancel';

export const leaveServerCommand = {
  data: new SlashCommandBuilder()
    .setName('leave-server')
    .setDescription('Untrack everything in this server, then make the bot leave')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const count = await countByGuild(interaction.guildId);
    const trackingNote = count > 0 ? `stop tracking **${count}** character(s) and ` : '';

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CONFIRM_PREFIX).setLabel('Untrack everything & leave').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(CANCEL_PREFIX).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content:
        `⚠️ This will ${trackingNote}make the bot **leave this server**. This can't be undone from here — ` +
        "you'd need to re-invite the bot and re-track everything from scratch. Continue?",
      components: [buttons],
      flags: MessageFlags.Ephemeral,
    });
  },

  componentHandlers: [
    {
      prefix: CANCEL_PREFIX,
      async handle(interaction) {
        await interaction.update({ content: "Cancelled — I'm staying, nothing was untracked.", components: [] });
      },
    },
    {
      prefix: CONFIRM_PREFIX,
      async handle(interaction) {
        // Ack first and say what's about to happen — once the bot actually
        // leaves (last line below), no further interaction responses in
        // this guild are possible, so this update is the last thing the
        // admin will see.
        await interaction.update({ content: 'Untracking everything and leaving this server…', components: [] });

        const { guild } = interaction;
        await removeAllByGuild(interaction.guildId);
        await guild.leave();
      },
    },
  ],
};
