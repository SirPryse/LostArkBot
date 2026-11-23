import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { listDistinctByLinkedAccount } from '../../db/trackedCharacters.js';
import { getGoldEarnerKeySet } from '../../db/goldEarners.js';
import { classifyClearGold, sumTopFamilies } from '../../notify/goldEstimate.js';
import {
  getUsableAccount,
  fetchWeeklyEntries,
  clearedGatesByFamily,
  buildCharacterField,
  fitFields,
  resetLabel,
} from './rosterProgress.js';

/** Same estimate/rules as clearHistory.js's getEstimatedGold, applied to a
 * live batch of this-week's entries instead of stored clear_history rows —
 * this command already fetches "since reset" entries fresh every run, so
 * there's no need to round-trip through the DB for a single week's total.
 * /bonk only ever fetches Gold Earner characters (see execute()), so every
 * entry here is earner-eligible; Extreme clears count on their own
 * (classifyClearGold's alwaysCounts). */
function weeklyGoldForCharacter(entries) {
  const familyTotals = new Map();
  let alwaysCounted = 0;

  for (const entry of entries) {
    const classified = classifyClearGold(entry);
    if (!classified) continue;
    if (classified.alwaysCounts) {
      alwaysCounted += classified.gold;
    } else {
      familyTotals.set(classified.familyKey, (familyTotals.get(classified.familyKey) ?? 0) + classified.gold);
    }
  }

  return alwaysCounted + sumTopFamilies(familyTotals.values());
}

export const bonkCommand = {
  data: new SlashCommandBuilder()
    .setName('bonk')
    .setDescription("Show a user's Gold Earner clears since this week's reset, grouped by raid")
    .addUserOption((option) =>
      option.setName('user').setDescription('Whose roster to check (defaults to you)'),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const account = await getUsableAccount(interaction, targetUser);
    if (!account) return;

    // Scoped to Gold Earners only (capped at 6), not every character the
    // account tracks — bounds the per-invocation API burst regardless of
    // how many alts someone has (a 20-alt account measured ~12s of pure
    // request time unfiltered). /bonk-hard is the check-everyone view.
    const earnerKeySet = await getGoldEarnerKeySet(account.id);
    if (earnerKeySet.size === 0) {
      await interaction.editReply(`${targetUser} doesn't have any Gold Earners set — run \`/gold-earners\` first.`);
      return;
    }

    const allCharacters = await listDistinctByLinkedAccount(account.id);
    const characters = allCharacters.filter((c) => earnerKeySet.has(`${c.character_name}|${c.region}`));
    if (characters.length === 0) {
      await interaction.editReply(`${targetUser} isn't tracking any characters.`);
      return;
    }

    const fetched = await fetchWeeklyEntries(interaction, account, targetUser, characters);
    if (!fetched) return;

    const results = [];
    let weeklyGoldTotal = 0;
    for (const { name, entries } of fetched) {
      if (entries.length === 0) continue; // no raids this week — left off the list
      const cleared = clearedGatesByFamily(entries);
      if (cleared.size === 0) continue; // clears happened, but none in a tracked raid
      weeklyGoldTotal += weeklyGoldForCharacter(entries);
      results.push({ name, gearScore: entries[0].gearScore, class: entries[0].class, cleared });
    }

    if (results.length === 0) {
      await interaction.editReply(`${targetUser} hasn't completed any raids since this week's reset.`);
      return;
    }

    results.sort((a, b) => b.gearScore - a.gearScore); // highest iLvl first
    const fields = results.map((r) => buildCharacterField(r.name, r.class, r.gearScore, r.cleared));

    // Same estimate rules as /my-stats (gold-earner-only + weekly 3-family
    // cap, Extreme always counts), just for this one week.
    const goldLabel = `🪙 Est. weekly gold: ${weeklyGoldTotal.toLocaleString('en-US')}`;

    const embed = new EmbedBuilder()
      .setTitle(`${targetUser.username}'s Roster Status`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(fitFields(fields))
      .setColor(0x5865f2)
      .setFooter({ text: `Since ${resetLabel()} reset • ${goldLabel}` });

    await interaction.editReply({ embeds: [embed] });
  },
};
