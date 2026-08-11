import path from 'node:path';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
  escapeMarkdown,
} from 'discord.js';
import { listCompetitiveWithAccountByGuild } from '../../db/trackedCharacters.js';
import { addPoints } from '../../db/guessGame.js';
import { decryptToken } from '../../crypto/tokenCipher.js';
import { getCharacterLogs } from '../../lostarkbible/client.js';
import { getRole, formatStat, FALLBACK_COLOR } from '../../notify/clearMessage.js';
import { getMinDps } from '../../notify/minDps.js';
import { getFriendlyBossName, ALL_KNOWN_BOSSES } from '../../notify/raidFamilies.js';
import { getBossImagePath } from '../../notify/bossImages.js';
import { tierForFraction } from '../../notify/percentileTiers.js';
import { sleep } from '../../utils/sleep.js';

const PICK_PREFIX = 'guess-parse-pick:';
// Caps *rounds*, not total live lookups — every account gets tried once
// before anyone gets tried a 2nd time, so a flat attempt cap could bail out
// mid-round and never even reach some accounts (some tracked characters
// have no logs yet, so a bad early draw can burn through a flat budget
// fast). 3 rounds means every account gets up to 3 different random
// characters tried before the search gives up.
const MAX_ANSWER_ROUNDS = 3;
// A worst-case search (everyone dead, all rounds) now makes far more live
// lookups than the old flat 5-attempt cap ever could — pace them like
// bonk.js/poller.js do, so a bad-luck /guess-parse doesn't burst-fire
// lostark.bible's rate limit.
const ANSWER_ATTEMPT_DELAY_MS = 150;
// Now that ALL_KNOWN_BOSSES unlocks real pagination (see tryCandidate),
// a random page in this range reaches genuinely deep history instead of
// re-reading the same most-recent window every time.
const MIN_LOG_PAGE = 1;
const MAX_LOG_PAGE = 10;
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
 * this boss/difficulty).
 *
 * `role === 'unknown'` falls back to DPS_STAT_FIELDS rather than an empty
 * pool. Confirmed live: getRole() returns 'unknown' for older log entries
 * (reached now that pagination actually works) that predate lostark.bible
 * tagging entries with `udps`/`bdps` — those entries still have a plain
 * `dps` value, just no way to tell support from dps by key presence alone.
 * SUPPORT_STAT_FIELDS isn't a safer guess here: rdps/rContribution have
 * never been observed present on *any* entry, old or new (a separate,
 * pre-existing gap — see clearMessage.js's formatStat), so defaulting to
 * "dps-shaped" data is the option actually backed by what's on the entry.
 * formatStat/formatPercent/formatPercentile are all null-safe, so a cell
 * whose field genuinely isn't on this entry just renders "N/A" instead of
 * dropping out or crashing. */
function buildHideableCells(entry, role) {
  const statFields = role === 'support' ? SUPPORT_STAT_FIELDS : DPS_STAT_FIELDS;
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

/** Doesn't leak the answer — the boss/gate is already shown un-redacted in
 * the embed title (guess-parse hides *who* cleared it, never *what* was
 * cleared), so a banner image is free information, same as clearMessage.js's
 * announcements. One stable filename per round (not per-edit, unlike
 * clearMessage.js's consolidation case) since the image never changes
 * across a round's guesses/reveal — only ever uploaded once, at round
 * creation; see queueRoundEdit's first call in execute(). */
function imageFilename(roundId, boss) {
  return `boss-${roundId}${path.extname(getBossImagePath(boss))}`;
}

/** Same stat breakdown a clear announcement would show — name always
 * hidden, plus whichever of `hiddenKeys` (drawn from `cells`) get replaced
 * with a lock icon instead of their real value. */
function buildRedactedEmbed(entry, difficultyKey, hiddenKeys, cells, imageFile) {
  const bossLabel = getFriendlyBossName(entry.boss, entry.difficulty);
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
    .setThumbnail(`attachment://${imageFile}`)
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
 * hiddenKeys until round.revealed is true, at which point every hidden
 * field (and the answer) is shown. Reads round.revealed/round.revealReason
 * directly rather than taking them as parameters, so every call site is
 * guaranteed to reflect the round's *actual current* state — no risk of a
 * caller building from a `revealed` snapshot that's gone stale because
 * someone else's concurrent guess revealed the round in the meantime. */
function buildRoundEmbed(round) {
  const hiddenKeys = round.revealed ? new Set() : round.hiddenKeys;
  const embed = buildRedactedEmbed(round.entry, round.difficultyKey, hiddenKeys, round.cells, round.imageFilename);
  const guessesField = buildGuessesField(round.correctGuessers);
  if (guessesField) embed.addFields(guessesField);
  const shameField = buildWrongGuessesField(round.wrongGuessers);
  if (shameField) embed.addFields(shameField);
  if (round.revealed) {
    const text = round.revealReason === 'timeout'
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

/** Serializes every editReply() call for a round through one promise chain
 * per round, so concurrent guesses (several people clicking within the
 * same instant) can never land out of order. Without this, each click's
 * own editReply() was an independent, unordered network call — if a wrong
 * guess's edit (built with the round still hidden) happened to *complete*
 * after the 3rd-correct-guess's reveal edit, it would silently overwrite
 * the message back to its hidden state.
 *
 * `buildPayload` is called lazily, right as this edit's turn in the queue
 * comes up — not eagerly at the call site — so it always reads the round's
 * state at actual send time. Combined with buildRoundEmbed() reading
 * round.revealed directly instead of a parameter, this guarantees whichever
 * edit ends up executing *last* in the queue reflects the round's true
 * final state, regardless of how the underlying network calls interleave. */
function queueRoundEdit(round, interaction, buildPayload) {
  round.editQueue = (round.editQueue ?? Promise.resolve())
    .catch(() => {}) // an earlier queued edit's failure shouldn't block this one
    .then(() => interaction.editReply(buildPayload()))
    .catch((err) => {
      console.error('guess-parse: failed to apply a queued round edit:', err);
    });
  return round.editQueue;
}

async function tryCandidate(candidate) {
  try {
    const accessToken = decryptToken(candidate.access_token);
    // lostark.bible's pagination silently no-ops without a `bosses` filter
    // (every page returns the identical most-recent-25 window, confirmed
    // live) — but paginates correctly *with* one. ALL_KNOWN_BOSSES unlocks
    // real history beyond the most recent page, and picking randomly
    // *within* whatever page comes back adds a second layer of variety on
    // top of the random page itself.
    const page = randomInt(MIN_LOG_PAGE, MAX_LOG_PAGE);
    let entries = await getCharacterLogs(accessToken, candidate.character_name, candidate.region, {
      page,
      bosses: ALL_KNOWN_BOSSES,
    });
    if (!entries || entries.length === 0) {
      // That page might be past the end of this character's filtered
      // history — fall back to page 1 (guaranteed to have data if they
      // have any matching logs at all) instead of burning an attempt.
      entries = await getCharacterLogs(accessToken, candidate.character_name, candidate.region, {
        page: 1,
        bosses: ALL_KNOWN_BOSSES,
      });
    }
    if (entries && entries.length > 0) {
      const entry = entries[randomInt(0, entries.length - 1)];
      return { candidate, entry };
    }
  } catch {
    // token expired, missing scope, etc. — caller tries someone else
  }
  return null;
}

/** Picks the round's answer by user first, character second — a linked
 * account with a dozen tracked alts used to dominate the answer pool simply
 * by having more entries in the flat character list; grouping by account
 * first gives every player an equal shot at being featured, regardless of
 * roster size.
 *
 * Attempts proceed in "rounds": round 0 tries one random character from
 * every account (in shuffled account order), round 1 tries each account's
 * next random character, and so on — so a retry only reaches into the same
 * account a second time after every other account has already had a turn.
 * Capped at MAX_ANSWER_ROUNDS full passes, not a flat total-call budget —
 * that guarantees every account gets tried at least once before the search
 * gives up, instead of an unlucky draw on the first few accounts silently
 * exhausting the budget before the rest are ever reached. */
async function pickAnswer(candidates) {
  const byAccount = new Map();
  for (const candidate of candidates) {
    if (!byAccount.has(candidate.linked_account_id)) byAccount.set(candidate.linked_account_id, []);
    byAccount.get(candidate.linked_account_id).push(candidate);
  }
  const accountQueues = shuffle([...byAccount.values()]).map((chars) => shuffle(chars));

  for (let roundIndex = 0; roundIndex < MAX_ANSWER_ROUNDS; roundIndex++) {
    if (!accountQueues.some((q) => q.length > roundIndex)) break; // every account's roster exhausted
    for (const queue of accountQueues) {
      const candidate = queue[roundIndex];
      if (!candidate) continue; // this account has fewer than roundIndex + 1 characters
      const result = await tryCandidate(candidate);
      if (result) return result;
      await sleep(ANSWER_ATTEMPT_DELAY_MS);
    }
  }
  return null;
}

/** Picks 2 decoys, preferring characters in the same Gear Score bucket as
 * the answer — since the real Gear Score value stays visible whenever it
 * isn't the field a round redacted, choices spanning wildly different
 * iLvls would make the guess trivial for anyone who knows the roster.
 * Falls back to any other candidate if the bucket doesn't have enough.
 *
 * No live API calls here at all: `gear_score` comes straight off the
 * tracked_characters row `listCompetitiveWithAccountByGuild` already
 * fetched, which the poller refreshes every 10 minutes via
 * updateLastSeen() as a side effect of normal polling — plenty fresh for
 * "which iLvl bucket is this in", and it means decoy selection no longer
 * does the request-per-candidate burst that used to blow through
 * lostark.bible's rate limit on larger rosters (confirmed live: firing the
 * whole pool at once took 23s+ and 429'd repeatedly on a 52-character
 * guild; reading the cached column is effectively instant). `pg` returns
 * NUMERIC columns as strings, hence the explicit Number() conversion. */
function pickDecoys(decoyPool, answerGearScore) {
  const answerBucket = gearScoreBucket(answerGearScore);
  const scored = decoyPool.map((c) => ({
    name: c.character_name,
    gearScore: c.gear_score !== null && c.gear_score !== undefined ? Number(c.gear_score) : null,
  }));
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
    const decoys = pickDecoys(decoyPool, entry.gearScore);
    const choices = shuffle([answerCandidate.character_name, ...decoys]);
    const correctIndex = choices.indexOf(answerCandidate.character_name);

    const role = getRole(entry);
    const cells = buildHideableCells(entry, role);
    const hiddenKeys = pickHiddenKeys(cells, config.hideCount);

    const roundId = interaction.id; // known immediately, no need to send first to get a message id
    const imageFile = imageFilename(roundId, entry.boss);
    const round = {
      correctIndex,
      correctName: escapeMarkdown(answerCandidate.character_name),
      guildId: interaction.guildId,
      choices,
      entry,
      difficultyKey,
      cells,
      hiddenKeys,
      imageFilename: imageFile,
      basePoints: config.basePoints,
      correctGuessers: [], // { userId, username, points }, in guess order
      wrongGuessers: [], // { userId, username }, in guess order — the shame list
      attemptedUsers: new Set(), // one guess per user, right or wrong
      timeoutHandle: null,
      revealed: false,
      revealReason: null, // 'guesses' | 'timeout', set once revealed becomes true
      editQueue: null, // see queueRoundEdit()
    };
    activeRounds.set(roundId, round);

    // The boss image only needs uploading once — later queueRoundEdit calls
    // (guesses, timeout reveal) rebuild the embed but leave `files` unset,
    // which per Discord's edit semantics leaves the existing attachment
    // alone. Deliberately NOT re-uploading on every edit like
    // clearMessage.js's consolidation case does — that's only needed there
    // because each append repoints the image at a fresh copy; a guess-parse
    // round's image never changes across its own lifetime.
    const attachment = new AttachmentBuilder(getBossImagePath(entry.boss), { name: imageFile });
    await queueRoundEdit(round, interaction, () => ({
      embeds: [buildRoundEmbed(round)],
      components: [buildButtons(roundId, round.choices, round.revealed)],
      files: [attachment],
    }));

    round.timeoutHandle = setTimeout(async () => {
      if (!activeRounds.has(roundId)) return; // already resolved via 3 correct guesses
      activeRounds.delete(roundId);
      round.revealed = true;
      round.revealReason = 'timeout';
      await queueRoundEdit(round, interaction, () => ({
        embeds: [buildRoundEmbed(round)],
        components: [buildButtons(roundId, round.choices, round.revealed)],
      }));
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
          await queueRoundEdit(round, interaction, () => ({
            embeds: [buildRoundEmbed(round)],
            components: [buildButtons(roundId, round.choices, round.revealed)],
          }));
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
        if (round.correctGuessers.length >= MAX_CORRECT_GUESSERS) {
          round.revealed = true;
          round.revealReason = 'guesses';
          clearTimeout(round.timeoutHandle);
          activeRounds.delete(roundId);
        }

        // Ack immediately — addPoints() below is a DB round-trip, and
        // waiting on it before responding risks blowing the 3s interaction
        // ack window (especially under back-to-back guesses). deferUpdate()
        // acks instantly; editReply() afterwards has no such deadline.
        await interaction.deferUpdate();
        await addPoints(round.guildId, interaction.user.id, points);

        await queueRoundEdit(round, interaction, () => ({
          embeds: [buildRoundEmbed(round)],
          components: [buildButtons(roundId, round.choices, round.revealed)],
        }));
      },
    },
  ],
};
