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
const PENDING_TTL_MS = 10 * 60 * 1000; // matches how long an ephemeral reply is realistically actionable

// Selected characters don't fit in a button's 100-char customId once more
// than one or two are picked, so the batch is held here between the select
// menu step and the view-mode buttons instead. Single bot process, so
// in-memory is fine — worst case on a restart mid-flow, the user just
// re-runs the command.
const pendingSelections = new Map();

function storePending(messageId, value) {
  pendingSelections.set(messageId, value);
  setTimeout(() => pendingSelections.delete(messageId), PENDING_TTL_MS);
}

export const trackCharacterCommand = {
  data: new SlashCommandBuilder()
    .setName('track-character')
    .setDescription('Pick one or more of your lostark.bible characters to track in this server'),

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
      .setPlaceholder('Select character(s)')
      .setMinValues(1)
      .setMaxValues(options.length)
      .addOptions(options);

    const truncatedNote =
      characters.length > MAX_OPTIONS
        ? `\n(Showing the first ${MAX_OPTIONS} of ${characters.length} characters.)`
        : '';

    await interaction.editReply({
      content: `Pick which character(s) to track in this server.${truncatedNote}`,
      components: [new ActionRowBuilder().addComponents(select)],
    });
  },

  componentHandlers: [
    {
      // Character(s) picked from the roster — now ask which view mode to
      // announce all of them with.
      prefix: SELECT_PREFIX,
      async handle(interaction) {
        const linkedAccountId = interaction.customId.slice(SELECT_PREFIX.length);
        const selected = interaction.values.map((v) => {
          const [name, region] = v.split('|');
          return { name, region };
        });

        storePending(interaction.message.id, { linkedAccountId, characters: selected });

        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${VIEW_PREFIX}compact:${interaction.message.id}`)
            .setLabel('Compact')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`${VIEW_PREFIX}competitive:${interaction.message.id}`)
            .setLabel('Competitive')
            .setStyle(ButtonStyle.Primary),
        );

        const list = selected.map((c) => `${c.name} (${c.region})`).join(', ');

        await interaction.update({
          content:
            `Selected: **${list}**. Pick how these should be announced:\n` +
            `**Compact** — Difficulty, Class, Gear Score, Combat Power only\n` +
            `**Competitive** — adds the full DPS/support stat breakdown`,
          components: [buttons],
        });
      },
    },
    {
      // View mode chosen — create a tracked_characters row for every
      // character picked in the previous step.
      prefix: VIEW_PREFIX,
      async handle(interaction) {
        const [mode, messageId] = interaction.customId.slice(VIEW_PREFIX.length).split(':');

        const pending = pendingSelections.get(messageId);
        if (!pending) {
          await interaction.update({
            content: 'This selection expired — run `/track-character` again.',
            components: [],
          });
          return;
        }
        pendingSelections.delete(messageId);

        const rows = [];
        for (const { name, region } of pending.characters) {
          rows.push(
            await create({
              linkedAccountId: pending.linkedAccountId,
              characterName: name,
              region,
              guildId: interaction.guildId,
              viewMode: mode,
            }),
          );
        }

        const list = rows.map((r) => `**${r.character_name}** (${r.region})`).join(', ');

        await interaction.update({
          content: `Tracking ${list} in this server — **${mode}** view. New clears will post once \`/announce-channel\` is set.`,
          components: [],
        });
      },
    },
  ],
};
