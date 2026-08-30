import { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, MessageFlags } from 'discord.js';
import { getByDiscordUserId } from '../../db/linkedAccounts.js';
import { listByLinkedAccountAndGuild, remove } from '../../db/trackedCharacters.js';
import { getClassEmoji } from '../../notify/classIcons.js';
import { formatStat } from '../../notify/clearMessage.js';

const CUSTOM_ID_PREFIX = 'untrack-character-select:';
const MAX_OPTIONS = 25; // Discord select menu limit

export const untrackCharacterCommand = {
  data: new SlashCommandBuilder()
    .setName('untrack-character')
    .setDescription('Stop tracking one or more of your characters in this server'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const account = await getByDiscordUserId(interaction.user.id);
    if (!account) {
      await interaction.editReply("You don't have any tracked characters in this server.");
      return;
    }

    const tracked = await listByLinkedAccountAndGuild(account.id, interaction.guildId);
    if (tracked.length === 0) {
      await interaction.editReply("You don't have any tracked characters in this server.");
      return;
    }

    // Same label/description shape as /track-character's select menu (class
    // icon + name + server + iLvl) — both class_name and gear_score can
    // legitimately be null for a character not yet polled even once, so
    // iLvl always shows (as "N/A" via formatStat) while the class name
    // prefix is simply dropped rather than showing a blank one.
    const options = tracked.slice(0, MAX_OPTIONS).map((row) => {
      const server = row.world ? `${row.world}, ${row.region}` : row.region;
      const gearScore = row.gear_score !== null ? Number(row.gear_score) : null;
      const description = row.class_name ? `${row.class_name} — iLvl ${formatStat(gearScore)}` : `iLvl ${formatStat(gearScore)}`;
      return {
        label: `${row.character_name} (${server})`,
        description,
        value: row.id,
        emoji: row.class_name ? (getClassEmoji(row.class_name) ?? undefined) : undefined,
      };
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}${account.id}`)
      .setPlaceholder('Select character(s) to stop tracking')
      .setMinValues(1)
      .setMaxValues(options.length)
      .addOptions(options);

    await interaction.editReply({
      content: 'Pick which character(s) to stop tracking in this server.',
      components: [new ActionRowBuilder().addComponents(select)],
    });
  },

  componentHandlers: [
    {
      prefix: CUSTOM_ID_PREFIX,
      async handle(interaction) {
        const linkedAccountId = interaction.customId.slice(CUSTOM_ID_PREFIX.length);

        for (const trackedCharacterId of interaction.values) {
          await remove(trackedCharacterId, linkedAccountId);
        }

        const count = interaction.values.length;
        await interaction.update({
          content: `Stopped tracking ${count} character${count === 1 ? '' : 's'} in this server.`,
          components: [],
        });
      },
    },
  ],
};
