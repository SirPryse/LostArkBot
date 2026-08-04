import { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, MessageFlags } from 'discord.js';
import { getByDiscordUserId } from '../../db/linkedAccounts.js';
import { listByLinkedAccountAndGuild, remove } from '../../db/trackedCharacters.js';

const CUSTOM_ID_PREFIX = 'untrack-character-select:';
const MAX_OPTIONS = 25; // Discord select menu limit

export const untrackCharacterCommand = {
  data: new SlashCommandBuilder()
    .setName('untrack-character')
    .setDescription('Stop tracking one of your characters in this server'),

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
      value: row.id,
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}${account.id}`)
      .setPlaceholder('Select a character to stop tracking')
      .addOptions(options);

    await interaction.editReply({
      content: 'Pick a character to stop tracking in this server.',
      components: [new ActionRowBuilder().addComponents(select)],
    });
  },

  customIdPrefix: CUSTOM_ID_PREFIX,

  async handleComponent(interaction) {
    const linkedAccountId = interaction.customId.slice(CUSTOM_ID_PREFIX.length);
    const trackedCharacterId = interaction.values[0];

    await remove(trackedCharacterId, linkedAccountId);

    await interaction.update({
      content: 'Stopped tracking that character in this server.',
      components: [],
    });
  },
};
