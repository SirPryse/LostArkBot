import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import {
  setAnnouncementChannel,
  getAnnouncementChannel,
  getReauthNoticeMessageId,
  setReauthNoticeMessageId,
} from '../../db/guildSettings.js';
import { refreshAllReauthNotices } from '../../notify/reauthNotice.js';

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
    const previousChannelId = await getAnnouncementChannel(interaction.guildId);
    await setAnnouncementChannel(interaction.guildId, channel.id);
    await interaction.reply({
      content: `Raid clears for this server will now be announced in <#${channel.id}>.`,
      flags: MessageFlags.Ephemeral,
    });

    // Move the re-link notice (notify/reauthNotice.js) along with the
    // channel: delete it from the old one, then let a refresh post it fresh
    // in the new one. Best-effort — never fails the command.
    if (previousChannelId !== channel.id) {
      try {
        const noticeId = await getReauthNoticeMessageId(interaction.guildId);
        if (noticeId && previousChannelId) {
          const oldChannel = await interaction.client.channels.fetch(previousChannelId).catch(() => null);
          await oldChannel?.messages.delete(noticeId).catch(() => {});
          await setReauthNoticeMessageId(interaction.guildId, null);
        }
        await refreshAllReauthNotices(interaction.client);
      } catch (err) {
        console.error('announce-channel: failed to move re-link notice:', err);
      }
    }
  },
};
