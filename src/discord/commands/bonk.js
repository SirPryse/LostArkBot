import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getByDiscordUserId, markNeedsReauth } from '../../db/linkedAccounts.js';
import { listDistinctByLinkedAccount } from '../../db/trackedCharacters.js';
import { decryptToken } from '../../crypto/tokenCipher.js';
import { TokenExpiredError, InsufficientScopeError } from '../../lostarkbible/errors.js';
import { fetchLogsSince } from '../../lostarkbible/weeklyLogs.js';
import { RAID_FAMILIES, getRaidFamilyForBoss } from '../../notify/raidFamilies.js';
import { lastWednesdayReset } from '../../notify/raidWeek.js';
import { getClassEmoji } from '../../notify/classIcons.js';
import { formatStat } from '../../notify/clearMessage.js';
import { classifyClearGold, sumTopFamilies } from '../../notify/goldEstimate.js';
import { getGoldEarnerKeySet } from '../../db/goldEarners.js';
import { sleep } from '../../utils/sleep.js';

const GOLD_EARNER_BADGE = '🪙';

/** Same estimate/rules as clearHistory.js's getEstimatedGold, applied to a
 * live batch of this-week's entries instead of stored clear_history rows —
 * this command already fetches "since reset" entries fresh every run, so
 * there's no need to round-trip through the DB for a single week's total.
 * Returns 0 for a non-earner (their Extreme clears still count — see
 * classifyClearGold's alwaysCounts). */
function weeklyGoldForCharacter(entries, isGoldEarner) {
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

  const cappedTotal = isGoldEarner ? sumTopFamilies(familyTotals.values()) : 0;
  return alwaysCounted + cappedTotal;
}

// Same pacing poller.js uses between characters — /bonk fires one burst of
// requests per invocation (unlike the poller's already-spread-out 10-minute
// tick), so a roster with many alts can otherwise trip lostark.bible's
// rate limit in a couple seconds flat.
const PER_CHARACTER_DELAY_MS = 200;

/** `<:name:id>` — the inline-text form of a custom emoji, distinct from the
 * `{id, name}` object `.setEmoji()` wants on a component. */
function emojiTag(classNameOrIconKey) {
  const emoji = getClassEmoji(classNameOrIconKey);
  return emoji ? `<:${emoji.name}:${emoji.id}>` : '';
}

/** One embed field per character: class icon + name as the header, raid
 * progress as a monospace table in the value so the columns line up.
 * `isGoldEarner` adds a 🪙 badge to the header — purely an identity marker
 * (this character's clears count toward the weekly gold total below), not
 * a number itself; see weeklyGoldForCharacter/the footer for the actual
 * estimate. */
function buildCharacterField(characterName, className, gearScore, clearedGatesByFamily, isGoldEarner) {
  const badge = isGoldEarner ? ` ${GOLD_EARNER_BADGE}` : '';
  const header = `${emojiTag(className)} ${characterName}${badge} (iLvl: ${formatStat(gearScore)})`.trim();

  const rows = RAID_FAMILIES.filter((family) => clearedGatesByFamily.has(family.key)).map((family) => ({
    label: family.label,
    progress: `${clearedGatesByFamily.get(family.key).size}/${family.gates.length}`,
  }));

  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const body = rows.map((r) => `${r.label.padEnd(labelWidth)}  ${r.progress}`).join('\n');

  return { name: header, value: `\`\`\`\n${body}\n\`\`\``, inline: false };
}

export const bonkCommand = {
  data: new SlashCommandBuilder()
    .setName('bonk')
    .setDescription("Show a user's raid clears since this week's reset, grouped by raid")
    .addUserOption((option) =>
      option.setName('user').setDescription('Whose roster to check (defaults to you)'),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const account = await getByDiscordUserId(targetUser.id);

    if (!account) {
      await interaction.editReply(`${targetUser} hasn't linked a lostark.bible account yet.`);
      return;
    }
    if (account.status !== 'active' || new Date(account.token_expires_at) <= new Date()) {
      await interaction.editReply(`${targetUser}'s lostark.bible link needs to be re-authorized.`);
      return;
    }

    const characters = await listDistinctByLinkedAccount(account.id);
    if (characters.length === 0) {
      await interaction.editReply(`${targetUser} isn't tracking any characters.`);
      return;
    }

    const accessToken = decryptToken(account.access_token);
    const boundaryMs = lastWednesdayReset().getTime();
    const earnerKeySet = await getGoldEarnerKeySet(account.id);

    // Gathered first, then sorted by iLvl before building fields — gearScore
    // isn't known until the logs come back, so it can't sort while fetching.
    const results = [];
    let weeklyGoldTotal = 0;
    for (const { character_name: name, region } of characters) {
      let entries;
      try {
        entries = await fetchLogsSince(accessToken, name, region, boundaryMs);
      } catch (err) {
        if (err instanceof TokenExpiredError) {
          await markNeedsReauth(account.id);
          await interaction.editReply(`${targetUser}'s lostark.bible link expired mid-check.`);
          return;
        }
        if (err instanceof InsufficientScopeError) continue; // missing scope — skip this character silently
        throw err;
      } finally {
        await sleep(PER_CHARACTER_DELAY_MS);
      }

      if (entries.length === 0) continue; // no raids this week — character is left off the list entirely

      const clearedGatesByFamily = new Map(); // family key -> Set of gate indexes cleared
      for (const entry of entries) {
        const match = getRaidFamilyForBoss(entry.boss, entry.difficulty);
        if (!match) continue; // not part of a known raid family — ignore for counting
        const { family, gateIndex } = match;
        if (!clearedGatesByFamily.has(family.key)) clearedGatesByFamily.set(family.key, new Set());
        clearedGatesByFamily.get(family.key).add(gateIndex);
      }

      if (clearedGatesByFamily.size === 0) continue; // clears happened, but none matched a known raid family

      const isGoldEarner = earnerKeySet.has(`${name}|${region}`);
      weeklyGoldTotal += weeklyGoldForCharacter(entries, isGoldEarner);

      results.push({ name, gearScore: entries[0].gearScore, class: entries[0].class, clearedGatesByFamily, isGoldEarner });
    }

    if (results.length === 0) {
      await interaction.editReply(`${targetUser} hasn't completed any raids since this week's reset.`);
      return;
    }

    results.sort((a, b) => b.gearScore - a.gearScore); // highest iLvl first

    const fields = results.map((r) =>
      buildCharacterField(r.name, r.class, r.gearScore, r.clearedGatesByFamily, r.isGoldEarner),
    );

    const resetLabel = lastWednesdayReset().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    // Consolidated across every character shown above — same estimate rules
    // as /my-stats (gold-earner-only + weekly 3-family cap, Extreme always
    // counts), just for this one week instead of a lifetime total.
    const goldLabel = `🪙 Est. weekly gold: ${weeklyGoldTotal.toLocaleString('en-US')}`;

    const embed = new EmbedBuilder()
      .setTitle(`${targetUser.username}'s Roster Status`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(fields)
      .setColor(0x5865f2)
      .setFooter({ text: `Since ${resetLabel} reset • ${goldLabel}` });

    await interaction.editReply({ embeds: [embed] });
  },
};
