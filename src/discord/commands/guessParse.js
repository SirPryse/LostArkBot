import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  escapeMarkdown,
} from 'discord.js';
import { listCompetitiveWithAccountByGuild } from '../../db/trackedCharacters.js';
import { addPoints } from '../../db/guessGame.js';
import { decryptToken } from '../../crypto/tokenCipher.js';
import { getCharacterLogs } from '../../lostarkbible/client.js';
import { getRole, formatStat, FALLBACK_COLOR } from '../../notify/clearMessage.js';
import { getMinDps } from '../../notify/minDps.js';
import { getFriendlyBossName } from '../../notify/raidFamilies.js';
import { tierForFraction } from '../../notify/percentileTiers.js';

const PICK_PREFIX = 'guess-parse-pick:';
const MAX_ANSWER_ATTEMPTS = 5; // some tracked characters may have no logs yet
const MIN_LOG_PAGE = 1;
const MAX_LOG_PAGE = 10; // pull from a random page, not always the most recent clear
const BUFF_LABELS = ['AP Buff', 'Brand', 'Identity', 'T'];

// Auroral Teahouse's own custom emoji — usable in message text regardless
// of which guild the round is running in, since Discord resolves <name:id>
// tags purely by ID (only *reactions* require the bot to actually have
// access to the emoji's home server; plain text/embed rendering doesn't).
const WIN_EMOJI = '<:LETHIMCOOK:1515851556266967241>';
const SHAME_EMOJI = '<a:L_:1516097479555420202>';

// A round stays open until 3 different people have guessed correctly.
// Being faster/more confident is rewarded directly: the 1st correct
// guesser gets 5x the difficulty's base points, the 2nd gets 3x, the 3rd
// gets 1x. Once the 3rd correct guess lands, the answer and every hidden
// field get revealed and the round closes.
const RANK_MULTIPLIERS = [5, 3, 1];
const MAX_CORRECT_GUESSERS = RANK_MULTIPLIERS.length;

// Fallback so a round can't sit open forever if nobody (or fewer than 3
// people) get it — fixed at 3 minutes, not user-configurable. Whichever
// happens first (3 correct guesses, or this timer) reveals the round.
const ROUND_DURATION_MS = 3 * 60 * 1000;

// Difficulty controls how many fields below get redacted (in addition to the
// name, which is always hidden) and the base points a correct guess is
// worth before the rank multiplier above is applied — more hidden, harder
// to guess, worth more. The pool now includes both the identifying metadata
// AND the performance stats, so at higher difficulty a round can genuinely
// hide e.g. Buff Uptimes or Percentile, not just secondary details like
// Combat Power.
const DIFFICULTY = {
  easy: { label: 'Easy', hideCount: 1, basePoints: 1 },
  medium: { label: 'Medium', hideCount: 2, basePoints: 2 },
  hard: { label: 'Hard', hideCount: 3, basePoints: 3 },
};

// Identifying/metadata fields — rendered in the embed description.
const IDENTIFYING_FIELDS = [
  { key: 'difficulty', label: 'Difficulty', scope: 'description', getValue: (e) => e.difficulty },
  { key: 'class', label: 'Class', scope: 'description', getValue: (e) => `${e.class} (${e.spec})` },
  { key: 'gearScore', label: 'Gear Score', scope: 'description', getValue: (e) => formatStat(e.gearScore) },
  { key: 'combatPower', label: 'Combat Power', scope: 'description', getValue: (e) => formatStat(e.combatPower) },
  { key: 'duration', label: 'Duration', scope: 'description', getValue: (e) => formatDuration(e.duration) },
];

// Performance-stat fields, role-specific — rendered as embed fields. `field`
// groups cells into the same embed field (joined with " | "); `granular`
// cells get a "**Label**: value" prefix and can be individually redacted
// within a shared field, while non-granular ("solo") cells are the entire
// field's content and just become "🔒 Hidden" outright when redacted.
const SUPPORT_STAT_FIELDS = [
  { key: 'rdps', label: 'rDPS', field: 'Contribution', granular: true, getValue: (e) => formatStat(e.rdps) },
  { key: 'rContribution', label: 'rDPS%', field: 'Contribution', granular: true, getValue: (e) => formatPercent(e.rContribution) },
  { key: 'uptime', label: 'Uptime', field: 'Percentile', granular: true, getValue: (e) => formatPercentile(e.percentile) },
  { key: 'contributionPercentile', label: 'Contribution', field: 'Percentile', granular: true, getValue: (e) => formatPercentile(e.contributionPercentile) },
  {
    key: 'buffUptimes',
    field: 'Buff Uptimes',
    granular: false,
    getValue: (e) => (e.buffs ?? [])
      .map((v, i) => `**${BUFF_LABELS[i] ?? `Buff ${i + 1}`}**: ${formatPercent(v)}`)
      .join('  |  '),
  },
];

const DPS_STAT_FIELDS = [
  { key: 'dps', label: 'DPS', field: 'Damage', granular: true, getValue: (e) => formatStat(e.dps) },
  { key: 'udps', label: 'UDPS', field: 'Damage', granular: true, getValue: (e) => formatStat(e.udps) },
  {
    key: 'minDps',
    label: 'Min. DPS',
    field: 'Damage',
    granular: true,
    // If `dps` itself is hidden, drop the ✅/⚠️ badge too — it would
    // otherwise leak whether the hidden DPS met the threshold.
    getValue: (e, hiddenKeys) => {
      const minDps = getMinDps(e.boss, e.difficulty);
      if (minDps === null) return null;
      if (hiddenKeys?.has('dps')) return `${formatStat(minDps)} (target)`;
      return `${formatStat(minDps)} ${e.dps >= minDps ? '✅' : '⚠️'}`;
    },
  },
  { key: 'percentile', field: 'Percentile', granular: false, getValue: (e) => formatPercentile(e.percentile) },
];

/** Builds the pool of hideable "cells" for this specific entry — identifying
 * fields plus whichever role's stat fields apply, skipping any stat cell
 * that doesn't apply to this particular entry (e.g. no Min. DPS defined for
 * this boss/difficulty). */
function buildHideableCells(entry, role) {
  const statFields = role === 'support' ? SUPPORT_STAT_FIELDS : role === 'dps' ? DPS_STAT_FIELDS : [];
  const eligibleStats = statFields.filter((f) => f.getValue(entry, new Set()) !== null);
  return [...IDENTIFYING_FIELDS, ...eligibleStats.map((f) => ({ ...f, scope: 'field' }))];
}

// Some fields would otherwise leak each other — UDPS (un-buffed DPS) sits so
// close to DPS numerically that showing one basically reveals the other.
// Hiding a key here forces its linked keys to hide too, on top of whatever
// the difficulty's random pick already chose (doesn't count against the
// difficulty's hideCount budget, it's just closing a leak).
const LINKED_HIDES = {
  dps: ['udps'],
};

function applyLinkedHides(hiddenKeys, cells) {
  const cellKeys = new Set(cells.map((c) => c.key));
  for (const key of [...hiddenKeys]) {
    for (const linked of LINKED_HIDES[key] ?? []) {
      if (cellKeys.has(linked)) hiddenKeys.add(linked);
    }
  }
  return hiddenKeys;
}

// Class is always redacted regardless of difficulty — a lot of characters
// are recognizable by their main's class alone, so leaving it visible would
// make every round too easy. It doesn't count against the difficulty's
// hideCount budget; that budget is spent on top of this.
const ALWAYS_HIDDEN_KEYS = new Set(['class']);

/** Difficulty's hideCount random picks, drawn only from the pool minus
 * whatever's always-hidden, then unioned with the always-hidden set and run
 * through the linked-hide cascade. */
function pickHiddenKeys(cells, hideCount) {
  const pickPool = cells.filter((c) => !ALWAYS_HIDDEN_KEYS.has(c.key));
  const randomPicks = shuffle(pickPool.map((c) => c.key)).slice(0, Math.min(hideCount, pickPool.length));
  return applyLinkedHides(new Set([...ALWAYS_HIDDEN_KEYS, ...randomPicks]), cells);
}

// round id (the slash command interaction's own id — known immediately, no
// need to send a message first) -> round state. Single bot process, so
// in-memory is fine — same pattern as trackCharacter.js's pendingSelections.
const activeRounds = new Map();

function formatPercent(fraction) {
  if (fraction === null || fraction === undefined) return 'N/A';
  return `${(fraction * 100).toFixed(2)}%`;
}
function formatPercentile(fraction) {
  if (fraction === null || fraction === undefined) return 'N/A';
  const topPercent = (100 - fraction * 100).toFixed(2);
  return `${tierForFraction(fraction).emoji} Top ${topPercent}%`;
}
function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

// Gear Score itself is always shown as its real, exact value when it isn't
// the field a round chose to redact — but that exact number is still a
// giveaway if the 3 choices span wildly different iLvls (regulars tend to
// know teammates' precise Gear Score). So instead the decoys are picked to
// share the answer's bucket where possible, not the displayed value. Below
// 1730 collapses into one open-ended low bucket, 1770+ into one open-ended
// high bucket, with two 20-point bands in between.
function gearScoreBucket(gearScore) {
  if (gearScore < 1730) return '< 1730';
  if (gearScore < 1750) return '1730-1750';
  if (gearScore < 1770) return '1750-1770';
  return '1770+';
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Embed fields that should render inline (side by side) when present —
// matches the original DPS layout.
const INLINE_FIELDS = new Set(['Percentile']);

/** Same stat breakdown a clear announcement would show — name always
 * hidden, plus whichever of `hiddenKeys` (drawn from `cells`) get replaced
 * with a lock icon instead of their real value. */
function buildRedactedEmbed(entry, difficultyKey, hiddenKeys, cells) {
  const bossLabel = getFriendlyBossName(entry.boss);
  const config = DIFFICULTY[difficultyKey];

  const descriptionLines = cells
    .filter((c) => c.scope === 'description')
    .map(({ key, label, getValue }) =>
      hiddenKeys.has(key) ? `**${label}:** 🔒 Hidden` : `**${label}:** ${getValue(entry, hiddenKeys)}`,
    );

  const fieldCells = cells.filter((c) => c.scope === 'field');
  const groups = new Map();
  for (const cell of fieldCells) {
    if (!groups.has(cell.field)) groups.set(cell.field, []);
    groups.get(cell.field).push(cell);
  }
  const fields = [...groups.entries()].map(([name, groupCells]) => {
    const value = groupCells
      .map((cell) => {
        if (hiddenKeys.has(cell.key)) return cell.granular ? `**${cell.label}**: 🔒 Hidden` : '🔒 Hidden';
        const rendered = cell.getValue(entry, hiddenKeys);
        return cell.granular ? `**${cell.label}**: ${rendered}` : rendered;
      })
      .join('  |  ');
    return INLINE_FIELDS.has(name) ? { name, value, inline: true } : { name, value };
  });

  return new EmbedBuilder()
    .setTitle(`Whose parse is this? — ${bossLabel}`)
    .setDescription(descriptionLines.join('\n'))
    .addFields(fields)
    .setColor(FALLBACK_COLOR)
    .setFooter({
      text: `${config.label} (${config.basePoints} base pt) — 1st guess 5x, 2nd guess 3x, 3rd guess 1x • reveals in 3 min if unsolved`,
    });
}

/** The running tally of who's guessed correctly so far this round, in the
 * order they guessed — shown as its own field once at least one person has
 * gotten it right, e.g. "LETHIMCOOK X guessed correctly (+15 pts)!". */
function buildGuessesField(correctGuessers) {
  if (correctGuessers.length === 0) return null;
  const lines = correctGuessers.map(
    (g) => `${WIN_EMOJI} ${g.username} guessed correctly (+${g.points} pt${g.points === 1 ? '' : 's'})!`,
  );
  return { name: 'Correct Guesses', value: lines.join('\n') };
}

/** Public shame list — everyone who's burned their one guess on a wrong
 * answer, in the order they whiffed it. */
function buildWrongGuessesField(wrongGuessers) {
  if (wrongGuessers.length === 0) return null;
  const lines = wrongGuessers.map((g) => `${SHAME_EMOJI} ${g.username} guessed wrong!`);
  return { name: 'Wall of Shame', value: lines.join('\n') };
}

/** Rebuilds the round's embed from scratch every time someone guesses (or
 * the round times out) — still redacted per the round's original
 * hiddenKeys until `revealed` is true, at which point every hidden field
 * (and the answer) is shown. `reason` only affects the reveal footer text:
 * 'guesses' (3rd correct guess landed) vs 'timeout' (3-minute cap hit). */
function buildRoundEmbed(round, revealed, reason = 'guesses') {
  const hiddenKeys = revealed ? new Set() : round.hiddenKeys;
  const embed = buildRedactedEmbed(round.entry, round.difficultyKey, hiddenKeys, round.cells);
  const guessesField = buildGuessesField(round.correctGuessers);
  if (guessesField) embed.addFields(guessesField);
  const shameField = buildWrongGuessesField(round.wrongGuessers);
  if (shameField) embed.addFields(shameField);
  if (revealed) {
    const text = reason === 'timeout'
      ? `⏰ Time's up! It was ${round.correctName}!`
      : `Round over — it was ${round.correctName}!`;
    embed.setFooter({ text });
  }
  return embed;
}

function buildButtons(roundId, choices, disabled = false) {
  return new ActionRowBuilder().addComponents(
    choices.map((name, i) =>
      new ButtonBuilder()
        .setCustomId(`${PICK_PREFIX}${roundId}:${i}`)
        .setLabel(name)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
  );
}

async function pickAnswer(candidates) {
  const shuffled = shuffle(candidates);
  for (const candidate of shuffled.slice(0, MAX_ANSWER_ATTEMPTS)) {
    try {
      const accessToken = decryptToken(candidate.access_token);
      // Random page so the round isn't always this character's most recent
      // clear — makes the round less guessable from "what did X do today".
      const page = randomInt(MIN_LOG_PAGE, MAX_LOG_PAGE);
      let entries = await getCharacterLogs(accessToken, candidate.character_name, candidate.region, { page });
      if (!entries || entries.length === 0) {
        // That page might just be past the end of this character's history
        // — fall back to page 1 (guaranteed to have data if they have any
        // logs at all) instead of burning an attempt on a real candidate.
        entries = await getCharacterLogs(accessToken, candidate.character_name, candidate.region, { page: 1 });
      }
      if (entries && entries.length > 0) {
        return { candidate, entry: entries[0] };
      }
    } catch {
      // token expired, missing scope, etc. — just try the next candidate
    }
  }
  return null;
}

async function fetchGearScore(candidate) {
  try {
    const accessToken = decryptToken(candidate.access_token);
    const entries = await getCharacterLogs(accessToken, candidate.character_name, candidate.region, { page: 1 });
    return entries && entries.length > 0 ? entries[0].gearScore : null;
  } catch {
    return null;
  }
}

/** Picks 2 decoys, preferring characters in the same Gear Score bucket as
 * the answer — since the real Gear Score value stays visible whenever it
 * isn't the field a round redacted, choices spanning wildly different
 * iLvls would make the guess trivial for anyone who knows the roster.
 * Falls back to any other candidate if the bucket doesn't have enough. */
async function pickDecoys(decoyPool, answerGearScore) {
  const answerBucket = gearScoreBucket(answerGearScore);
  const scored = await Promise.all(
    decoyPool.map(async (c) => ({ name: c.character_name, gearScore: await fetchGearScore(c) })),
  );
  const sameBucket = shuffle(scored.filter((c) => c.gearScore !== null && gearScoreBucket(c.gearScore) === answerBucket));
  const rest = shuffle(scored.filter((c) => c.gearScore === null || gearScoreBucket(c.gearScore) !== answerBucket));
  return [...sameBucket, ...rest].slice(0, 2).map((c) => c.name);
}

export const guessParseCommand = {
  data: new SlashCommandBuilder()
    .setName('guess-parse')
    .setDescription('Guess whose recent raid clear this is — pick from 3 tracked characters')
    .addStringOption((option) =>
      option
        .setName('difficulty')
        .setDescription('How much info to hide — harder means fewer clues and higher base points')
        .setRequired(true)
        .addChoices(
          { name: 'Easy (hide 1, base 1 pt)', value: 'easy' },
          { name: 'Medium (hide 2, base 2 pt)', value: 'medium' },
          { name: 'Hard (hide 3, base 3 pt)', value: 'hard' },
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const difficultyKey = interaction.options.getString('difficulty', true);
    const config = DIFFICULTY[difficultyKey];

    const allCandidates = await listCompetitiveWithAccountByGuild(interaction.guildId);
    const distinctByName = [...new Map(allCandidates.map((c) => [c.character_name, c])).values()];

    if (distinctByName.length < 3) {
      await interaction.editReply(
        'Need at least 3 competitive-view tracked characters in this server to play — not enough yet.',
      );
      return;
    }

    const picked = await pickAnswer(distinctByName);
    if (!picked) {
      await interaction.editReply("Couldn't find a recent clear to use — try again in a bit.");
      return;
    }

    const { candidate: answerCandidate, entry } = picked;
    const decoyPool = distinctByName.filter((c) => c.character_name !== answerCandidate.character_name);
    const decoys = await pickDecoys(decoyPool, entry.gearScore);
    const choices = shuffle([answerCandidate.character_name, ...decoys]);
    const correctIndex = choices.indexOf(answerCandidate.character_name);

    const role = getRole(entry);
    const cells = buildHideableCells(entry, role);
    const hiddenKeys = pickHiddenKeys(cells, config.hideCount);

    const roundId = interaction.id; // known immediately, no need to send first to get a message id
    const round = {
      correctIndex,
      correctName: escapeMarkdown(answerCandidate.character_name),
      guildId: interaction.guildId,
      choices,
      entry,
      difficultyKey,
      cells,
      hiddenKeys,
      basePoints: config.basePoints,
      correctGuessers: [], // { userId, username, points }, in guess order
      wrongGuessers: [], // { userId, username }, in guess order — the shame list
      attemptedUsers: new Set(), // one guess per user, right or wrong
      timeoutHandle: null,
    };
    activeRounds.set(roundId, round);

    const embed = buildRoundEmbed(round, false);
    const buttons = buildButtons(roundId, choices);
    await interaction.editReply({ embeds: [embed], components: [buttons] });

    round.timeoutHandle = setTimeout(async () => {
      if (!activeRounds.has(roundId)) return; // already resolved via 3 correct guesses
      activeRounds.delete(roundId);
      const revealEmbed = buildRoundEmbed(round, true, 'timeout');
      const revealButtons = buildButtons(roundId, round.choices, true);
      await interaction.editReply({ embeds: [revealEmbed], components: [revealButtons] }).catch(() => {});
    }, ROUND_DURATION_MS);
  },

  componentHandlers: [
    {
      prefix: PICK_PREFIX,
      async handle(interaction) {
        const [roundId, choiceIndexStr] = interaction.customId.slice(PICK_PREFIX.length).split(':');
        const choiceIndex = Number(choiceIndexStr);
        const round = activeRounds.get(roundId);

        if (!round) {
          await interaction.reply({ content: "This round's already over.", flags: MessageFlags.Ephemeral });
          return;
        }

        // One guess per user, right or wrong — no retries. Checked and
        // claimed synchronously (no `await` in between) so two clicks
        // arriving back-to-back can't both slip through before either one
        // is recorded.
        if (round.attemptedUsers.has(interaction.user.id)) {
          await interaction.reply({
            content: "You've already used your guess for this round!",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        round.attemptedUsers.add(interaction.user.id);

        if (choiceIndex !== round.correctIndex) {
          // Modern Discord usernames can contain `_` and `.`, both
          // markdown-significant — an unescaped "_shadow_" sitting next to
          // the shame emoji would get italicized (or worse) instead of
          // rendering literally.
          round.wrongGuessers.push({
            userId: interaction.user.id,
            username: escapeMarkdown(interaction.user.username),
          });

          // Same ack-first pattern as the correct-guess path below — defer
          // instantly, then the message edit (public shame list) and the
          // personal ephemeral note both happen after, with no 3s deadline.
          await interaction.deferUpdate();
          const embed = buildRoundEmbed(round, false);
          const buttons = buildButtons(roundId, round.choices, false);
          await interaction.editReply({ embeds: [embed], components: [buttons] });
          await interaction.followUp({
            content: '❌ Wrong — that was your one guess for this round!',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        // Reserve this guesser's rank synchronously too, before the first
        // `await` — otherwise two correct guesses landing close together
        // could both read the same `correctGuessers.length` and both claim
        // the 1st-place multiplier.
        const rank = round.correctGuessers.length; // 0-indexed: 0 = 1st correct guesser
        const points = round.basePoints * RANK_MULTIPLIERS[rank];
        round.correctGuessers.push({
          userId: interaction.user.id,
          username: escapeMarkdown(interaction.user.username),
          points,
        });
        const revealed = round.correctGuessers.length >= MAX_CORRECT_GUESSERS;
        if (revealed) {
          clearTimeout(round.timeoutHandle);
          activeRounds.delete(roundId);
        }

        // Ack immediately — addPoints() below is a DB round-trip, and
        // waiting on it before responding risks blowing the 3s interaction
        // ack window (especially under back-to-back guesses). deferUpdate()
        // acks instantly; editReply() afterwards has no such deadline.
        await interaction.deferUpdate();
        await addPoints(round.guildId, interaction.user.id, points);

        const embed = buildRoundEmbed(round, revealed);
        const buttons = buildButtons(roundId, round.choices, revealed);
        await interaction.editReply({ embeds: [embed], components: [buttons] });
      },
    },
  ],
};
