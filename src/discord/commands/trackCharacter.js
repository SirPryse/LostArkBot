import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import { getByDiscordUserId } from '../../db/linkedAccounts.js';
import { create } from '../../db/trackedCharacters.js';
import { getRosters } from '../../lostarkbible/client.js';
import { decryptToken } from '../../crypto/tokenCipher.js';
import { TokenExpiredError, InsufficientScopeError } from '../../lostarkbible/errors.js';

const APP_PAGE_URL = 'https://lost-ark-app-page.vercel.app';
const CUSTOM_ID_PREFIX = 'track-character-select:';
const MAX_OPTIONS = 25; // Discord select menu limit

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

    const characters = rosters.flatMap((roster) =>
      (roster.characters ?? []).map((character) => ({ ...character, region: roster.region, world: roster.world })),
    );

    if (characters.length === 0) {
      await interaction.editReply('No characters found on your lostark.bible roster.');
      return;
    }

    const options = characters.slice(0, MAX_OPTIONS).map((c) => ({
      label: `${c.name} (${c.world}, ${c.region})`,
      description: `${c.class} — iLvl ${c.ilvl}`.slice(0, 100),
      value: `${c.name}|${c.region}`,
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}${account.id}`)
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

  customIdPrefix: CUSTOM_ID_PREFIX,

  async handleComponent(interaction) {
    const linkedAccountId = interaction.customId.slice(CUSTOM_ID_PREFIX.length);
    const [characterName, region] = interaction.values[0].split('|');

    const row = await create({
      linkedAccountId,
      characterName,
      region,
      guildId: interaction.guildId,
    });

    await interaction.update({
      content: `Tracking **${row.character_name}** (${row.region}) in this server. New clears will post once \`/announce-channel\` is set.`,
      components: [],
    });
  },
};
