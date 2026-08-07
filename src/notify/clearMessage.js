import path from 'node:path';
import {
  AttachmentBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  subtext,
} from 'discord.js';
import { getBossImagePath } from './bossImages.js';
import { tierForFraction } from './percentileTiers.js';
import { getMinDps } from './minDps.js';
import { getClassEmoji } from './classIcons.js';
import { getFriendlyBossName } from './raidFamilies.js';

export const SUPPORT_COLOR = 0x57f287; // Discord green
export const DPS_COLOR = 0xed4245; // Discord red
export const FALLBACK_COLOR = 0x5865f2; // Discord blurple
// Once a second party member joins a consolidated raid clear, the whole
// container switches to this regardless of either member's role — a
// multi-person clear is notable on its own, distinct from either a solo
// DPS or solo support post.
export const GROUP_CLEAR_COLOR = 0xffd700; // gold

const BUFF_LABELS = ['AP Buff', 'Brand', 'Identity', 'T'];

// Discord's real total-component-per-message cap for Components V2 isn't
// exposed by discord.js's own client-side validation (which only checks
// individual array maxes, not a message-wide total) — stay comfortably
// under the ~40 the API is known to enforce before falling back to a fresh
// message instead of continuing to force an append.
const MAX_CONTAINER_COMPONENTS = 34;

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/** 2-decimal float, with M/B suffix for large stats (damage-scale numbers). */
export function formatStat(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toFixed(2);
}

/** Fractions (0-1) as a percentage, e.g. 0.0503 -> "5.03%". */
function formatPercent(fraction) {
  if (fraction === null || fraction === undefined) return 'N/A';
  return `${(fraction * 100).toFixed(2)}%`;
}

/** Percentile fields get a tier dot and are framed as "Top X%" — a 0.95
 * percentile means you're better than 95% of parses, i.e. top 5%. Plain
 * contribution fractions (not a ranking against other parses) use
 * formatPercent instead. */
function formatPercentile(fraction) {
  if (fraction === null || fraction === undefined) return 'N/A';
  const topPercent = (100 - fraction * 100).toFixed(2);
  return `${tierForFraction(fraction).emoji} Top ${topPercent}%`;
}

export function getRole(logEntry) {
  if ('bdps' in logEntry) return 'support';
  if ('udps' in logEntry) return 'dps';
  return 'unknown';
}

function emojiTag(classNameOrIconKey) {
  const emoji = getClassEmoji(classNameOrIconKey);
  return emoji ? `<:${emoji.name}:${emoji.id}>` : '';
}

function colorForRole(role) {
  return role === 'support' ? SUPPORT_COLOR : role === 'dps' ? DPS_COLOR : FALLBACK_COLOR;
}

function separatorJson() {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small).toJSON();
}

/** Filename must be unique per party member within one message, not just
 * per raid clear — logEntry.id is deliberately the same for every member
 * of a consolidated raid clear (that's what makes consolidation possible
 * in the first place), and editing a message with a *new* file upload
 * invalidates whichever attachment(s) were already backing it (confirmed
 * live — the old thumbnail 404s afterward, even though it's never listed
 * in message.attachments to begin with). So every append re-uploads one
 * fresh copy of the boss image and repoints every member's thumbnail at
 * it, rather than trying to keep old attachments alive across an edit. */
function attachmentFilename(logEntry, suffix) {
  const ext = path.extname(getBossImagePath(logEntry.boss));
  return `boss-${logEntry.id}-${suffix}${ext}`;
}

/**
 * Header + role-specific stat blocks for one party member — no footer,
 * that's shared across the whole consolidated raid clear (see
 * buildFooterJson below, which now always carries duration for every view
 * mode, so it doesn't need repeating here). Returns raw API component
 * JSON, ready to slot into a Container's `components` array.
 *
 * `compact` view mode skips the stat blocks entirely.
 */
function buildMemberComponentsJson(logEntry, viewMode, filename) {
  const role = getRole(logEntry);
  const bossLabel = getFriendlyBossName(logEntry.boss);
  const isCompetitive = viewMode === 'competitive';

  const headerContent =
    `### ${emojiTag(logEntry.class)} ${logEntry.name} cleared ${bossLabel}\n` +
    `**Class:** ${logEntry.class} (${logEntry.spec})\n` +
    `**Gear Score:** ${formatStat(logEntry.gearScore)}\n` +
    `**Combat Power:** ${formatStat(logEntry.combatPower)}`;

  const header = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent))
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${filename}`))
    .toJSON();

  if (!isCompetitive) return [header];

  const statBlocks = [];
  if (role === 'support') {
    statBlocks.push(
      new TextDisplayBuilder().setContent(
        `**Buff Uptimes**\n${(logEntry.buffs ?? [])
          .map((value, i) => `**${BUFF_LABELS[i] ?? `Buff ${i + 1}`}**: ${formatPercent(value)}`)
          .join('  |  ')}`,
      ),
      new TextDisplayBuilder().setContent(
        `**Damage**\n**rDPS**: ${formatStat(logEntry.rdps)}  |  **rDPS%**: ${formatPercent(logEntry.rContribution)}`,
      ),
      new TextDisplayBuilder().setContent(
        `**Percentile**\n**Uptime**: ${formatPercentile(logEntry.percentile)}  |  **Contribution**: ${formatPercentile(logEntry.contributionPercentile)}`,
      ),
    );
  } else if (role === 'dps') {
    const minDps = getMinDps(logEntry.boss, logEntry.difficulty);
    let damageLine = `**DPS**: ${formatStat(logEntry.dps)}  |  **UDPS**: ${formatStat(logEntry.udps)}`;
    if (minDps !== null) {
      const met = logEntry.dps >= minDps;
      damageLine += `  |  **Min. DPS**: ${formatStat(minDps)} ${met ? '✅' : '⚠️'}`;
    }
    statBlocks.push(
      new TextDisplayBuilder().setContent(`**Damage**\n${damageLine}`),
      new TextDisplayBuilder().setContent(`**Percentile**\n${formatPercentile(logEntry.percentile)}`),
    );
  } else {
    statBlocks.push(new TextDisplayBuilder().setContent(`**DPS**: ${formatStat(logEntry.dps)}`));
  }

  return [header, ...statBlocks.map((c) => c.toJSON())];
}

/** Shared footer for the whole consolidated raid clear — duration and
 * timestamp are the same for every party member since it's the same raid
 * instance, not per-member info, so it always shows regardless of view
 * mode. The "View Log" button only shows if `includeButton` is true —
 * compact alone gets the subtext with no link, but a compact member
 * grouped with even one competitive member still gets the link, since
 * that's a property of the group, not any one member's own preference.
 * Plain TextDisplay JSON (no Section/accessory wrapper) when there's no
 * button, since a Section always needs *some* accessory. */
function buildFooterJson(logEntry, includeButton) {
  const ts = Math.floor(logEntry.timestamp / 1000);
  const content = subtext(`Cleared ${logEntry.difficulty} in ${formatDuration(logEntry.duration)} • <t:${ts}:R>`);

  if (!includeButton) {
    return new TextDisplayBuilder().setContent(content).toJSON();
  }

  const logUrl = `https://lostark.bible/logs/${logEntry.id}`;
  return new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
    .setButtonAccessory(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('View Log').setURL(logUrl))
    .toJSON();
}

/** First member of a raid clear — builds the whole message from scratch. */
export function buildInitialClearMessage(logEntry, viewMode = 'competitive') {
  const role = getRole(logEntry);
  const isCompetitive = viewMode === 'competitive';
  const filename = attachmentFilename(logEntry, logEntry.name);
  const attachment = new AttachmentBuilder(getBossImagePath(logEntry.boss), { name: filename });

  const memberJson = buildMemberComponentsJson(logEntry, viewMode, filename);
  const components = [...memberJson, separatorJson(), buildFooterJson(logEntry, isCompetitive)];

  const container = new ContainerBuilder({ accent_color: colorForRole(role), components });

  return { components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 };
}

/**
 * True if this character's block is already present in the container —
 * guards against a duplicate append when a poll tick retries an
 * announcement that partially succeeded (e.g. an earlier member in the
 * same tick's loop posted fine, then a later one in the same batch threw,
 * so `updateLastSeen` never ran and the whole batch — including this
 * already-announced member — gets reprocessed next tick). Every member's
 * header always contains "{name} cleared ", so a substring check is enough
 * without needing to parse the full component tree.
 */
export function containerHasMember(containerJson, characterName) {
  return containerJson.components.some((component) => {
    if (component.type !== ComponentType.Section) return false;
    const text = component.components?.[0]?.content ?? '';
    return text.includes(`${characterName} cleared `);
  });
}

/**
 * A later party member's clear, appended onto an existing consolidated
 * message. `existingContainerJson` is the raw JSON of that message's
 * single top-level Container (from `message.components[0].toJSON()`).
 * Returns `null` if appending would push the container past
 * MAX_CONTAINER_COMPONENTS — the caller should post a fresh message
 * instead in that case (mirrors the old embeds-per-message cap).
 */
export function buildAppendedClearMessage(existingContainerJson, logEntry, viewMode) {
  const isCompetitive = viewMode === 'competitive';

  // The footer (separator + footer block) is always the last two
  // components now — every message gets one regardless of view mode — so
  // stripping it before appending is unconditional.
  const oldFooter = existingContainerJson.components.at(-1);
  const hadButton = oldFooter?.type === ComponentType.Section && oldFooter.accessory?.type === ComponentType.Button;
  const priorComponents = existingContainerJson.components.slice(0, -2);

  if (priorComponents.length >= MAX_CONTAINER_COMPONENTS) {
    return null;
  }

  const filename = attachmentFilename(logEntry, `${priorComponents.length}-${logEntry.name}`);
  const attachment = new AttachmentBuilder(getBossImagePath(logEntry.boss), { name: filename });

  // Repoint every prior member's header thumbnail at the one fresh
  // upload — see attachmentFilename's comment for why.
  for (const component of priorComponents) {
    if (component.type === ComponentType.Section && component.accessory?.type === ComponentType.Thumbnail) {
      component.accessory.media.url = `attachment://${filename}`;
    }
  }

  const memberJson = buildMemberComponentsJson(logEntry, viewMode, filename);
  // The group's log-link button shows if it already had one, or if this
  // newly-appended member is the one introducing the need for it — either
  // way that's a property of the group, not any one member's preference.
  const includeButton = hadButton || isCompetitive;
  const components = [
    ...priorComponents,
    separatorJson(),
    ...memberJson,
    separatorJson(),
    buildFooterJson(logEntry, includeButton),
  ];

  // Appending means this is now a 2+-person clear regardless of either
  // member's role — switches to gold, and stays gold for any further
  // members after this one too.
  const container = new ContainerBuilder({ accent_color: GROUP_CLEAR_COLOR, components });

  return { components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 };
}
