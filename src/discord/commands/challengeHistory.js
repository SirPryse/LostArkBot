import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { listChallengesForDiscordUser } from '../../db/challenges.js';
import { getFriendlyBossName } from '../../notify/raidFamilies.js';
import { getClassEmoji } from '../../notify/classIcons.js';
import { FALLBACK_COLOR } from '../../notify/clearMessage.js';

const MAX_HISTORY_SHOWN = 8;

/** `<:name:id>` — the inline-text form of a custom emoji, same per-file copy
 * convention as bonk.js/poller.js/challenge.js each keep. */
function emojiTag(classNameOrIconKey) {
  const emoji = getClassEmoji(classNameOrIconKey);
  return emoji ? `<:${emoji.name}:${emoji.id}>` : '';
}

const ROLE_EMOJI = { dps: '🗡️', support: '🛡️' };

function unixSeconds(dateLike) {
  return Math.floor(new Date(dateLike).getTime() / 1000);
}

function formatActiveLine(row) {
  const gateLabel = getFriendlyBossName(row.boss_name, row.difficulty);
  const namePrefix = row.class_name ? `${emojiTag(row.class_name)} ` : '';
  const roleEmoji = ROLE_EMOJI[row.role] ?? '';
  return `${namePrefix}**${row.character_name}** — ${roleEmoji} ${gateLabel} (${row.difficulty}) — accepted <t:${unixSeconds(row.created_at)}:R>`;
}

function formatHistoryLine(row) {
  const gateLabel = getFriendlyBossName(row.boss_name, row.difficulty);
  const namePrefix = row.class_name ? `${emojiTag(row.class_name)} ` : '';
  const resultEmoji = row.status === 'completed' ? '✅' : '❌';
  const resolvedAt = row.completed_at ?? row.met_at ?? row.created_at;
  return `${resultEmoji} ${namePrefix}**${row.character_name}** — ${gateLabel} (${row.difficulty}) — <t:${unixSeconds(resolvedAt)}:R>`;
}

export const challengeHistoryCommand = {
  data: new SlashCommandBuilder()
    .setName('challenge-history')
    .setDescription("View someone's /challenge history in this server — active and past")
    .addUserOption((option) =>
      option.setName('user').setDescription('Whose challenges to look up (defaults to you)'),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const rows = await listChallengesForDiscordUser(targetUser.id, interaction.guildId);

    if (rows.length === 0) {
      await interaction.editReply(`${targetUser} doesn't have any \`/challenge\` history in this server yet.`);
      return;
    }

    const active = rows.filter((r) => r.status === 'active');
    // 'abandoned' rows (replaced by a same-gate re-accept) are deliberately
    // left out of the history — they were never actually decided one way
    // or the other, so showing them next to real completions/failures
    // would just be noise.
    const resolved = rows.filter((r) => r.status === 'completed' || r.status === 'failed');

    const fields = [
      {
        name: `🟢 Active (${active.length})`,
        value: active.length > 0 ? active.map(formatActiveLine).join('\n') : 'No active challenges right now.',
        inline: false,
      },
      {
        name: `📜 Recent History (last ${Math.min(resolved.length, MAX_HISTORY_SHOWN)} of ${resolved.length})`,
        value:
          resolved.length > 0
            ? resolved.slice(0, MAX_HISTORY_SHOWN).map(formatHistoryLine).join('\n')
            : 'No completed or failed challenges yet.',
        inline: false,
      },
    ];

    const embed = new EmbedBuilder()
      .setTitle(`🎯 ${targetUser.username}'s Challenges`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(fields)
      .setColor(FALLBACK_COLOR);

    await interaction.editReply({ embeds: [embed] });
  },
};
