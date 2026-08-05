import { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, MessageFlags } from 'discord.js';
import { getByDiscordUserId } from '../../db/linkedAccounts.js';
import { listByLinkedAccountAndGuild, remove } from '../../db/trackedCharacters.js';
import { getClassEmoji } from '../../notify/classIcons.js';

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

    const options = tracked.slice(0, MAX_OPTIONS).map((row) => ({
      label: `${row.character_name} (${row.region})`,
      description: row.class_name ?? undefined,
      value: row.id,
      emoji: row.class_name ? (getClassEmoji(row.class_name) ?? undefined) : undefined,
    }));

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
