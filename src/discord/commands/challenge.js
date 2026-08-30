import path from 'node:path';
import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
} from 'discord.js';
import { getByDiscordUserId, markNeedsReauth } from '../../db/linkedAccounts.js';
import { listCompetitiveByLinkedAccountAndGuild, getCompetitiveByIdForDiscordUser } from '../../db/trackedCharacters.js';
import { getGoldEarnerKeySet } from '../../db/goldEarners.js';
import {
  createChallenge,
  getChallengeById,
  getChallengeOwnerDiscordId,
  setBetMessage,
  getChallengeExclusionKeysForCharacter,
} from '../../db/challenges.js';
import { upsertBet, getBetCounts } from '../../db/challengeBets.js';
import { getAnnouncementChannel } from '../../db/guildSettings.js';
import { decryptToken } from '../../crypto/tokenCipher.js';
import { getCharacterLogs } from '../../lostarkbible/client.js';
import { TokenExpiredError, InsufficientScopeError } from '../../lostarkbible/errors.js';
import { getBestRaidsForGearScore } from '../../notify/challengeRaids.js';
import { getFriendlyBossName } from '../../notify/raidFamilies.js';
import { getBossImagePath } from '../../notify/bossImages.js';
import { getClassEmoji } from '../../notify/classIcons.js';
import { formatStat } from '../../notify/clearMessage.js';
import { sleep } from '../../utils/sleep.js';

const SELECT_PREFIX = 'challenge-select:';
const REROLL_PREFIX = 'challenge-reroll:';
const ACCEPT_PREFIX = 'challenge-accept:';
const BET_PREFIX = 'challenge-bet:';
const MAX_OPTIONS = 25; // Discord select menu limit

// How many recent same-difficulty clears to average for the target — "beat
// your average" per the design decision. Capped pagination (not "keep
// paging until 5 found") for the same rate-limit-awareness reason
// guess-parse's MAX_LOG_PAGE is capped: a character that's genuinely never
// cleared this gate at this difficulty would otherwise page forever.
const TARGET_SAMPLE_SIZE = 5;
const MAX_FETCH_PAGES = 3;
const PER_REQUEST_DELAY_MS = 200;

const BUFF_LABELS = ['AP Buff', 'Brand', 'Identity', 'T'];
// "Quest gold" — deliberately distinct from every other embed color already
// in use elsewhere (FALLBACK_COLOR blurple, SUPPORT_COLOR/DPS_COLOR,
// GROUP_CLEAR_COLOR gold-0xffd700) so a challenge reads as its own kind of
// thing at a glance rather than blending in with a normal clear announcement.
const CHALLENGE_COLOR = 0xf1c40f;

const FLAVOR_LINES = [
  '💪 Do you have what it takes?',
  '🔥 Prove it.',
  '⚡ No pressure. (Some pressure.)',
  '🎯 Beat your own numbers — that\'s the whole game.',
  '🏹 Aim higher than last time.',
];
function randomFlavor() {
  return FLAVOR_LINES[Math.floor(Math.random() * FLAVOR_LINES.length)];
}

// Pending (built-but-not-yet-Accepted) challenge data, keyed by the message
// id it's attached to — same in-memory-Map-with-TTL pattern as
// trackCharacter.js's pendingSelections/pendingLinks.js/guessParse.js's
// activeRounds. Needed because Accept is a *separate* interaction from the
// one that built the embed, and the raw target numbers (not just their
// formatted display text) have to survive between them to actually persist
// a challenge poller.js can check clears against later. The message id
// stays constant across Select -> Reroll -> Accept (each edits the same
// message), so it doubles as the natural key. Losing this on a restart just
// means Accept degrades to "locks the message, can't track completion" —
// see the Accept handler.
const pendingChallenges = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;
function storePendingChallenge(messageId, data) {
  pendingChallenges.set(messageId, data);
  setTimeout(() => pendingChallenges.delete(messageId), PENDING_TTL_MS);
}

function average(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Up to TARGET_SAMPLE_SIZE most recent entries for one boss at one exact
 * difficulty — a single-boss `bosses` filter still returns every difficulty
 * that boss has ever been cleared at (there's no difficulty filter on the
 * API itself), so this pages and filters client-side, same shape as
 * fetchLogsSince/guess-parse's tryCandidate. */
async function fetchRecentAtDifficulty(accessToken, characterName, region, bossName, difficulty) {
  const matched = [];
  for (let page = 1; page <= MAX_FETCH_PAGES && matched.length < TARGET_SAMPLE_SIZE; page++) {
    const batch = await getCharacterLogs(accessToken, characterName, region, { page, bosses: [bossName] });
    await sleep(PER_REQUEST_DELAY_MS);
    if (!batch || batch.length === 0) break;
    for (const entry of batch) {
      if (entry.difficulty === difficulty) matched.push(entry);
      if (matched.length >= TARGET_SAMPLE_SIZE) break;
    }
  }
  return matched;
}

/**
 * The actual target numbers for one gate, from its last-N same-difficulty
 * entries — `null` (not a target of 0) for anything with no data at all.
 *
 * DPS targets use **UDPS** (un-buffed DPS), not the raw `dps` field —
 * `dps` includes whatever damage buffs the party's supports happened to be
 * running that specific raid, so it swings with party composition and
 * isn't really "your own" number to challenge against; `udps` strips that
 * out and stays comparable raid to raid regardless of who you happened to
 * run with. Support targets are unaffected by this — contribution/buff
 * uptime are already about *this character's own* output.
 */
function computeTargets(entries, role) {
  if (entries.length === 0) return null;

  if (role === 'support') {
    const contribution = average(entries.map((e) => e.contributionPercentile ?? 0));
    const buffs = BUFF_LABELS.map((_, i) => {
      const values = entries.map((e) => (e.buffs ?? [])[i]).filter((v) => v !== undefined && v !== null);
      return values.length > 0 ? average(values) : null;
    });
    return { contribution, buffs };
  }

  return { udps: average(entries.map((e) => e.udps ?? 0)) };
}

/** Display text for a gate's targets — mirrors computeTargets' shape
 * exactly (null targets object = no data, null buff slot = that specific
 * buff has no data). */
function formatTargets(targets, sampleSize) {
  if (!targets) return 'No recent clears at this difficulty yet — first clear sets the bar!';

  const sampleNote = `*(avg of last ${sampleSize} clear${sampleSize === 1 ? '' : 's'})*`;

  if ('contribution' in targets) {
    const buffLines = BUFF_LABELS.map((label, i) =>
      targets.buffs[i] !== null ? `${label} ≥ **${(targets.buffs[i] * 100).toFixed(1)}%**` : null,
    ).filter(Boolean);
    return `Contribution ≥ **${(targets.contribution * 100).toFixed(1)}%**\n${buffLines.join(' · ')}\n${sampleNote}`;
  }

  return `Reach **${formatStat(targets.udps)}** UDPS\n${sampleNote}`;
}

function buildButtons(trackedCharacterId, bossName) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${ACCEPT_PREFIX}${trackedCharacterId}`).setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`${REROLL_PREFIX}${trackedCharacterId}:${bossName}`)
      .setLabel('Reroll')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
  );
}

/** `<:name:id>` — the inline-text form of a custom emoji, same helper
 * poller.js/bonk.js/clearMessage.js each keep their own copy of rather than
 * share (see ARCHITECTURE.md's note on that duplication being deliberate). */
function emojiTag(classNameOrIconKey) {
  const emoji = getClassEmoji(classNameOrIconKey);
  return emoji ? `<:${emoji.name}:${emoji.id}>` : '';
}

/** The Success/Failure betting buttons on a challenge's public post — the
 * label carries the live tally so anyone glancing at the message can see
 * how the crowd is leaning without opening anything, redrawn after every
 * bet (see the BET_PREFIX handler) and one final time, disabled, when
 * poller.js locks the message at resolution. */
function buildBetButtons(challengeId, counts, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BET_PREFIX}${challengeId}:success`)
      .setLabel(`Success (${counts.success})`)
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅')
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${BET_PREFIX}${challengeId}:failure`)
      .setLabel(`Failure (${counts.failure})`)
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌')
      .setDisabled(disabled),
  );
}

/** Posts a challenge's public "place your bet" announcement once it's been
 * Accepted, and remembers where it landed (setBetMessage) so poller.js can
 * find and lock it later. Silently no-ops if this guild has no
 * announcement channel configured, or if the send itself fails (e.g. the
 * bot lost access to that channel) — betting is a bonus feature, not
 * something that should block the Accept flow itself. */
async function postPublicChallenge(discordClient, channelId, challenge, character) {
  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const gateLabel = getFriendlyBossName(challenge.boss_name, challenge.difficulty);
  const namePrefix = character?.class_name ? `${emojiTag(character.class_name)} ` : '';
  const imagePath = getBossImagePath(challenge.boss_name);
  const imageFile = `challenge-bet-${challenge.id}${path.extname(imagePath)}`;
  const attachment = new AttachmentBuilder(imagePath, { name: imageFile });

  const embed = new EmbedBuilder()
    .setTitle(`🎯 CHALLENGE ACCEPTED: ${gateLabel} — ${challenge.difficulty}`)
    .setDescription(
      `${namePrefix}**${character?.character_name ?? 'A challenger'}** just accepted this challenge!\n\n` +
        `${formatTargets(challenge.targets, challenge.sample_size)}\n\n` +
        `🎲 Think they'll pull it off? Place your bet below — you can change it any time before it resolves. ` +
        `(The challenger can't bet on themselves.)`,
    )
    .setThumbnail(`attachment://${imageFile}`)
    .setColor(CHALLENGE_COLOR);

  const message = await channel
    .send({ embeds: [embed], files: [attachment], components: [buildBetButtons(challenge.id, { success: 0, failure: 0 })] })
    .catch((err) => {
      console.error('Failed to post public challenge announcement:', err);
      return null;
    });
  if (message) await setBetMessage(challenge.id, channelId, message.id);
}

/**
 * Builds the full challenge payload for a character — one gate, not a
 * whole raid family (a multi-gate challenge could stall forever on a gate
 * the player never re-clears, e.g. one they already have on skip; see the
 * challenges-table migration comment). Picks a random gate from the
 * character's current best-3 gold-earning *families* (getBestRaidsForGearScore,
 * which already excludes Extreme raids — they don't compete for one of
 * the 3 weekly gold-earner slots this is themed around), flattened into a
 * pool of individual gates across those 3 families. `excludeBossName`
 * (Reroll's "don't just show me the same thing again") excludes just that
 * one gate, falling back to the full *still-available* pool if excluding
 * would leave nothing (e.g. every candidate family has only one gate
 * combined). Gates the character already has an active, completed, or
 * failed challenge on are left out entirely first — always show only
 * what's actually still worth offering, per explicit request (a completed
 * or failed gate is decided either way, and an active one is already
 * being worked on). Returns
 * `{ error }` or `{ embeds, files, components, pending }` — `pending` is
 * the raw structured data storePendingChallenge needs, kept separate from
 * the Discord payload itself.
 */
async function buildChallengePayload(character, excludeBossName = null) {
  if (character.gear_score === null) {
    return { error: `No gear score on record yet for **${character.character_name}** — check back after its next poll.` };
  }

  const gearScore = Number(character.gear_score);
  const familyCandidates = getBestRaidsForGearScore(gearScore);
  if (familyCandidates.length === 0) {
    return { error: `**${character.character_name}**'s gear score (${formatStat(gearScore)}) doesn't qualify for any tracked raid yet.` };
  }

  const allGateOptions = familyCandidates.flatMap((c) => c.gates.map((gate) => ({ family: c.family, difficulty: c.difficulty, gate })));
  const exclusionKeys = await getChallengeExclusionKeysForCharacter(character.id);
  const availableOptions = allGateOptions.filter((o) => !exclusionKeys.has(`${o.gate.bossName}|${o.difficulty}`));
  if (availableOptions.length === 0) {
    return {
      error:
        `**${character.character_name}** already has a decided or in-progress challenge on every gate across its current ` +
        "best raids — check back once an active one resolves, or after your best raids change.",
    };
  }

  const pool = excludeBossName ? availableOptions.filter((o) => o.gate.bossName !== excludeBossName) : availableOptions;
  const useList = pool.length > 0 ? pool : availableOptions;
  const { family, difficulty, gate } = useList[Math.floor(Math.random() * useList.length)];

  const accessToken = decryptToken(character.access_token);
  const role = character.role === 'support' ? 'support' : 'dps'; // 'unknown'/null falls back to dps, same convention as guessParse.js

  let entries;
  try {
    entries = await fetchRecentAtDifficulty(accessToken, character.character_name, character.region, gate.bossName, difficulty);
  } catch (err) {
    if (err instanceof TokenExpiredError) return { error: "This account's lostark.bible link expired mid-check.", needsReauth: true };
    if (err instanceof InsufficientScopeError) return { error: "Missing permission to read that character's logs." };
    throw err;
  }

  const targets = computeTargets(entries, role);
  const gateLabel = getFriendlyBossName(gate.bossName, difficulty);

  const imagePath = getBossImagePath(gate.bossName);
  const imageFile = `challenge-${character.id}${path.extname(imagePath)}`;
  const attachment = new AttachmentBuilder(imagePath, { name: imageFile });

  const embed = new EmbedBuilder()
    .setTitle(`🎯 CHALLENGE: ${gateLabel} — ${difficulty}`)
    .setDescription(
      `**${character.character_name}** (${formatStat(gearScore)} iLvl) — part of ${family.label}, one of your current top gold-earning raids.\n` +
        `Beat your own recent average below.`,
    )
    .addFields({ name: `⚔️ ${gateLabel}`, value: formatTargets(targets, entries.length) })
    .setThumbnail(`attachment://${imageFile}`)
    .setColor(CHALLENGE_COLOR)
    .setFooter({ text: randomFlavor() });

  return {
    embeds: [embed],
    files: [attachment],
    components: [buildButtons(character.id, gate.bossName)],
    pending: {
      trackedCharacterId: character.id,
      familyKey: family.key,
      difficulty,
      gateIndex: gate.gateIndex,
      bossName: gate.bossName,
      role,
      targets,
      sampleSize: entries.length,
    },
  };
}

export const challengeCommand = {
  data: new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Get a raid gate challenge based on one of your Gold Earner characters'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const account = await getByDiscordUserId(interaction.user.id);
    if (!account) {
      await interaction.editReply("You haven't linked a lostark.bible account yet. Run `/link-account` first.");
      return;
    }

    const [earnerKeySet, characters] = await Promise.all([
      getGoldEarnerKeySet(account.id),
      listCompetitiveByLinkedAccountAndGuild(account.id, interaction.guildId),
    ]);

    if (earnerKeySet.size === 0) {
      await interaction.editReply("You don't have any Gold Earners set yet — run `/gold-earners` first.");
      return;
    }

    // Only characters that are BOTH a designated gold earner AND tracked
    // (competitive view) in this guild — need both the earner designation
    // and the cached gear_score/role to build a challenge at all.
    const eligible = characters.filter((c) => earnerKeySet.has(`${c.character_name}|${c.region}`));
    if (eligible.length === 0) {
      await interaction.editReply(
        "None of your Gold Earners are tracked with **Competitive** view in this server yet — " +
          'run `/track-character` (Competitive) for one of them, or `/gold-earners` to change your picks.',
      );
      return;
    }

    const options = eligible.slice(0, MAX_OPTIONS).map((c) => ({
      label: `${c.character_name} (${c.region})`,
      description: c.gear_score ? `iLvl ${formatStat(Number(c.gear_score))}` : 'iLvl unknown',
      value: c.id,
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId(`${SELECT_PREFIX}${account.id}`)
      .setPlaceholder('Pick a Gold Earner to challenge')
      .addOptions(options);

    await interaction.editReply({
      content: 'Pick which Gold Earner to get a challenge for.',
      components: [new ActionRowBuilder().addComponents(select)],
    });
  },

  componentHandlers: [
    {
      prefix: SELECT_PREFIX,
      async handle(interaction) {
        await interaction.deferUpdate();

        const trackedCharacterId = interaction.values[0];
        const character = await getCompetitiveByIdForDiscordUser(trackedCharacterId, interaction.user.id);
        if (!character) {
          await interaction.editReply({ content: 'That character is no longer trackable here.', components: [] });
          return;
        }
        if (character.account_status !== 'active' || new Date(character.token_expires_at) <= new Date()) {
          await interaction.editReply({ content: "This account's lostark.bible link needs to be re-authorized.", components: [] });
          return;
        }

        const payload = await buildChallengePayload(character);
        if (payload.error) {
          if (payload.needsReauth) await markNeedsReauth(character.linked_account_id);
          await interaction.editReply({ content: payload.error, embeds: [], components: [] });
          return;
        }
        const { pending, ...discordPayload } = payload;
        storePendingChallenge(interaction.message.id, pending);
        await interaction.editReply({ content: null, ...discordPayload });
      },
    },
    {
      prefix: REROLL_PREFIX,
      async handle(interaction) {
        await interaction.deferUpdate();

        const [trackedCharacterId, bossName] = interaction.customId.slice(REROLL_PREFIX.length).split(':');
        const character = await getCompetitiveByIdForDiscordUser(trackedCharacterId, interaction.user.id);
        if (!character) {
          await interaction.editReply({ content: 'That character is no longer trackable here.', embeds: [], components: [] });
          return;
        }

        const payload = await buildChallengePayload(character, bossName);
        if (payload.error) {
          if (payload.needsReauth) await markNeedsReauth(character.linked_account_id);
          await interaction.editReply({ content: payload.error, embeds: [], components: [] });
          return;
        }
        const { pending, ...discordPayload } = payload;
        storePendingChallenge(interaction.message.id, pending);
        await interaction.editReply({ content: null, ...discordPayload });
      },
    },
    {
      prefix: ACCEPT_PREFIX,
      async handle(interaction) {
        const pending = pendingChallenges.get(interaction.message.id);
        pendingChallenges.delete(interaction.message.id);

        // Lock in whatever's already shown either way — same "finalize this
        // exact message" pattern /nuke and /untrack-all use for their own
        // confirm step — but only actually persist (and can only ever
        // announce completion later) if the pending data survived. Losing
        // it (TTL/restart) degrades to "accepted, just not tracked" rather
        // than blocking the accept entirely.
        await interaction.update({ embeds: interaction.message.embeds, components: [] });

        if (!pending) {
          await interaction.followUp({
            content: "✅ Challenge accepted — good luck! (Couldn't save it for tracking — run `/challenge` again if you want completion announcements.)",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        // Accepting more than one challenge at once (for different gates)
        // is fine — createChallenge only replaces an existing active
        // challenge for this exact same gate, not every other one.
        const challenge = await createChallenge(pending.trackedCharacterId, pending);

        // Posted publicly (per explicit design decision — the whole point
        // of the bet is that other people see it and weigh in), to the same
        // announcement channel the eventual result posts to, so the whole
        // lifecycle of one challenge lives in that one channel.
        const channelId = await getAnnouncementChannel(interaction.guildId);
        if (channelId) {
          const character = await getCompetitiveByIdForDiscordUser(pending.trackedCharacterId, interaction.user.id);
          await postPublicChallenge(interaction.client, channelId, challenge, character);
        }

        await interaction.followUp({
          content: channelId
            ? "✅ Challenge accepted — good luck! I've posted it publicly in this server's announcement channel so others can bet on you, and I'll announce the result there too."
            : "✅ Challenge accepted — good luck! (No announcement channel is set up for this server, so it won't be posted publicly or bettable — run `/announce-channel` to enable that.)",
          flags: MessageFlags.Ephemeral,
        });
      },
    },
    {
      prefix: BET_PREFIX,
      async handle(interaction) {
        const [challengeId, outcome] = interaction.customId.slice(BET_PREFIX.length).split(':');

        const challenge = await getChallengeById(challengeId);
        if (!challenge) {
          await interaction.reply({ content: 'This challenge no longer exists.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (challenge.status !== 'active') {
          await interaction.reply({ content: 'This challenge has already been resolved — no more bets.', flags: MessageFlags.Ephemeral });
          return;
        }

        const ownerDiscordId = await getChallengeOwnerDiscordId(challengeId);
        if (ownerDiscordId === interaction.user.id) {
          await interaction.reply({ content: "You can't bet on your own challenge!", flags: MessageFlags.Ephemeral });
          return;
        }

        await upsertBet(challengeId, interaction.user.id, outcome);
        const counts = await getBetCounts(challengeId);

        // Redraw just the buttons with the fresh tally — embeds/attachments
        // are left untouched since they're not part of this update payload.
        await interaction.update({ components: [buildBetButtons(challengeId, counts)] });
        await interaction.followUp({
          content: `🎲 You bet **${outcome === 'success' ? '✅ Success' : '❌ Failure'}**. You can change your bet any time before this challenge resolves.`,
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  ],
};
