import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
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
const DEFAULT_DURATION_SECONDS = 90;
const MIN_DURATION_SECONDS = 15;
const MAX_DURATION_SECONDS = 300;
const MAX_ANSWER_ATTEMPTS = 5; // some tracked characters may have no logs yet
const BUFF_LABELS = ['AP Buff', 'Brand', 'Identity', 'T'];

// Difficulty controls how many fields below get redacted (in addition to the
// name, which is always hidden) and how many points a correct guess is
// worth — more hidden, harder to guess, worth more. The pool now includes
// both the identifying metadata AND the performance stats, so at higher
// difficulty a round can genuinely hide e.g. Buff Uptimes or Percentile,
// not just secondary details like Combat Power.
const DIFFICULTY = {
  easy: { label: 'Easy', hideCount: 1, points: 1 },
  medium: { label: 'Medium', hideCount: 2, points: 2 },
  hard: { label: 'Hard', hideCount: 3, points: 3 },
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
    .setFooter({ text: `${config.label} (${config.points} pt) — pick who you think this is` });
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
      const entries = await getCharacterLogs(accessToken, candidate.character_name, candidate.region, { page: 1 });
      if (entries && entries.length > 0) {
        return { candidate, entry: entries[0] };
      }
    } catch {
      // token expired, missing scope, etc. — just try the next candidate
    }
  }
  return null;
}

export const guessParseCommand = {
  data: new SlashCommandBuilder()
    .setName('guess-parse')
    .setDescription('Guess whose recent raid clear this is — pick from 3 tracked characters')
    .addStringOption((option) =>
      option
        .setName('difficulty')
        .setDescription('How much info to hide — harder means fewer clues and more points')
        .setRequired(true)
        .addChoices(
          { name: 'Easy (hide 1, worth 1 pt)', value: 'easy' },
          { name: 'Medium (hide 2, worth 2 pt)', value: 'medium' },
          { name: 'Hard (hide 3, worth 3 pt)', value: 'hard' },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName('duration')
        .setDescription(`Round length in seconds (${MIN_DURATION_SECONDS}-${MAX_DURATION_SECONDS}, default ${DEFAULT_DURATION_SECONDS})`)
        .setMinValue(MIN_DURATION_SECONDS)
        .setMaxValue(MAX_DURATION_SECONDS),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const difficultyKey = interaction.options.getString('difficulty', true);
    const durationSeconds = interaction.options.getInteger('duration') ?? DEFAULT_DURATION_SECONDS;
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
    const decoys = shuffle(decoyPool)
      .slice(0, 2)
      .map((c) => c.character_name);
    const choices = shuffle([answerCandidate.character_name, ...decoys]);
    const correctIndex = choices.indexOf(answerCandidate.character_name);

    const role = getRole(entry);
    const cells = buildHideableCells(entry, role);
    const hiddenKeys = applyLinkedHides(
      new Set(shuffle(cells.map((c) => c.key)).slice(0, Math.min(config.hideCount, cells.length))),
      cells,
    );

    const embed = buildRedactedEmbed(entry, difficultyKey, hiddenKeys, cells);
    const roundId = interaction.id; // known immediately, no need to send first to get a message id
    const buttons = buildButtons(roundId, choices);

    await interaction.editReply({ embeds: [embed], components: [buttons] });

    const timeoutHandle = setTimeout(async () => {
      if (!activeRounds.has(roundId)) return; // already resolved
      activeRounds.delete(roundId);
      const revealEmbed = EmbedBuilder.from(embed).setFooter({
        text: `Time's up! It was ${answerCandidate.character_name}.`,
      });
      await interaction
        .editReply({ embeds: [revealEmbed], components: [buildButtons(roundId, choices, true)] })
        .catch(() => {});
    }, durationSeconds * 1000);

    activeRounds.set(roundId, {
      correctIndex,
      correctName: answerCandidate.character_name,
      guildId: interaction.guildId,
      choices,
      embed,
      points: config.points,
      timeoutHandle,
    });
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

        if (choiceIndex !== round.correctIndex) {
          await interaction.reply({ content: '❌ Not quite — try again!', flags: MessageFlags.Ephemeral });
          return;
        }

        clearTimeout(round.timeoutHandle);
        activeRounds.delete(roundId);
        await addPoints(round.guildId, interaction.user.id, round.points);

        const revealEmbed = EmbedBuilder.from(round.embed).setFooter({
          text: `🎉 ${interaction.user.username} guessed it (+${round.points} pt) — it was ${round.correctName}!`,
        });
        await interaction.update({
          embeds: [revealEmbed],
          components: [buildButtons(roundId, round.choices, true)],
        });
      },
    },
  ],
};
