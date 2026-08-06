import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

const CONFIRM_PREFIX = 'clear-channel-confirm';
const CANCEL_PREFIX = 'clear-channel-cancel';
const FETCH_BATCH_SIZE = 100; // Discord's max per fetch/bulkDelete call
const MAX_MESSAGES = 10000; // safety cap so a huge channel can't run forever
const INDIVIDUAL_DELETE_DELAY_MS = 1100; // messages >14 days old can't bulk-delete, must go one at a time
// Individual deletes are slow enough (~1.2/sec) that clearing a lot of old
// messages could outlast the ~15min window Discord gives an interaction
// token to edit its reply. Capped well under that so the final status
// message can always still be sent.
const MAX_INDIVIDUAL_DELETES = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deletes every message in the channel. Bulk-deletes whatever's under
 * Discord's 14-day bulk-delete window in one call per 100; anything older
 * has to be removed one at a time (much slower, rate-limited). */
async function clearChannel(channel) {
  let deleted = 0;
  let individualDeletes = 0;
  let hitCap = false;

  outer: for (;;) {
    const batch = await channel.messages.fetch({ limit: FETCH_BATCH_SIZE });
    if (batch.size === 0) break;

    const bulkDeleted = await channel.bulkDelete(batch, true); // true = silently skip messages >14 days old
    deleted += bulkDeleted.size;

    const tooOld = batch.filter((m) => !bulkDeleted.has(m.id));
    for (const message of tooOld.values()) {
      if (individualDeletes >= MAX_INDIVIDUAL_DELETES) {
        hitCap = true;
        break outer;
      }
      await message.delete().catch(() => {}); // already gone, permissions changed mid-run, etc.
      deleted += 1;
      individualDeletes += 1;
      await sleep(INDIVIDUAL_DELETE_DELAY_MS);
    }

    if (deleted >= MAX_MESSAGES) {
      hitCap = true;
      break;
    }
  }

  return { deleted, hitCap };
}

export const clearChannelCommand = {
  data: new SlashCommandBuilder()
    .setName('clear-channel')
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
        const note = hitCap ? `\nStopped early (safety cap) — run \`/clear-channel\` again to continue.` : '';
        try {
          await interaction.editReply({ content: `Deleted ${deleted} message(s) from this channel.${note}` });
        } catch (err) {
          // Interaction token can expire on a very long run (lots of >14-day-old
          // messages) even with the caps above — the deletions themselves still
          // happened, just log it instead of throwing an unhandled rejection.
          console.error('clear-channel: failed to post final status (token likely expired):', err);
        }
      },
    },
  ],
};
