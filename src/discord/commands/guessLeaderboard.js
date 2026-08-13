import { SlashCommandBuilder, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { getLeaderboard } from '../../db/guessGame.js';
import { getLastResetAt } from '../../db/guildSettings.js';
import { FALLBACK_COLOR } from '../../notify/clearMessage.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export const guessLeaderboardCommand = {
  data: new SlashCommandBuilder()
    .setName('guess-leaderboard')
    .setDescription('Top /guess-parse guessers in this server'),

  async execute(interaction) {
    await interaction.deferReply();

    // Scoped to the current week, same boundary the weekly reset itself
    // uses — null (no lower bound) for a guild that's never had a reset
    // yet, so a brand-new server still shows something instead of nothing.
    const weekStart = await getLastResetAt(interaction.guildId);
    const rows = await getLeaderboard(interaction.guildId, weekStart);
    if (rows.length === 0) {
      await interaction.editReply('No one has won a round of `/guess-parse` here yet — be the first!');
      return;
    }

    const lines = await Promise.all(
      rows.map(async (row, i) => {
        const user = await interaction.client.users.fetch(row.discord_user_id).catch(() => null);
        // Modern Discord usernames can contain `_`/`.`, which are
        // markdown-significant — escape before it sits next to the bold
        // rank marker.
        const name = user ? escapeMarkdown(user.username) : `Unknown user (${row.discord_user_id})`;
        const rank = MEDALS[i] ?? `**${i + 1}.**`;
        return `${rank} ${name} — ${row.points} point${row.points === 1 ? '' : 's'} (${row.guesses} guess${row.guesses === 1 ? '' : 'es'})`;
      }),
    );

    const embed = new EmbedBuilder()
      .setTitle('Guess-the-Parse Leaderboard')
      .setDescription(lines.join('\n'))
      .setColor(FALLBACK_COLOR);

    await interaction.editReply({ embeds: [embed] });
  },
};
