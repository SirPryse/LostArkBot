import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { setAnnouncementChannel } from '../../db/guildSettings.js';

export const announceChannelCommand = {
  data: new SlashCommandBuilder()
    .setName('announce-channel')
    .setDescription('Set the channel where new raid clears are announced for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post raid clear announcements in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel', true);
    await setAnnouncementChannel(interaction.guildId, channel.id);
    await interaction.reply({
      content: `Raid clears for this server will now be announced in <#${channel.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
