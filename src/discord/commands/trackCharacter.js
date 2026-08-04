import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { getByDiscordUserId } from '../../db/linkedAccounts.js';
import { create, listByLinkedAccountAndGuild } from '../../db/trackedCharacters.js';
import { getRosters } from '../../lostarkbible/client.js';
import { decryptToken } from '../../crypto/tokenCipher.js';
import { TokenExpiredError, InsufficientScopeError } from '../../lostarkbible/errors.js';

const APP_PAGE_URL = 'https://lost-ark-app-page.vercel.app';
const SELECT_PREFIX = 'track-character-select:';
const VIEW_PREFIX = 'track-character-view:';
const MAX_OPTIONS = 25; // Discord select menu limit

function buildViewCustomId(mode, linkedAccountId, characterName, region) {
  return `${VIEW_PREFIX}${mode}:${linkedAccountId}:${encodeURIComponent(characterName)}:${region}`;
}

export const trackCharacterCommand = {
  data: new SlashCommandBuilder()
    .setName('track-character')
    .setDescription('Pick one of your lostark.bible characters to track in this server'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const account = await getByDiscordUserId(interaction.user.id);
    if (!account) {
      await interaction.editReply(
        `You haven't linked a lostark.bible account yet. Link one first at ${APP_PAGE_URL}, then run this again.`,
      );
      return;
    }
    if (account.status !== 'active' || new Date(account.token_expires_at) <= new Date()) {
      await interaction.editReply(
        `Your lostark.bible link needs to be re-authorized. Visit ${APP_PAGE_URL} to relink.`,
      );
      return;
    }

    let rosters;
    try {
      const data = await getRosters(decryptToken(account.access_token));
      rosters = data?.rosters ?? [];
    } catch (err) {
      if (err instanceof TokenExpiredError || err instanceof InsufficientScopeError) {
        await interaction.editReply(
          `Your lostark.bible link needs to be re-authorized. Visit ${APP_PAGE_URL} to relink.`,
        );
        return;
      }
      throw err;
    }

    const allCharacters = rosters.flatMap((roster) =>
      (roster.characters ?? []).map((character) => ({ ...character, region: roster.region, world: roster.world })),
    );

    if (allCharacters.length === 0) {
      await interaction.editReply('No characters found on your lostark.bible roster.');
      return;
    }

    const alreadyTracked = await listByLinkedAccountAndGuild(account.id, interaction.guildId);
    const trackedKeys = new Set(alreadyTracked.map((t) => `${t.character_name}|${t.region}`));
    const characters = allCharacters.filter((c) => !trackedKeys.has(`${c.name}|${c.region}`));

    if (characters.length === 0) {
      await interaction.editReply('All of your characters are already tracked in this server.');
      return;
    }

    const options = characters.slice(0, MAX_OPTIONS).map((c) => ({
      label: `${c.name} (${c.world}, ${c.region})`,
      description: `${c.class} — iLvl ${c.ilvl}`.slice(0, 100),
      value: `${c.name}|${c.region}`,
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId(`${SELECT_PREFIX}${account.id}`)
      .setPlaceholder('Select a character')
      .addOptions(options);

    const truncatedNote =
      characters.length > MAX_OPTIONS
        ? `\n(Showing the first ${MAX_OPTIONS} of ${characters.length} characters.)`
        : '';

    await interaction.editReply({
      content: `Pick a character to track in this server.${truncatedNote}`,
      components: [new ActionRowBuilder().addComponents(select)],
    });
  },

  componentHandlers: [
    {
      // Character picked from the roster — now ask which view mode to announce with.
      prefix: SELECT_PREFIX,
      async handle(interaction) {
        const linkedAccountId = interaction.customId.slice(SELECT_PREFIX.length);
        const [characterName, region] = interaction.values[0].split('|');

        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(buildViewCustomId('compact', linkedAccountId, characterName, region))
            .setLabel('Compact')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(buildViewCustomId('competitive', linkedAccountId, characterName, region))
            .setLabel('Competitive')
            .setStyle(ButtonStyle.Primary),
        );

        await interaction.update({
          content:
            `**${characterName}** (${region}) selected. Pick how clears should be announced:\n` +
            `**Compact** — Difficulty, Class, Gear Score, Combat Power only\n` +
            `**Competitive** — adds the full DPS/support stat breakdown`,
          components: [buttons],
        });
      },
    },
    {
      // View mode chosen — actually create the tracked_characters row.
      prefix: VIEW_PREFIX,
      async handle(interaction) {
        const [mode, linkedAccountId, encodedName, region] = interaction.customId
          .slice(VIEW_PREFIX.length)
          .split(':');
        const characterName = decodeURIComponent(encodedName);

        const row = await create({
          linkedAccountId,
          characterName,
          region,
          guildId: interaction.guildId,
          viewMode: mode,
        });

        await interaction.update({
          content: `Tracking **${row.character_name}** (${row.region}) in this server — **${mode}** view. New clears will post once \`/announce-channel\` is set.`,
          components: [],
        });
      },
    },
  ],
};
