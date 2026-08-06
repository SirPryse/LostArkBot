import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { runPollTick } from '../../scheduler/poller.js';

export const checkNowCommand = {
  data: new SlashCommandBuilder()
    .setName('check-now')
    .setDescription('Debug: force an immediate poll cycle instead of waiting for the schedule')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    // Fire-and-forget — same UX as before, the reply doesn't wait for the
    // full pass over every tracked character to finish.
    runPollTick(interaction.client).catch((err) => console.error('Manual poll tick failed:', err));
    await interaction.reply({
      content: 'Started an immediate poll cycle for all tracked characters.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
