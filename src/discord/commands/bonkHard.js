import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { listDistinctByLinkedAccount } from '../../db/trackedCharacters.js';
import { decryptToken } from '../../crypto/tokenCipher.js';
import { getRosters } from '../../lostarkbible/client.js';
import { emojiTag } from '../../notify/format.js';
import {
  getUsableAccount,
  fetchWeeklyEntries,
  clearedGatesByFamily,
  buildCharacterField,
  fitFields,
  resetLabel,
} from './rosterProgress.js';

/** Characters sitting at 0 clears in every raid family this week get
 * grouped into one compact list instead of an all-zero grid each — the
 * "hard mode" difference from /bonk: they're still shown by name, just
 * without the noise of a full 0/N table. */
function buildNoClearsField(results) {
  const names = results.map((r) => `${emojiTag(r.class)} ${r.name}`.trim()).join(', ');
  return { name: `No Clears This Week (${results.length})`, value: names.slice(0, 1024), inline: false };
}

/** name -> { class, ilvl } from the live roster — the fallback for
 * characters with no log data at all this week (a character that's never
 * finished a raid has nothing in its logs to read iLvl/class from). Empty
 * on a missing `rosters` scope or a transient error. */
async function fetchRosterLookup(account) {
  const lookup = new Map();
  try {
    const rosterData = await getRosters(decryptToken(account.access_token));
    for (const group of rosterData?.rosters ?? []) {
      for (const c of group.characters ?? []) lookup.set(c.name, { class: c.class, ilvl: c.ilvl });
    }
  } catch {
    // fall back to N/A for anyone logs can't cover
  }
  return lookup;
}

export const bonkHardCommand = {
  data: new SlashCommandBuilder()
    .setName('bonk-hard')
    .setDescription("Like /bonk, but also shows characters sitting at 0 clears this week")
    .addUserOption((option) =>
      option.setName('user').setDescription('Whose roster to check (defaults to you)'),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const account = await getUsableAccount(interaction, targetUser);
    if (!account) return;

    const characters = await listDistinctByLinkedAccount(account.id);
    if (characters.length === 0) {
      await interaction.editReply(`${targetUser} isn't tracking any characters.`);
      return;
    }

    const rosterLookup = await fetchRosterLookup(account);
    const fetched = await fetchWeeklyEntries(interaction, account, targetUser, characters);
    if (!fetched) return;

    const results = fetched.map(({ name, entries }) => {
      // Unlike /bonk, a character with nothing this week is still shown,
      // so iLvl/class fall back to the live roster when logs are empty.
      const fromRoster = rosterLookup.get(name);
      return {
        name,
        gearScore: entries[0]?.gearScore ?? fromRoster?.ilvl ?? null,
        class: entries[0]?.class ?? fromRoster?.class ?? null,
        cleared: clearedGatesByFamily(entries),
      };
    });

    if (results.length === 0) {
      await interaction.editReply(`${targetUser} isn't tracking any usable characters.`);
      return;
    }

    // Unknown iLvl (never logged a clear) sorts to the bottom.
    results.sort((a, b) => (b.gearScore ?? -Infinity) - (a.gearScore ?? -Infinity));

    const withProgress = results.filter((r) => r.cleared.size > 0);
    const withoutProgress = results.filter((r) => r.cleared.size === 0);
    const fields = withProgress.map((r) => buildCharacterField(r.name, r.class, r.gearScore, r.cleared));
    const reserved = withoutProgress.length > 0 ? [buildNoClearsField(withoutProgress)] : [];

    const embed = new EmbedBuilder()
      .setTitle(`${targetUser.username}'s Roster Status (full)`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(fitFields(fields, reserved))
      .setColor(0x5865f2)
      .setFooter({ text: `Since ${resetLabel()} reset` });

    await interaction.editReply({ embeds: [embed] });
  },
};
