import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getEnabledByGuildAndName } from '../../db/trackedCharacters.js';
import { markNeedsReauth } from '../../db/linkedAccounts.js';
import { getCharacterLogs } from '../../lostarkbible/client.js';
import { decryptToken } from '../../crypto/tokenCipher.js';
import { TokenExpiredError, InsufficientScopeError } from '../../lostarkbible/errors.js';

export const recentRaidsCommand = {
  data: new SlashCommandBuilder()
    .setName('recent-raids')
    .setDescription('List the last 10 raid clears for a character tracked in this server')
    .addStringOption((option) =>
      option
        .setName('character')
        .setDescription('Character name (must already be tracked in this server)')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const characterName = interaction.options.getString('character', true);
    const row = await getEnabledByGuildAndName(interaction.guildId, characterName);

    if (!row) {
      await interaction.editReply(`${characterName} isn't tracked in this server yet.`);
      return;
    }

    if (row.account_status !== 'active' || new Date(row.token_expires_at) <= new Date()) {
      await interaction.editReply(`${row.character_name}'s lostark.bible link needs to be re-authorized.`);
      if (row.account_status === 'active') {
        await markNeedsReauth(row.linked_account_id);
      }
      return;
    }

    let entries;
    try {
      entries = await getCharacterLogs(decryptToken(row.access_token), row.character_name, row.region, {
        page: 1,
      });
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        await markNeedsReauth(row.linked_account_id);
        await interaction.editReply(`${row.character_name}'s lostark.bible link expired.`);
        return;
      }
      if (err instanceof InsufficientScopeError) {
        await interaction.editReply('Missing permission to read that character\'s logs.');
        return;
      }
      throw err;
    }

    if (!entries || entries.length === 0) {
      await interaction.editReply(`No public logs found for ${row.character_name}.`);
      return;
    }

    const last10 = entries.slice(0, 10);
    const lines = last10.map(
      (entry, i) =>
        `**${i + 1}.** ${entry.boss} (${entry.difficulty}) — <t:${Math.floor(entry.timestamp / 1000)}:R>`,
    );

    const embed = new EmbedBuilder()
      .setTitle(`Last ${last10.length} raid clears — ${row.character_name}`)
      .setDescription(lines.join('\n'))
      .setColor(0x5865f2);

    await interaction.editReply({ embeds: [embed] });
  },
};
