import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getLeaderboard } from '../../db/guessGame.js';
import { FALLBACK_COLOR } from '../../notify/clearMessage.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export const guessLeaderboardCommand = {
  data: new SlashCommandBuilder()
    .setName('guess-leaderboard')
    .setDescription('Top /guess-parse guessers in this server'),

  async execute(interaction) {
    await interaction.deferReply();

    const rows = await getLeaderboard(interaction.guildId);
    if (rows.length === 0) {
      await interaction.editReply('No one has won a round of `/guess-parse` here yet — be the first!');
      return;
    }

    const lines = await Promise.all(
      rows.map(async (row, i) => {
        const user = await interaction.client.users.fetch(row.discord_user_id).catch(() => null);
        const name = user ? user.username : `Unknown user (${row.discord_user_id})`;
        const rank = MEDALS[i] ?? `**${i + 1}.**`;
        return `${rank} ${name} — ${row.points} point${row.points === 1 ? '' : 's'}`;
      }),
    );

    const embed = new EmbedBuilder()
      .setTitle('Guess-the-Parse Leaderboard')
      .setDescription(lines.join('\n'))
      .setColor(FALLBACK_COLOR);

    await interaction.editReply({ embeds: [embed] });
  },
};
