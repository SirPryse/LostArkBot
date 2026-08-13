import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { clearChannel } from '../../utils/clearChannel.js';

const CONFIRM_PREFIX = 'nuke-confirm';
const CANCEL_PREFIX = 'nuke-cancel';

export const nukeCommand = {
  data: new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Delete every message in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    if (!interaction.channel.permissionsFor(interaction.client.user).has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content:
          "I don't have permission to delete messages in this channel. Grant me **Manage Messages** here (channel Settings → Permissions) and try again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CONFIRM_PREFIX).setLabel('Delete everything').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(CANCEL_PREFIX).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content: `⚠️ This will permanently delete **every message** in ${interaction.channel}. This can't be undone. Continue?`,
      components: [buttons],
      flags: MessageFlags.Ephemeral,
    });
  },

  componentHandlers: [
    {
      prefix: CANCEL_PREFIX,
      async handle(interaction) {
        await interaction.update({ content: 'Cancelled — nothing was deleted.', components: [] });
      },
    },
    {
      prefix: CONFIRM_PREFIX,
      async handle(interaction) {
        await interaction.update({ content: 'Deleting messages…', components: [] });

        let result;
        try {
          result = await clearChannel(interaction.channel);
        } catch (err) {
          // Discord's numeric code for "Missing Permissions" — give a
          // specific, actionable message instead of the generic fallback
          // client.js's error handler would otherwise show.
          if (err.code === 50013) {
            await interaction.editReply({
              content:
                "I don't have permission to delete messages in this channel. Grant me **Manage Messages** here (channel Settings → Permissions) and try again.",
            });
            return;
          }
          throw err; // anything else — let client.js's generic handler catch it
        }

        const { deleted, hitCap } = result;
        const note = hitCap ? `\nStopped early (safety cap) — run \`/nuke\` again to continue.` : '';
        try {
          await interaction.editReply({ content: `Deleted ${deleted} message(s) from this channel.${note}` });
        } catch (err) {
          // Interaction token can expire on a very long run (lots of >14-day-old
          // messages) even with the caps above — the deletions themselves still
          // happened, just log it instead of throwing an unhandled rejection.
          console.error('nuke: failed to post final status (token likely expired):', err);
        }
      },
    },
  ],
};
