import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { listByGuild } from '../../db/trackedCharacters.js';

export const registeredUsersCommand = {
  data: new SlashCommandBuilder()
    .setName('registered-users')
    .setDescription('List everyone tracking a character in this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const rows = await listByGuild(interaction.guildId);

    if (rows.length === 0) {
      await interaction.reply({
        content: 'No one is tracking a character in this server yet.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = rows.map((row) => {
      const status = row.enabled ? row.account_status : 'disabled';
      return `<@${row.discord_user_id}> — **${row.character_name}** (${row.region}) — ${status}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`Registered users (${rows.length})`)
      .setDescription(lines.join('\n'))
      .setColor(0x5865f2);

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
