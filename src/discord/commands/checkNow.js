import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { enqueueImmediateTick } from '../../scheduler/queue.js';

export const checkNowCommand = {
  data: new SlashCommandBuilder()
    .setName('check-now')
    .setDescription('Debug: force an immediate poll cycle instead of waiting for the schedule')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await enqueueImmediateTick();
    await interaction.reply({
      content: 'Queued an immediate poll cycle for all tracked characters.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
