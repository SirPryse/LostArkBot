import { getByDiscordUserId } from '../../db/linkedAccounts.js';
import { flagNeedsReauth } from '../../notify/reauthNotice.js';
import { decryptToken } from '../../crypto/tokenCipher.js';
import { TokenExpiredError, InsufficientScopeError } from '../../lostarkbible/errors.js';
import { fetchLogsSince } from '../../lostarkbible/weeklyLogs.js';
import { RAID_FAMILIES, getRaidFamilyForBoss } from '../../notify/raidFamilies.js';
import { lastWednesdayReset } from '../../notify/raidWeek.js';
import { formatStat } from '../../notify/clearMessage.js';
import { emojiTag } from '../../notify/format.js';
import { sleep } from '../../utils/sleep.js';

// Shared plumbing for /bonk and /bonk-hard — both look up a user's linked
// account, fetch every listed character's clears since this week's reset,
// and render one monospace progress table per character. They differ only
// in which characters they include and how they present zero-clear ones.

// Same pacing poller.js uses between characters — both commands fire one
// burst of requests per invocation, so a roster with many alts can
// otherwise trip lostark.bible's rate limit in a couple of seconds.
const PER_CHARACTER_DELAY_MS = 200;

// Discord embed limits: 25 fields, 6000 characters across the whole embed.
// Leave headroom for the title/footer and the overflow field itself.
const MAX_FIELDS = 25;
const FIELD_CHAR_BUDGET = 5500;

/** The target user's linked account if it's usable right now, otherwise
 * replies with the reason and returns null. */
export async function getUsableAccount(interaction, targetUser) {
  const account = await getByDiscordUserId(targetUser.id);
  if (!account) {
    await interaction.editReply(`${targetUser} hasn't linked a lostark.bible account yet.`);
    return null;
  }
  if (account.status !== 'active' || new Date(account.token_expires_at) <= new Date()) {
    await interaction.editReply(`${targetUser}'s lostark.bible link needs to be re-authorized.`);
    return null;
  }
  return account;
}

/**
 * This week's log entries for each character, in input order:
 * `[{ name, region, entries }]`. Characters whose logs can't be read
 * (missing scope) are skipped. Returns null — after replying and flagging
 * the account — if the token turns out to be expired mid-run.
 */
export async function fetchWeeklyEntries(interaction, account, targetUser, characters) {
  const accessToken = decryptToken(account.access_token);
  const boundaryMs = lastWednesdayReset().getTime();
  const results = [];
  for (const { character_name: name, region } of characters) {
    try {
      results.push({ name, region, entries: await fetchLogsSince(accessToken, name, region, boundaryMs) });
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        await flagNeedsReauth(interaction.client, account.id);
        await interaction.editReply(`${targetUser}'s lostark.bible link expired mid-check.`);
        return null;
      }
      if (err instanceof InsufficientScopeError) continue;
      throw err;
    } finally {
      await sleep(PER_CHARACTER_DELAY_MS);
    }
  }
  return results;
}

/** family key -> Set of gate indexes cleared, ignoring bosses outside the
 * tracked raid families. */
export function clearedGatesByFamily(entries) {
  const cleared = new Map();
  for (const entry of entries) {
    const match = getRaidFamilyForBoss(entry.boss, entry.difficulty);
    if (!match) continue;
    if (!cleared.has(match.family.key)) cleared.set(match.family.key, new Set());
    cleared.get(match.family.key).add(match.gateIndex);
  }
  return cleared;
}

/** One embed field per character: class icon + name (+ iLvl) as the
 * header, raid progress as a monospace table so the columns line up. Only
 * families with progress get a row. */
export function buildCharacterField(characterName, className, gearScore, cleared) {
  const gearScoreLabel = gearScore === null || gearScore === undefined ? 'N/A' : formatStat(gearScore);
  const header = `${emojiTag(className)} ${characterName} (iLvl: ${gearScoreLabel})`.trim();

  const rows = RAID_FAMILIES.filter((family) => cleared.has(family.key)).map((family) => ({
    label: family.label,
    progress: `${cleared.get(family.key).size}/${family.gates.length}`,
  }));
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const body = rows.map((r) => `${r.label.padEnd(labelWidth)}  ${r.progress}`).join('\n');

  return { name: header, value: `\`\`\`\n${body}\n\`\`\``, inline: false };
}

/** Keeps a list of fields inside Discord's embed limits (25 fields / 6000
 * characters). Fields past the limit are folded into one trailing "…and N
 * more" field listing their names, instead of the whole reply failing for
 * large rosters. `reservedFields` are always kept and placed last (e.g.
 * /bonk-hard's "No Clears This Week" list). */
export function fitFields(fields, reservedFields = []) {
  const fieldLength = (f) => f.name.length + f.value.length;
  let budget = FIELD_CHAR_BUDGET - reservedFields.reduce((sum, f) => sum + fieldLength(f), 0);
  const slots = MAX_FIELDS - reservedFields.length - 1; // keep one slot for the overflow field

  const kept = [];
  let i = 0;
  for (; i < fields.length && kept.length < slots; i++) {
    if (fieldLength(fields[i]) > budget) break;
    budget -= fieldLength(fields[i]);
    kept.push(fields[i]);
  }

  // Exactly one left over and it fits the reserved slot: show it rather
  // than an "and 1 more" field.
  if (i === fields.length - 1 && fieldLength(fields[i]) <= budget) kept.push(fields[i++]);

  const overflow = fields.slice(i);
  if (overflow.length > 0) {
    const names = overflow.map((f) => f.name).join(', ');
    kept.push({ name: `…and ${overflow.length} more`, value: names.slice(0, 1024), inline: false });
  }
  return [...kept, ...reservedFields];
}

/** "Wed, Nov 18" — the start of the raid week being shown. */
export function resetLabel() {
  return lastWednesdayReset().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
