import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { listByGuild } from '../../db/trackedCharacters.js';

const PAGE_PREFIX = 'registered-users-page:';
// Comfortably under Discord's 4096-char embed description cap — confirmed
// live that Auroral Teahouse's 76+ tracked characters produced a ~4600-char
// description, and setDescription() throws outright on overflow rather
// than truncating. Packing lines into character-budgeted pages (with
// Prev/Next navigation) instead of one giant description keeps every page
// safely under the limit no matter how many characters get tracked.
const PAGE_CHAR_BUDGET = 3500;

/** Packs lines into arrays, each under `limit` joined chars — greedy fill,
 * never splits a single line across two pages. */
function chunkLines(lines, limit) {
  const chunks = [];
  let current = [];
  let length = 0;
  for (const line of lines) {
    const lineLength = line.length + 1; // +1 for the joining newline
    if (current.length > 0 && length + lineLength > limit) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(line);
    length += lineLength;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Builds one page's reply payload, or null if the server has no tracked
 * characters at all (distinct from "page index out of range", which just
 * clamps to the nearest real page). */
async function buildPage(guildId, requestedPageIndex) {
  const rows = await listByGuild(guildId);
  if (rows.length === 0) return null;

  const lines = rows.map((row) => {
    const status = row.enabled ? row.account_status : 'disabled';
    return `<@${row.discord_user_id}> — **${row.character_name}** (${row.region}) — ${status}`;
  });

  const pages = chunkLines(lines, PAGE_CHAR_BUDGET);
  const pageIndex = Math.max(0, Math.min(requestedPageIndex, pages.length - 1));
  const pageLines = pages[pageIndex];

  const startCount = pages.slice(0, pageIndex).reduce((sum, p) => sum + p.length, 0) + 1;
  const endCount = startCount + pageLines.length - 1;

  const embed = new EmbedBuilder()
    .setTitle(`Registered users (${rows.length})`)
    .setDescription(pageLines.join('\n'))
    .setColor(0x5865f2)
    .setFooter({ text: `${startCount}-${endCount} of ${rows.length} — Page ${pageIndex + 1}/${pages.length}` });

  const components =
    pages.length > 1
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${PAGE_PREFIX}${pageIndex - 1}`)
              .setLabel('◀ Prev')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(pageIndex <= 0),
            new ButtonBuilder()
              .setCustomId(`${PAGE_PREFIX}${pageIndex + 1}`)
              .setLabel('Next ▶')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(pageIndex >= pages.length - 1),
          ),
        ]
      : [];

  return { embeds: [embed], components };
}

export const registeredUsersCommand = {
  data: new SlashCommandBuilder()
    .setName('registered-users')
    .setDescription('List everyone tracking a character in this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const payload = await buildPage(interaction.guildId, 0);
    if (!payload) {
      await interaction.reply({
        content: 'No one is tracking a character in this server yet.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },

  componentHandlers: [
    {
      prefix: PAGE_PREFIX,
      async handle(interaction) {
        const pageIndex = Number(interaction.customId.slice(PAGE_PREFIX.length));
        const payload = await buildPage(interaction.guildId, pageIndex);
        if (!payload) {
          await interaction.update({ content: 'No one is tracking a character in this server anymore.', embeds: [], components: [] });
          return;
        }
        await interaction.update(payload);
      },
    },
  ],
};
