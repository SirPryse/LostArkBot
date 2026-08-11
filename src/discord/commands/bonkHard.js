import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getByDiscordUserId, markNeedsReauth } from '../../db/linkedAccounts.js';
import { listDistinctByLinkedAccount } from '../../db/trackedCharacters.js';
import { decryptToken } from '../../crypto/tokenCipher.js';
import { TokenExpiredError, InsufficientScopeError } from '../../lostarkbible/errors.js';
import { fetchLogsSince } from '../../lostarkbible/weeklyLogs.js';
import { getRosters } from '../../lostarkbible/client.js';
import { RAID_FAMILIES, getRaidFamilyForBoss } from '../../notify/raidFamilies.js';
import { lastWednesdayReset } from '../../notify/raidWeek.js';
import { getClassEmoji } from '../../notify/classIcons.js';
import { formatStat } from '../../notify/clearMessage.js';
import { sleep } from '../../utils/sleep.js';

// Same pacing poller.js uses between characters — this command fires one
// burst of requests per invocation, so it's just as exposed to lostark.bible's
// rate limit as /bonk.
const PER_CHARACTER_DELAY_MS = 200;

/** `<:name:id>` — the inline-text form of a custom emoji, distinct from the
 * `{id, name}` object `.setEmoji()` wants on a component. */
function emojiTag(classNameOrIconKey) {
  const emoji = getClassEmoji(classNameOrIconKey);
  return emoji ? `<:${emoji.name}:${emoji.id}>` : '';
}

/** One embed field per character with progress: class icon + name as the
 * header, raid progress as a monospace table in the value so the columns
 * line up. Only families with actual progress are listed — no 0/N rows.
 * Characters with zero progress anywhere don't get a field from this at
 * all; see buildNoClearsField() for how they're shown instead. */
function buildCharacterField(characterName, className, gearScore, clearedGatesByFamily) {
  const gearScoreLabel = gearScore === null ? 'N/A' : formatStat(gearScore);
  const header = `${emojiTag(className)} ${characterName} (iLvl: ${gearScoreLabel})`.trim();

  const rows = RAID_FAMILIES.filter((family) => clearedGatesByFamily.has(family.key)).map((family) => ({
    label: family.label,
    progress: `${clearedGatesByFamily.get(family.key).size}/${family.gates.length}`,
  }));

  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const body = rows.map((r) => `${r.label.padEnd(labelWidth)}  ${r.progress}`).join('\n');

  return { name: header, value: `\`\`\`\n${body}\n\`\`\``, inline: false };
}

/** Characters sitting at 0 clears in every raid family this week get
 * grouped into one compact list instead of an all-zero grid each — this is
 * the "hard mode" difference from /bonk: they're still shown by name, just
 * without the noise of a full 0/N table. */
function buildNoClearsField(results) {
  const names = results.map((r) => `${emojiTag(r.class)} ${r.name}`.trim()).join(', ');
  return { name: `No Clears This Week (${results.length})`, value: names, inline: false };
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

    // Character-with-zero-clears-ever fallback source: getRosters() reflects
    // the live in-game roster (class/ilvl), independent of raid-clear
    // history, unlike getCharacterLogs() which has nothing for a character
    // that's never actually finished a raid. Fetched once for the whole
    // account up front rather than per-character — cheaper and it's the
    // only way to get real data for those characters anyway.
    const rosterLookup = new Map(); // character name -> { class, ilvl }
    try {
      const rosterData = await getRosters(accessToken);
      for (const group of rosterData?.rosters ?? []) {
        for (const c of group.characters ?? []) {
          rosterLookup.set(c.name, { class: c.class, ilvl: c.ilvl });
        }
      }
    } catch {
      // missing `rosters` scope or a transient error — fall back to N/A
      // below for anyone logs can't cover, same as before this existed.
    }

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

      const clearedGatesByFamily = new Map(); // family key -> Set of gate indexes cleared
      for (const entry of entries) {
        const match = getRaidFamilyForBoss(entry.boss, entry.difficulty);
        if (!match) continue; // not part of a known raid family — ignore for counting
        const { family, gateIndex } = match;
        if (!clearedGatesByFamily.has(family.key)) clearedGatesByFamily.set(family.key, new Set());
        clearedGatesByFamily.get(family.key).add(gateIndex);
      }

      // Unlike /bonk, a character with nothing this week is still shown —
      // but entries[0] won't exist to source iLvl/class from. A character
      // that's never actually finished a raid has no log data at all
      // (empty, not just stale), so fall back to the live roster snapshot
      // instead of digging through logs for something that isn't there.
      let gearScore = entries[0]?.gearScore ?? null;
      let className = entries[0]?.class ?? null;
      if (gearScore === null) {
        const rosterEntry = rosterLookup.get(name);
        if (rosterEntry) {
          gearScore = rosterEntry.ilvl;
          className = rosterEntry.class;
        }
      }

      results.push({ name, gearScore, class: className, clearedGatesByFamily });
    }

    if (results.length === 0) {
      await interaction.editReply(`${targetUser} isn't tracking any usable characters.`);
      return;
    }

    // Unknown iLvl (never logged a clear) sorts to the bottom.
    results.sort((a, b) => (b.gearScore ?? -Infinity) - (a.gearScore ?? -Infinity));

    const withProgress = results.filter((r) => r.clearedGatesByFamily.size > 0);
    const withoutProgress = results.filter((r) => r.clearedGatesByFamily.size === 0);

    const fields = withProgress.map((r) =>
      buildCharacterField(r.name, r.class, r.gearScore, r.clearedGatesByFamily),
    );
    if (withoutProgress.length > 0) {
      fields.push(buildNoClearsField(withoutProgress));
    }

    const resetLabel = lastWednesdayReset().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    const embed = new EmbedBuilder()
      .setTitle(`${targetUser.username}'s Roster Status (full)`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(fields)
      .setColor(0x5865f2)
      .setFooter({ text: `Since ${resetLabel} reset` });

    await interaction.editReply({ embeds: [embed] });
  },
};
