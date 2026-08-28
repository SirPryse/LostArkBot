import { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, MessageFlags } from 'discord.js';
import { getByDiscordUserId } from '../../db/linkedAccounts.js';
import { listDistinctByLinkedAccount } from '../../db/trackedCharacters.js';
import { listGoldEarners, setGoldEarners, MAX_GOLD_EARNERS } from '../../db/goldEarners.js';

const SELECT_PREFIX = 'gold-earners-select:';

export const goldEarnersCommand = {
  data: new SlashCommandBuilder()
    .setName('gold-earners')
    .setDescription(`Pick up to ${MAX_GOLD_EARNERS} characters as your roster's Gold Earners`),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const account = await getByDiscordUserId(interaction.user.id);
    if (!account) {
      await interaction.editReply(
        "You haven't linked a lostark.bible account yet. Run `/link-account` first, then run this again.",
      );
      return;
    }

    // Roster-wide, not guild-scoped — same character tracked in two servers
    // is still one slot, see the migration comment on gold_earners for why.
    const characters = await listDistinctByLinkedAccount(account.id);
    if (characters.length === 0) {
      await interaction.editReply("You don't have any tracked characters yet — run `/track-character` first.");
      return;
    }

    const current = await listGoldEarners(account.id);
    const currentKeys = new Set(current.map((c) => `${c.character_name}|${c.region}`));

    const options = characters.slice(0, 25).map((c) => ({
      label: `${c.character_name} (${c.region})`,
      value: `${c.character_name}|${c.region}`,
      default: currentKeys.has(`${c.character_name}|${c.region}`),
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId(`${SELECT_PREFIX}${account.id}`)
      .setPlaceholder(`Select up to ${MAX_GOLD_EARNERS} characters`)
      .setMinValues(0) // 0 is valid — clears the set back to "no gold earners"
      .setMaxValues(Math.min(MAX_GOLD_EARNERS, options.length))
      .addOptions(options);

    const currentList = current.length > 0
      ? current.map((c) => `**${c.character_name}** (${c.region})`).join(', ')
      : '*none set*';

    await interaction.editReply({
      content:
        `Currently: ${currentList}\n\n` +
        `Pick your Gold Earners (this **replaces** the current set, not adds to it). ` +
        `Only these characters' clears count toward the estimated-gold stat on ` +
        `\`/my-stats\`/\`/character-page\` — matches the real in-game 6-per-roster limit.`,
      components: [new ActionRowBuilder().addComponents(select)],
    });
  },

  componentHandlers: [
    {
      prefix: SELECT_PREFIX,
      async handle(interaction) {
        const linkedAccountId = interaction.customId.slice(SELECT_PREFIX.length);

        const characters = interaction.values.map((v) => {
          const [name, region] = v.split('|');
          return { name, region };
        });

        await setGoldEarners(linkedAccountId, characters);

        const list = characters.length > 0
          ? characters.map((c) => `**${c.name}** (${c.region})`).join(', ')
          : '*none*';

        await interaction.update({
          content: `Gold Earners updated: ${list}`,
          components: [],
        });
      },
    },
  ],
};
