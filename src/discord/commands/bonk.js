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

// Same pacing poller.js uses between characters — /bonk fires one burst of
// requests per invocation (unlike the poller's already-spread-out 10-minute
// tick), so a roster with many alts can otherwise trip lostark.bible's
// rate limit in a couple seconds flat.
const PER_CHARACTER_DELAY_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `<:name:id>` — the inline-text form of a custom emoji, distinct from the
 * `{id, name}` object `.setEmoji()` wants on a component. */
function emojiTag(classNameOrIconKey) {
  const emoji = getClassEmoji(classNameOrIconKey);
  return emoji ? `<:${emoji.name}:${emoji.id}>` : '';
}

/** One embed field per character: class icon + name as the header, raid
 * progress as a monospace table in the value so the columns line up. */
function buildCharacterField(characterName, className, gearScore, clearedGatesByFamily) {
  const header = `${emojiTag(className)} ${characterName} (iLvl: ${formatStat(gearScore)})`.trim();

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

    // Gathered first, then sorted by iLvl before building fields — gearScore
    // isn't known until the logs come back, so it can't sort while fetching.
    const results = [];
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
        const match = getRaidFamilyForBoss(entry.boss);
        if (!match) continue; // not part of a known raid family — ignore for counting
        const { family, gateIndex } = match;
        if (!clearedGatesByFamily.has(family.key)) clearedGatesByFamily.set(family.key, new Set());
        clearedGatesByFamily.get(family.key).add(gateIndex);
      }

      if (clearedGatesByFamily.size === 0) continue; // clears happened, but none matched a known raid family

      results.push({ name, gearScore: entries[0].gearScore, class: entries[0].class, clearedGatesByFamily });
    }

    if (results.length === 0) {
      await interaction.editReply(`${targetUser} hasn't completed any raids since this week's reset.`);
      return;
    }

    results.sort((a, b) => b.gearScore - a.gearScore); // highest iLvl first

    const fields = results.map((r) =>
      buildCharacterField(r.name, r.class, r.gearScore, r.clearedGatesByFamily),
    );

    const resetLabel = lastWednesdayReset().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    const embed = new EmbedBuilder()
      .setTitle(`${targetUser.username}'s Roster Status`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(fields)
      .setColor(0x5865f2)
      .setFooter({ text: `Since ${resetLabel} reset` });

    await interaction.editReply({ embeds: [embed] });
  },
};
